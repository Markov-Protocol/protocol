import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type Publication,
  type PublicationOperation,
  type PublicationPrepareRequest,
  type PublicationPreview,
  type PublicationSubmitRequest,
  type PublicStrategy,
  type PublicVersion,
  type RegistrationEvidence,
  type RegistryRecord,
  type RegistryStatus,
  STRATEGY_SCHEMA_VERSION,
  type StatusChangeRequest,
} from '@markov/contracts';
import {
  countFollowers,
  createPublication,
  type Database,
  findOwnedWallet,
  findPublication,
  findPublicationById,
  findPublicStrategy,
  findPublicVersion,
  findRegistryRecord,
  findRegistryRecordByManifestHash,
  findStrategy,
  findVersion,
  findVersionById,
  latestPublication,
  type RegistryRecordRow,
  readIndexerState,
  recordAuditEvent,
  type StrategyPublicationRow,
  type StrategyVersionRow,
  updatePublication,
  upsertRegistryRecord,
} from '@markov/db';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  checkRegisterArgs,
  compareRecordToVersion,
  compileLegacyMessage,
  decodeVersionRecord,
  derivePublicationOutcome,
  describeNodeRejection,
  explorerUrl,
  LAMPORTS_PER_SIGNATURE,
  MAX_LEGS,
  observeSubmission,
  type PublicationOutcome,
  parseTransaction,
  RECORD_SPACE,
  RECORD_STATUSES,
  RELATIONS,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  registryErrorMessage,
  sameMessage,
  serializeMessage,
  setStatusInstruction,
  type TokenProgramName,
  tokenProgramName,
  transactionSignature,
  unsignedTransaction,
  type VersionBinding,
  type VersionRecord,
  verifyTransactionSignatures,
} from '@markov/registry';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { manifestHashOf } from '@markov/strategy';
import { ApiError } from '../errors.js';

export interface RegistryServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  readonly rpcClients: readonly SolanaRpcClient[];
  readonly now?: () => Date;
}

export interface RegistryService {
  status(): Promise<RegistryStatus>;
  prepare(
    principal: Principal,
    strategyId: string,
    versionId: string,
    request: PublicationPrepareRequest,
    requestId: string,
  ): Promise<{ publication: Publication; created: boolean }>;
  prepareStatusChange(
    principal: Principal,
    strategyId: string,
    versionId: string,
    request: StatusChangeRequest,
    requestId: string,
  ): Promise<{ publication: Publication; created: boolean }>;
  submit(
    principal: Principal,
    publicationId: string,
    request: PublicationSubmitRequest,
    requestId: string,
  ): Promise<Publication>;
  getPublication(principal: Principal, publicationId: string): Promise<Publication>;
  versionPublication(
    principal: Principal,
    strategyId: string,
    versionId: string,
  ): Promise<Publication>;
  /** The latest deprecation or reactivation attempt of a version, re-checked against the chain (F08). */
  versionStatusChange(
    principal: Principal,
    strategyId: string,
    versionId: string,
  ): Promise<Publication>;
  publicVersion(strategyId: string, versionId: string): Promise<PublicVersion>;
  publicStrategy(strategyId: string): Promise<PublicStrategy>;
  record(address: string): Promise<RegistryRecord>;
  /** Re-observe every in-flight publication and every program account; used by the indexer and tests. */
  refreshPublication(publicationId: string): Promise<Publication | null>;
}

const RELATION_NAMES = ['none', 'revision', 'fork'] as const;
const NEVER_PUBLISHED = [
  'your Markov account, email and sign-in identity',
  'the link between the publisher wallet and your account',
  'budgets, wallet balances, holdings and orders',
  'private notes, chat, research runs and unpublished drafts',
  'the author principal of the version',
  'archived strategies and versions you did not register',
];
const PERMANENCE =
  'Registration writes this recipe to the Solana ledger under your wallet’s signature. The record can be marked deprecated later; it can never be edited or deleted, and Markov cannot remove it.';

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

function statusOf(status: number): 'active' | 'deprecated' {
  return status === RECORD_STATUSES.deprecated ? 'deprecated' : 'active';
}

function relationOf(relation: number): (typeof RELATION_NAMES)[number] {
  return RELATION_NAMES[relation] ?? 'none';
}

/** The economic content of a frozen version as the chain expects it. */
function bindingOf(
  version: StrategyVersionRow,
  lineage: { relation: keyof typeof RELATIONS; parentManifestHash: string | null },
): VersionBinding {
  return {
    manifestHash: version.manifestHash,
    contentDigest: version.contentDigest,
    legs: version.legs.map((leg) => {
      const tokenProgram: TokenProgramName | 'unknown' = leg.admission.tokenProgram;
      if (tokenProgram === 'unknown') {
        throw new ApiError(
          'VALIDATION_FAILED',
          `the token program of ${leg.symbol} is unknown; the registry accepts SPL Token and Token-2022 mints only`,
          [{ path: `legs/${leg.instrumentId}`, message: 'unknown token program' }],
        );
      }
      return { mint: leg.admission.mint, tokenProgram, weightBps: leg.weightBps };
    }),
    cashWeightBps: version.cashWeightBps,
    relation: lineage.relation,
    parentManifestHash: lineage.parentManifestHash,
  };
}

export function createRegistryService(deps: RegistryServiceDeps): RegistryService {
  const { config, db, genesisHash } = deps;
  const now = deps.now ?? (() => new Date());
  const rpc = deps.rpcClients[0];
  if (!rpc) {
    throw new Error('registry service needs at least one RPC client');
  }
  const cluster = config.solana.cluster;
  const network = { cluster, genesisHash } as const;

  const audit = (
    principal: Principal,
    action: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType: 'publication',
      targetId,
      requestId,
      details,
    });

  const disabledReason = (): string | null => {
    if (config.registry.programId === null) {
      return 'no registry program is configured for this deployment (REGISTRY_PROGRAM_ID)';
    }
    if (!config.registry.publicationEnabled) {
      return `publication is disabled when MARKOV_ENV=${config.markovEnv}; the registry is read and indexed only`;
    }
    return null;
  };

  const requireProgram = (): string => {
    const reason = disabledReason();
    if (reason !== null || config.registry.programId === null) {
      throw new ApiError('PROVIDER_UNAVAILABLE', reason ?? 'the registry is not configured');
    }
    return config.registry.programId;
  };

  const requireIndexedProgram = (): string => {
    if (config.registry.programId === null) {
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        'no registry program is configured for this deployment (REGISTRY_PROGRAM_ID)',
      );
    }
    return config.registry.programId;
  };

  /** Which registered parent, if any, a registration may reference on chain. */
  const lineageOf = async (
    programId: string,
    version: StrategyVersionRow,
  ): Promise<{
    relation: keyof typeof RELATIONS;
    parentManifestHash: string | null;
    parentRecordAddress: string | null;
  }> => {
    const candidates: { relation: 'revision' | 'fork'; versionId: string | null }[] = [
      { relation: 'revision', versionId: version.parentVersionId },
      { relation: 'fork', versionId: version.forkOfVersionId },
    ];
    for (const candidate of candidates) {
      if (!candidate.versionId) {
        continue;
      }
      const parent = await findVersionById(db, candidate.versionId);
      if (!parent) {
        continue;
      }
      const record = await findRegistryRecordByManifestHash(db, programId, parent.manifestHash);
      if (record) {
        return {
          relation: candidate.relation,
          parentManifestHash: parent.manifestHash,
          parentRecordAddress: record.address,
        };
      }
      return { relation: 'none', parentManifestHash: null, parentRecordAddress: null };
    }
    return { relation: 'none', parentManifestHash: null, parentRecordAddress: null };
  };

  const previewOf = (
    version: StrategyVersionRow,
    binding: VersionBinding,
    address: string,
    publisher: string,
    parentRecordAddress: string | null,
  ): PublicationPreview => {
    const args = registrationArgs(binding);
    return {
      manifest: {
        schemaVersion: STRATEGY_SCHEMA_VERSION,
        kind: version.kind as PublicationPreview['manifest']['kind'],
        network,
        strategyId: version.strategyId,
        versionNumber: version.versionNumber,
        parentVersionId: version.parentVersionId,
        forkOf:
          version.forkOfStrategyId && version.forkOfVersionId
            ? { strategyId: version.forkOfStrategyId, versionId: version.forkOfVersionId }
            : null,
        title: version.title,
        thesis: version.thesis,
        thesisId: version.thesisId,
        legs: version.legs.map((leg) => ({
          instrumentId: leg.instrumentId,
          symbol: leg.symbol,
          issuer: leg.issuer,
          mint: leg.admission.mint,
          tokenProgram: leg.admission.tokenProgram,
          weightBps: leg.weightBps,
        })),
        cashWeightBps: version.cashWeightBps,
        maintenance: version.maintenance,
        references: version.references,
        manifestHash: version.manifestHash,
        contentDigest: version.contentDigest,
      },
      onChain: {
        recordAddress: address,
        publisher,
        legs: args.legs.map((leg) => ({
          mint: leg.mint,
          tokenProgram: tokenProgramName(leg.tokenProgram) ?? 'spl-token',
          weightBps: leg.weightBps,
        })),
        cashWeightBps: args.cashWeightBps,
        manifestHash: bytesToHex(args.manifestHash),
        contentDigest: bytesToHex(args.contentDigest),
        relation: binding.relation,
        parentManifestHash: binding.parentManifestHash ?? null,
        parentRecordAddress,
      },
      neverPublished: NEVER_PUBLISHED,
      permanence: PERMANENCE,
    };
  };

  const publicationOf = async (row: StrategyPublicationRow): Promise<Publication> => {
    const version = await findVersionById(db, row.versionId);
    if (!version) {
      throw new ApiError('NOT_FOUND', 'the version of this publication no longer exists');
    }
    const lineage = await lineageOf(row.programId, version);
    const binding = bindingOf(version, lineage);
    return {
      publicationId: row.id,
      strategyId: row.strategyId,
      versionId: row.versionId,
      operation: row.operation as PublicationOperation,
      state: row.state as Publication['state'],
      programId: row.programId,
      network,
      recordAddress: row.recordAddress,
      publisher: { walletId: row.publisherWalletId, address: row.publisherAddress },
      manifestHash: row.manifestHash,
      contentDigest: row.contentDigest,
      transaction:
        row.state === 'awaiting_signature'
          ? {
              unsignedTransaction: row.unsignedTransaction,
              message: row.message,
              recentBlockhash: row.recentBlockhash,
              lastValidBlockHeight: row.lastValidBlockHeight,
              feePayer: row.publisherAddress,
              estimatedCostLamports: row.estimatedCostLamports,
            }
          : null,
      signature: row.signature,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      confirmationStatus: (row.confirmationStatus as Publication['confirmationStatus']) ?? null,
      evidence: row.evidence ?? null,
      failure: row.failure ?? null,
      preview: previewOf(
        version,
        binding,
        row.recordAddress,
        row.publisherAddress,
        lineage.parentRecordAddress,
      ),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  const recordFromOutcome = async (
    row: StrategyPublicationRow,
    outcome: Extract<PublicationOutcome, { state: 'registered' }>,
  ) => {
    await upsertRegistryRecord(db, {
      address: row.recordAddress,
      programId: row.programId,
      genesisHash: row.genesisHash,
      publisher: outcome.record.publisher,
      status: statusOf(outcome.record.status),
      layoutVersion: outcome.record.layoutVersion,
      schemaVersion: outcome.record.schemaVersion,
      relation: relationOf(outcome.record.relation),
      parentManifestHash:
        outcome.record.relation === RELATIONS.none
          ? null
          : bytesToHex(outcome.record.parentManifestHash),
      manifestHash: bytesToHex(outcome.record.manifestHash),
      contentDigest: bytesToHex(outcome.record.contentDigest),
      cashWeightBps: outcome.record.cashWeightBps,
      legs: outcome.record.legs.map((leg) => ({
        mint: leg.mint,
        tokenProgram: tokenProgramName(leg.tokenProgram) ?? 'spl-token',
        weightBps: leg.weightBps,
      })),
      registeredSlot: Number(outcome.record.registeredSlot),
      registeredUnixTime: Number(outcome.record.registeredUnixTime),
      statusUpdatedSlot: Number(outcome.record.statusUpdatedSlot),
      data: bytesToBase64(outcome.recordData),
      signature: row.operation === 'register' ? row.signature : null,
      observedSlot: outcome.evidence.slot,
      now: now(),
    });
  };

  /** Consult the chain for an in-flight publication and record what it says. */
  const refreshRow = async (row: StrategyPublicationRow): Promise<StrategyPublicationRow> => {
    const at = now();
    if ((row.state === 'submitted' || row.state === 'unknown') && row.signature) {
      const version = await findVersionById(db, row.versionId);
      if (!version) {
        return row;
      }
      const lineage = await lineageOf(row.programId, version);
      const observation = await observeSubmission(
        rpc,
        { signature: row.signature, recordAddress: row.recordAddress },
        now,
      );
      const outcome = derivePublicationOutcome(
        {
          operation: row.operation as PublicationOperation,
          programId: row.programId,
          cluster,
          signature: row.signature,
          lastValidBlockHeight: row.lastValidBlockHeight,
          recordAddress: row.recordAddress,
          publisherAddress: row.publisherAddress,
          binding: bindingOf(version, lineage),
        },
        observation,
      );
      if (outcome.state === 'registered') {
        await recordFromOutcome(row, outcome);
      }
      const updated = await updatePublication(
        db,
        row.id,
        {
          state: outcome.state,
          lastCheckedAt: at,
          ...(outcome.state === 'registered'
            ? { evidence: outcome.evidence, failure: null }
            : outcome.state === 'failed' || outcome.state === 'expired'
              ? { failure: outcome.failure }
              : {}),
        },
        at,
      );
      if (updated && 'confirmationStatus' in outcome) {
        await setConfirmation(updated.id, outcome.confirmationStatus ?? null, at);
        return { ...updated, confirmationStatus: outcome.confirmationStatus ?? null };
      }
      return updated ?? row;
    }
    if (row.state === 'awaiting_signature') {
      try {
        const height = await rpc.getBlockHeight('finalized');
        if (height > row.lastValidBlockHeight) {
          const expired = await updatePublication(
            db,
            row.id,
            {
              state: 'expired',
              lastCheckedAt: at,
              failure: {
                code: 'blockhash_expired',
                programErrorCode: null,
                programError: null,
                message:
                  'the transaction was not signed before its blockhash expired; prepare the publication again',
              },
            },
            at,
          );
          return expired ?? row;
        }
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
      }
    }
    return row;
  };

  const setConfirmation = async (
    publicationId: string,
    confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null,
    at: Date,
  ) => {
    await updatePublication(db, publicationId, { confirmationStatus }, at);
  };

  const buildRegistration = async (
    principal: Principal,
    programId: string,
    version: StrategyVersionRow,
    walletId: string,
    requestId: string,
  ): Promise<{ publication: Publication; created: boolean }> => {
    const owner = ownerOf(principal);
    const wallet = await findOwnedWallet(db, owner, walletId);
    if (!wallet) {
      throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
    }
    if (wallet.chain !== 'solana' || wallet.genesisHash !== genesisHash) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'that wallet is verified on another network; publish with a wallet verified on this one',
        [{ path: 'walletId', message: `expected genesis ${genesisHash}` }],
      );
    }
    const recomputed = manifestHashOf(
      version.canonicalManifest,
      STRATEGY_SCHEMA_VERSION,
      genesisHash,
    );
    if (recomputed !== version.manifestHash) {
      throw new ApiError(
        'INTERNAL',
        'the stored manifest does not hash to its recorded manifest hash; publication refused',
      );
    }
    const lineage = await lineageOf(programId, version);
    const binding = bindingOf(version, lineage);
    const args = registrationArgs(binding);
    const rules = checkRegisterArgs(args);
    if (!rules.ok) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `the registry program would refuse this version: ${registryErrorMessage(rules.error)}`,
        [{ path: 'legs', message: rules.error }],
      );
    }
    const address = recordAddress(programId, args.manifestHash);
    let blockhash: Awaited<ReturnType<SolanaRpcClient['getLatestBlockhash']>>;
    let rent: number;
    try {
      [blockhash, rent] = await Promise.all([
        rpc.getLatestBlockhash('finalized'),
        rpc.getMinimumBalanceForRentExemption(RECORD_SPACE),
      ]);
    } catch (error) {
      if (error instanceof SolanaRpcError) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'the network could not provide a recent blockhash; try again shortly',
        );
      }
      throw error;
    }
    const instruction = registerVersionInstruction({
      programId,
      publisher: wallet.address,
      args,
      parentRecord: lineage.parentRecordAddress,
    });
    const message = compileLegacyMessage({
      feePayer: wallet.address,
      instructions: [instruction],
      recentBlockhash: blockhash.blockhash,
    });
    const result = await createPublication(db, {
      versionId: version.id,
      strategyId: version.strategyId,
      ownerUserId: owner,
      operation: 'register',
      programId,
      genesisHash,
      recordAddress: address.address,
      publisherWalletId: wallet.id,
      publisherAddress: wallet.address,
      manifestHash: version.manifestHash,
      contentDigest: version.contentDigest,
      unsignedTransaction: bytesToBase64(unsignedTransaction(message)),
      message: bytesToBase64(serializeMessage(message)),
      recentBlockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      estimatedCostLamports: rent + Number(LAMPORTS_PER_SIGNATURE),
      now: now(),
    });
    if (result.outcome === 'created') {
      await audit(principal, 'strategy.publication.prepare', result.publication.id, requestId, {
        versionId: version.id,
        recordAddress: address.address,
        relation: lineage.relation,
      });
    }
    return {
      publication: await publicationOf(result.publication),
      created: result.outcome === 'created',
    };
  };

  return {
    async status() {
      const programId = config.registry.programId;
      const state = programId ? await readIndexerState(db, programId) : null;
      return {
        publicationEnabled: disabledReason() === null,
        disabledReason: disabledReason(),
        programId,
        network,
        schemaVersion: STRATEGY_SCHEMA_VERSION,
        recordSpace: RECORD_SPACE,
        maxLegs: MAX_LEGS,
        indexer: {
          lastRunAt: state?.lastRunAt?.toISOString() ?? null,
          lastObservedSlot: state?.lastObservedSlot ?? null,
          recordsIndexed: state?.recordsIndexed ?? 0,
        },
      };
    },

    async prepare(principal, strategyId, versionId, request, requestId) {
      const programId = requireProgram();
      const owner = ownerOf(principal);
      const strategy = await findStrategy(db, owner, strategyId);
      if (!strategy) {
        throw new ApiError('NOT_FOUND', 'no strategy with that id');
      }
      const version = await findVersion(db, strategyId, versionId);
      if (!version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      if (strategy.status === 'archived') {
        throw new ApiError(
          'VALIDATION_FAILED',
          'an archived strategy cannot be published; restore it first',
        );
      }
      if (version.moderation !== 'none') {
        throw new ApiError(
          'FORBIDDEN',
          'this version is withheld from publication by platform moderation',
        );
      }
      const latest = await latestPublication(db, owner, versionId, 'register');
      if (
        latest &&
        (latest.state === 'registered' ||
          latest.state === 'awaiting_signature' ||
          latest.state === 'submitted' ||
          latest.state === 'unknown')
      ) {
        return { publication: await publicationOf(await refreshRow(latest)), created: false };
      }
      return buildRegistration(principal, programId, version, request.walletId, requestId);
    },

    async prepareStatusChange(principal, strategyId, versionId, request, requestId) {
      const programId = requireProgram();
      const owner = ownerOf(principal);
      const strategy = await findStrategy(db, owner, strategyId);
      const version = strategy ? await findVersion(db, strategyId, versionId) : null;
      if (!strategy || !version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      if (version.publication !== 'registered' || version.publisherWallet === null) {
        throw new ApiError('VALIDATION_FAILED', 'only a registered version has an on-chain status');
      }
      const wallet = await findOwnedWallet(db, owner, request.walletId);
      if (!wallet) {
        throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
      }
      if (wallet.address !== version.publisherWallet) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'only the wallet that registered the version can change its status',
          [{ path: 'walletId', message: `the publisher is ${version.publisherWallet}` }],
        );
      }
      const operation: PublicationOperation =
        request.status === 'deprecated' ? 'deprecate' : 'reactivate';
      const latest = await latestPublication(db, owner, versionId, operation);
      if (
        latest &&
        (latest.state === 'awaiting_signature' ||
          latest.state === 'submitted' ||
          latest.state === 'unknown')
      ) {
        return { publication: await publicationOf(await refreshRow(latest)), created: false };
      }
      const record = await findRegistryRecordByManifestHash(db, programId, version.manifestHash);
      if (!record) {
        throw new ApiError('VALIDATION_FAILED', 'the registered record has not been indexed yet');
      }
      if (record.status === request.status) {
        throw new ApiError('VALIDATION_FAILED', `the record is already ${request.status}`);
      }
      let blockhash: Awaited<ReturnType<SolanaRpcClient['getLatestBlockhash']>>;
      try {
        blockhash = await rpc.getLatestBlockhash('finalized');
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            'the network could not provide a recent blockhash; try again shortly',
          );
        }
        throw error;
      }
      const message = compileLegacyMessage({
        feePayer: wallet.address,
        instructions: [
          setStatusInstruction({
            programId,
            publisher: wallet.address,
            record: record.address,
            status:
              request.status === 'deprecated' ? RECORD_STATUSES.deprecated : RECORD_STATUSES.active,
          }),
        ],
        recentBlockhash: blockhash.blockhash,
      });
      const result = await createPublication(db, {
        versionId: version.id,
        strategyId: version.strategyId,
        ownerUserId: owner,
        operation,
        programId,
        genesisHash,
        recordAddress: record.address,
        publisherWalletId: wallet.id,
        publisherAddress: wallet.address,
        manifestHash: version.manifestHash,
        contentDigest: version.contentDigest,
        unsignedTransaction: bytesToBase64(unsignedTransaction(message)),
        message: bytesToBase64(serializeMessage(message)),
        recentBlockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        estimatedCostLamports: Number(LAMPORTS_PER_SIGNATURE),
        now: now(),
      });
      if (result.outcome === 'created') {
        await audit(
          principal,
          `strategy.publication.${operation}`,
          result.publication.id,
          requestId,
          {
            versionId: version.id,
            recordAddress: record.address,
          },
        );
      }
      return {
        publication: await publicationOf(result.publication),
        created: result.outcome === 'created',
      };
    },

    async submit(principal, publicationId, request, requestId) {
      requireProgram();
      const owner = ownerOf(principal);
      const row = await findPublication(db, owner, publicationId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no publication with that id');
      }
      if (row.state !== 'awaiting_signature') {
        if (row.state === 'submitted' || row.state === 'registered' || row.state === 'unknown') {
          return publicationOf(await refreshRow(row));
        }
        throw new ApiError(
          'VALIDATION_FAILED',
          `this publication is ${row.state}; prepare a new one to try again`,
        );
      }
      let parsed: ReturnType<typeof parseTransaction>;
      try {
        parsed = parseTransaction(base64ToBytes(request.signedTransaction));
      } catch (error) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `the signed transaction is malformed: ${error instanceof Error ? error.message : 'unparseable'}`,
          [{ path: 'signedTransaction', message: 'not a legacy Solana transaction' }],
        );
      }
      if (!sameMessage(parsed.messageBytes, base64ToBytes(row.message))) {
        throw new ApiError(
          'SIGNATURE_MISMATCH',
          'the signed transaction is not the one that was prepared; nothing was submitted',
        );
      }
      const verification = verifyTransactionSignatures(parsed);
      const signer = verification.signers[0];
      if (!verification.allValid || !signer || signer.signer !== row.publisherAddress) {
        throw new ApiError(
          'SIGNATURE_MISMATCH',
          'the transaction is not validly signed by the publisher wallet; nothing was submitted',
        );
      }
      const signature = transactionSignature(parsed);
      const at = now();
      try {
        const height = await rpc.getBlockHeight('finalized');
        if (height > row.lastValidBlockHeight) {
          await updatePublication(
            db,
            row.id,
            {
              state: 'expired',
              lastCheckedAt: at,
              failure: {
                code: 'blockhash_expired',
                programErrorCode: null,
                programError: null,
                message:
                  'the transaction expired before it was submitted; prepare the publication again',
              },
            },
            at,
          );
          throw new ApiError(
            'PUBLICATION_EXPIRED',
            'the prepared transaction expired before it was submitted; prepare the publication again',
          );
        }
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
      }
      try {
        await rpc.sendTransaction(request.signedTransaction);
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
        // -32002 (preflight/simulation) and -32003 (signature verification) are verdicts on this
        // transaction; anything else is the node declining to serve, which leaves the prepared
        // transaction valid for another attempt.
        if (
          error.kind === 'rpc-error' &&
          error.rpcCode !== null &&
          ![-32002, -32003].includes(error.rpcCode)
        ) {
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            `the network declined the submission (${error.message}); submit the same signed transaction again shortly`,
          );
        }
        if (error.kind === 'rpc-error') {
          const failure = describeNodeRejection(error.message);
          const state = failure.code === 'blockhash_expired' ? 'expired' : 'failed';
          const updated = await updatePublication(
            db,
            row.id,
            { state, failure, signature, lastCheckedAt: at },
            at,
          );
          await audit(principal, 'strategy.publication.rejected', row.id, requestId, {
            code: failure.code,
            programErrorCode: failure.programErrorCode,
          });
          if (state === 'expired') {
            throw new ApiError('PUBLICATION_EXPIRED', failure.message);
          }
          return publicationOf(updated ?? row);
        }
        // Timeout or transport failure after the send: the node may have the transaction.
        const unknown = await updatePublication(
          db,
          row.id,
          { state: 'unknown', signature, submittedAt: at, lastCheckedAt: at },
          at,
        );
        await audit(principal, 'strategy.publication.submit', row.id, requestId, {
          signature,
          outcome: 'unknown',
        });
        return publicationOf(unknown ?? row);
      }
      const submitted = await updatePublication(
        db,
        row.id,
        { state: 'submitted', signature, submittedAt: at, lastCheckedAt: at },
        at,
      );
      await audit(principal, 'strategy.publication.submit', row.id, requestId, { signature });
      return publicationOf(submitted ?? row);
    },

    async getPublication(principal, publicationId) {
      const row = await findPublication(db, ownerOf(principal), publicationId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no publication with that id');
      }
      return publicationOf(await refreshRow(row));
    },

    async versionPublication(principal, strategyId, versionId) {
      const owner = ownerOf(principal);
      const strategy = await findStrategy(db, owner, strategyId);
      const version = strategy ? await findVersion(db, strategyId, versionId) : null;
      if (!strategy || !version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      const latest = await latestPublication(db, owner, versionId, 'register');
      if (!latest) {
        throw new ApiError('NOT_FOUND', 'this version has not been prepared for publication');
      }
      return publicationOf(await refreshRow(latest));
    },

    async versionStatusChange(principal, strategyId, versionId) {
      const owner = ownerOf(principal);
      const strategy = await findStrategy(db, owner, strategyId);
      const version = strategy ? await findVersion(db, strategyId, versionId) : null;
      if (!strategy || !version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      const latest = await latestPublication(db, owner, versionId, ['deprecate', 'reactivate']);
      if (!latest) {
        throw new ApiError('NOT_FOUND', 'no status change has been prepared for this version');
      }
      return publicationOf(await refreshRow(latest));
    },

    async refreshPublication(publicationId) {
      const row = await findPublicationById(db, publicationId);
      return row ? publicationOf(await refreshRow(row)) : null;
    },

    async publicVersion(strategyId, versionId) {
      requireIndexedProgram();
      const read = await findPublicVersion(db, strategyId, versionId);
      if (!read || !read.publication?.signature || !read.publication.evidence) {
        throw new ApiError('NOT_FOUND', 'no registered version with that id');
      }
      return publicVersionOf(read.version, read.record, read.publication.evidence);
    },

    async publicStrategy(strategyId) {
      requireIndexedProgram();
      const read = await findPublicStrategy(db, strategyId);
      if (!read) {
        throw new ApiError('NOT_FOUND', 'no strategy with a registered version and that id');
      }
      const newest = read.versions[0];
      return {
        strategyId: read.strategy.id,
        title: newest?.version.title ?? '',
        followerCount: await countFollowers(db, strategyId),
        forkOf:
          read.strategy.forkOfStrategyId && read.strategy.forkOfVersionId
            ? {
                strategyId: read.strategy.forkOfStrategyId,
                versionId: read.strategy.forkOfVersionId,
              }
            : null,
        versions: read.versions.map(({ version, record }) => ({
          versionId: version.id,
          versionNumber: version.versionNumber,
          title: version.title,
          manifestHash: version.manifestHash,
          recordAddress: record.address,
          status: record.status as 'active' | 'deprecated',
          registeredAt: new Date(record.registeredUnixTime * 1000).toISOString(),
          frozenAt: version.frozenAt.toISOString(),
        })),
      };
    },

    async record(address) {
      requireIndexedProgram();
      const row = await findRegistryRecord(db, address);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no indexed registry record at that address');
      }
      return recordOf(row);
    },
  };

  async function recordOf(row: RegistryRecordRow): Promise<RegistryRecord> {
    const version = row.versionId ? await findVersionById(db, row.versionId) : null;
    const visible =
      version && version.publication === 'registered' && version.moderation === 'none';
    return {
      address: row.address,
      programId: row.programId,
      network: { cluster, genesisHash: row.genesisHash },
      publisher: row.publisher,
      status: row.status as 'active' | 'deprecated',
      layoutVersion: row.layoutVersion,
      schemaVersion: row.schemaVersion,
      relation: row.relation as RegistryRecord['relation'],
      parentManifestHash: row.parentManifestHash,
      manifestHash: row.manifestHash,
      contentDigest: row.contentDigest,
      cashWeightBps: row.cashWeightBps,
      legs: row.legs,
      registeredSlot: row.registeredSlot,
      registeredAt: new Date(row.registeredUnixTime * 1000).toISOString(),
      statusUpdatedSlot: row.statusUpdatedSlot,
      version:
        visible && version
          ? {
              strategyId: version.strategyId,
              versionId: version.id,
              versionNumber: version.versionNumber,
            }
          : null,
      observedSlot: row.observedSlot,
      observedAt: row.observedAt.toISOString(),
      explorerUrl: explorerUrl(cluster, 'address', row.address),
    };
  }

  function publicVersionOf(
    version: StrategyVersionRow,
    record: RegistryRecordRow,
    evidence: RegistrationEvidence,
  ): PublicVersion {
    const decoded: VersionRecord = decodeVersionRecord(base64ToBytes(record.data));
    const recomputed = manifestHashOf(
      version.canonicalManifest,
      STRATEGY_SCHEMA_VERSION,
      genesisHash,
    );
    const comparison = compareRecordToVersion(
      decoded,
      bindingOf(version, {
        relation: relationOf(decoded.relation),
        parentManifestHash:
          decoded.relation === RELATIONS.none ? null : bytesToHex(decoded.parentManifestHash),
      }),
    );
    const manifestHashMatches =
      recomputed === version.manifestHash && recomputed === bytesToHex(decoded.manifestHash);
    return {
      strategyId: version.strategyId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      schemaVersion: STRATEGY_SCHEMA_VERSION,
      kind: version.kind as PublicVersion['kind'],
      title: version.title,
      thesis: version.thesis,
      thesisId: version.thesisId,
      legs: version.legs.map((leg) => ({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        companyName: leg.companyName,
        issuer: leg.issuer,
        mint: leg.admission.mint,
        tokenProgram: leg.admission.tokenProgram,
        weightBps: leg.weightBps,
      })),
      cashWeightBps: version.cashWeightBps,
      maintenance: version.maintenance,
      disclosures: version.disclosures,
      references: version.references,
      parentVersionId: version.parentVersionId,
      forkOf:
        version.forkOfStrategyId && version.forkOfVersionId
          ? { strategyId: version.forkOfStrategyId, versionId: version.forkOfVersionId }
          : null,
      canonicalManifest: version.canonicalManifest,
      manifestHash: version.manifestHash,
      contentDigest: version.contentDigest,
      registration: {
        ...evidence,
        status: record.status as 'active' | 'deprecated',
        recordUrl: explorerUrl(cluster, 'address', record.address),
      },
      verification: {
        manifestHashMatches,
        contentMatches: comparison.matches && decoded.publisher === record.publisher,
        recomputedManifestHash: recomputed,
        mismatches: [...(manifestHashMatches ? [] : ['manifestHash']), ...comparison.mismatches],
        checkedAt: now().toISOString(),
      },
      deprecatedBy: version.deprecatedBy,
      frozenAt: version.frozenAt.toISOString(),
    };
  }
}
