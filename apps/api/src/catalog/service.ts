import type { Principal } from '@markov/auth';
import {
  availabilityFor,
  compareMint,
  contentHash,
  type ExistingInstrument,
  isPubliclyVisible,
  parseIssuerFeed,
  parseMintAccount,
  planIngestion,
  productFingerprint,
  REFERENCE_PRICE_STALE_AFTER_MS,
} from '@markov/catalog';
import type { MarkovConfig } from '@markov/config';
import type {
  IngestionReport,
  IngestionSource,
  Instrument,
  InstrumentDecision,
  InstrumentDecisionKind,
  InstrumentDetail,
  InstrumentListResponse,
  InstrumentStatus,
  Issuer,
  IssuerSnapshot,
  MintVerification,
  MintVerificationResult,
  OnChainMint,
} from '@markov/contracts';
import {
  applyIngestion,
  type Database,
  findInstrument,
  type IngestionWrite,
  type InstrumentDecisionRow,
  type InstrumentRow,
  InstrumentStatusConflictError,
  type IssuerSnapshotRow,
  latestMintVerification,
  listInstrumentDecisions,
  listInstruments,
  listInstrumentsForPlanning,
  listIssuerSnapshots,
  type MintVerificationRow,
  recordAuditEvent,
  recordInstrumentDecision,
  recordIssuerSnapshot,
  recordMintVerification,
} from '@markov/db';
import {
  createPrestocksFixtureSource,
  createPrestocksUrlSource,
  type IssuerSource,
  IssuerSourceError,
} from '@markov/issuer-prestocks';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { ApiError } from '../errors.js';

export interface CatalogServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  /** Primary first; verification uses the first client that answers. */
  readonly rpcClients: readonly SolanaRpcClient[];
  /** Overridable for tests; defaults to the fixture and configured-URL sources of the issuer package. */
  readonly sourceFor?: (issuer: Issuer, source: IngestionSource) => IssuerSource;
  readonly now?: () => Date;
}

export interface ListQuery {
  readonly q?: string | undefined;
  readonly issuer?: Issuer | undefined;
  readonly kind?: Instrument['kind'] | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly status?: InstrumentStatus | undefined;
}

export interface DecisionInput {
  readonly decision: InstrumentDecisionKind;
  readonly reason: string;
  readonly evidence: Record<string, string>;
}

export interface CatalogService {
  ingest(
    principal: Principal,
    request: { issuer: Issuer; source: IngestionSource },
    requestId: string,
  ): Promise<IngestionReport>;
  listPublic(query: ListQuery): Promise<InstrumentListResponse>;
  getPublic(instrumentId: string): Promise<InstrumentDetail>;
  listForOperator(query: ListQuery): Promise<InstrumentListResponse>;
  getForOperator(instrumentId: string): Promise<InstrumentDetail>;
  verifyMint(
    principal: Principal,
    instrumentId: string,
    requestId: string,
  ): Promise<MintVerification>;
  decide(
    principal: Principal,
    instrumentId: string,
    input: DecisionInput,
    requestId: string,
  ): Promise<InstrumentDecision>;
  listDecisions(instrumentId: string): Promise<InstrumentDecision[]>;
  listSnapshots(issuer: Issuer | null): Promise<IssuerSnapshot[]>;
}

/** Allowed lifecycle moves. Admission and resumption additionally need a current, matching mint verification. */
const TRANSITIONS: Readonly<
  Record<InstrumentStatus, Partial<Record<InstrumentDecisionKind, InstrumentStatus>>>
> = {
  quarantined: { admit: 'admitted', reject: 'rejected' },
  admitted: { pause: 'paused', delist: 'delisted' },
  paused: { resume: 'admitted', reject: 'rejected', delist: 'delisted' },
  rejected: {},
  delisted: {},
};

const PUBLIC_STATUSES: readonly InstrumentStatus[] = ['admitted', 'paused'];
const ALL_STATUSES: readonly InstrumentStatus[] = [
  'quarantined',
  'admitted',
  'paused',
  'rejected',
  'delisted',
];

function toSnapshot(row: IssuerSnapshotRow): IssuerSnapshot {
  return {
    snapshotId: row.id,
    issuer: row.issuer as Issuer,
    source: row.source as IngestionSource,
    sourceRef: row.sourceRef,
    fetchedAt: row.fetchedAt.toISOString(),
    contentHash: row.contentHash,
    schemaVersion: row.schemaVersion,
    itemCount: row.itemCount,
    status: row.status as IssuerSnapshot['status'],
    rejectionReason: row.rejectionReason,
    createdBy: row.createdBy,
  };
}

function toVerification(row: MintVerificationRow): MintVerification {
  return {
    verificationId: row.id,
    instrumentId: row.instrumentId,
    verifiedAt: row.verifiedAt.toISOString(),
    rpcHost: row.rpcHost,
    slot: row.slot,
    result: row.result as MintVerificationResult,
    onChain: row.onChain ?? null,
    mismatches: row.mismatches,
  };
}

function toDecision(row: InstrumentDecisionRow): InstrumentDecision {
  return {
    decisionId: row.id,
    instrumentId: row.instrumentId,
    decision: row.decision as InstrumentDecisionKind,
    reason: row.reason,
    evidence: row.evidence,
    previousStatus: row.previousStatus as InstrumentStatus,
    newStatus: row.newStatus as InstrumentStatus,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
  };
}

function toInstrument(row: InstrumentRow, now: Date): Instrument {
  const status = row.status as InstrumentStatus;
  const price = row.referencePrice;
  return {
    instrumentId: row.id,
    issuer: row.issuer as Issuer,
    issuerProductId: row.issuerProductId,
    symbol: row.symbol,
    name: row.name,
    companyName: row.companyName,
    kind: row.kind as Instrument['kind'],
    chain: 'solana',
    genesisHash: row.genesisHash,
    mint: row.mint,
    decimals: row.decimals,
    tokenProgram: row.tokenProgram as Instrument['tokenProgram'],
    status,
    statusReason: row.statusReason,
    metadata: { website: row.website, description: row.description },
    referencePrice: price
      ? {
          ...price,
          // Staleness is a property of now, not of ingestion time.
          stale:
            now.getTime() - new Date(price.observedAt).getTime() > REFERENCE_PRICE_STALE_AFTER_MS,
        }
      : null,
    availability: availabilityFor(status),
    admittedAt: row.admittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toExisting(row: InstrumentRow): ExistingInstrument {
  return {
    instrumentId: row.id,
    issuerProductId: row.issuerProductId,
    symbol: row.symbol,
    mint: row.mint,
    decimals: row.decimals,
    status: row.status as InstrumentStatus,
    fingerprint: row.fingerprint,
  };
}

export function createCatalogService(deps: CatalogServiceDeps): CatalogService {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const isDev = config.markovEnv === 'local' || config.markovEnv === 'test';

  const defaultSourceFor = (issuer: Issuer, source: IngestionSource): IssuerSource => {
    if (issuer !== 'prestocks') {
      throw new ApiError(
        'VALIDATION_FAILED',
        `issuer ${issuer} ingestion arrives with a later session`,
      );
    }
    if (source === 'fixture') {
      if (!isDev) {
        throw new ApiError('FORBIDDEN', 'fixture sources are refused outside local and test');
      }
      return createPrestocksFixtureSource('default');
    }
    if (config.catalog.prestocksFeedUrl === null) {
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        'no PreStocks feed is configured (PRESTOCKS_FEED_URL); the live endpoint is an open decision',
      );
    }
    return createPrestocksUrlSource({ url: config.catalog.prestocksFeedUrl, allowInsecure: isDev });
  };
  const sourceFor = deps.sourceFor ?? defaultSourceFor;

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown>,
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType,
      targetId,
      requestId,
      details,
    });

  const detailOf = async (row: InstrumentRow): Promise<InstrumentDetail> => {
    const latest = await latestMintVerification(db, row.id);
    return {
      ...toInstrument(row, now()),
      latestMintVerification: latest ? toVerification(latest) : null,
    };
  };

  const listWith = async (query: ListQuery, statuses: readonly InstrumentStatus[]) => {
    const page = await listInstruments(db, {
      issuer: query.issuer,
      kind: query.kind,
      statuses,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
    const at = now();
    return {
      instruments: page.rows.map((row) => toInstrument(row, at)),
      nextCursor: page.nextCursor,
    };
  };

  return {
    async ingest(principal, request, requestId) {
      const source = sourceFor(request.issuer, request.source);
      const fetchedAt = now();
      let fetched: Awaited<ReturnType<IssuerSource['fetch']>>;
      try {
        fetched = await source.fetch();
      } catch (error) {
        const reason =
          error instanceof IssuerSourceError ? `${error.kind}: ${error.message}` : 'fetch failed';
        await recordIssuerSnapshot(db, {
          issuer: request.issuer,
          source: request.source,
          sourceRef: request.source === 'fixture' ? 'fixture:default' : 'configured url',
          fetchedAt,
          contentHash: contentHash(null),
          schemaVersion: null,
          itemCount: 0,
          status: 'rejected',
          rejectionReason: reason.slice(0, 1000),
          createdBy: principal.id,
        });
        throw new ApiError('PROVIDER_UNAVAILABLE', `issuer source failed: ${reason}`);
      }
      const parsed = parseIssuerFeed(fetched.payload, request.issuer);
      if (!parsed.ok) {
        // Schema drift rejects the whole snapshot; nothing already admitted changes.
        const snapshot = await recordIssuerSnapshot(db, {
          issuer: request.issuer,
          source: request.source,
          sourceRef: fetched.sourceRef,
          fetchedAt: fetched.fetchedAt,
          contentHash: contentHash(fetched.payload),
          schemaVersion: null,
          itemCount: 0,
          status: 'rejected',
          rejectionReason: parsed.reason.slice(0, 1000),
          createdBy: principal.id,
        });
        await audit(
          principal,
          'catalog.ingestion.rejected',
          'issuer_snapshot',
          snapshot.id,
          requestId,
          {
            issuer: request.issuer,
            reason: parsed.reason.slice(0, 500),
          },
        );
        return {
          snapshot: toSnapshot(snapshot),
          products: [],
          counts: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, paused: 0 },
        };
      }
      const snapshot = await recordIssuerSnapshot(db, {
        issuer: request.issuer,
        source: request.source,
        sourceRef: fetched.sourceRef,
        fetchedAt: fetched.fetchedAt,
        contentHash: contentHash(fetched.payload),
        schemaVersion: parsed.feed.schemaVersion,
        itemCount: parsed.feed.products.length,
        status: 'accepted',
        rejectionReason: null,
        createdBy: principal.id,
      });
      const existing = (await listInstrumentsForPlanning(db, request.issuer)).map(toExisting);
      const plan = planIngestion(existing, parsed.feed.products, fetchedAt);
      const writes: IngestionWrite[] = [];
      for (const action of plan.actions) {
        switch (action.kind) {
          case 'insert':
            writes.push({
              kind: 'insert',
              product: action.product,
              fingerprint: productFingerprint(action.product),
              status: action.status,
              reasons: action.reasons,
            });
            break;
          case 'update':
            writes.push({
              kind: 'update',
              instrumentId: action.instrumentId,
              product: action.product,
              fingerprint: productFingerprint(action.product),
              newStatus: action.newStatus,
              reasons: action.reasons,
            });
            break;
          case 'invalid':
            if (action.instrumentId && action.currentStatus) {
              writes.push({
                kind: 'invalid',
                instrumentId: action.instrumentId,
                currentStatus: action.currentStatus,
                reasons: action.reasons,
              });
            }
            break;
          case 'unchanged':
            break;
        }
      }
      await applyIngestion(db, {
        issuer: request.issuer,
        genesisHash: deps.genesisHash,
        snapshotId: snapshot.id,
        writes,
        now: fetchedAt,
      });
      await audit(
        principal,
        'catalog.ingestion.applied',
        'issuer_snapshot',
        snapshot.id,
        requestId,
        {
          issuer: request.issuer,
          source: request.source,
          counts: plan.counts,
        },
      );
      return { snapshot: toSnapshot(snapshot), products: plan.products, counts: plan.counts };
    },

    listPublic(query) {
      return listWith(query, PUBLIC_STATUSES);
    },

    async getPublic(instrumentId) {
      const row = await findInstrument(db, instrumentId);
      if (!row || !isPubliclyVisible(row.status as InstrumentStatus)) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      return detailOf(row);
    },

    listForOperator(query) {
      return listWith(query, query.status ? [query.status] : ALL_STATUSES);
    },

    async getForOperator(instrumentId) {
      const row = await findInstrument(db, instrumentId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      return detailOf(row);
    },

    async verifyMint(principal, instrumentId, requestId) {
      const row = await findInstrument(db, instrumentId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      const client = deps.rpcClients[0];
      if (!client) {
        throw new ApiError('SERVICE_NOT_READY', 'no rpc client configured');
      }
      const verifiedAt = now();
      let result: MintVerificationResult;
      let onChain: OnChainMint | null = null;
      let mismatches: string[] = [];
      let slot: number | null = null;
      try {
        const info = await client.getAccountInfo(row.mint, config.solana.readCommitment);
        slot = info.slot;
        if (info.account === null) {
          result = 'not_found';
          mismatches = ['no account exists at the mint address'];
        } else {
          const parsed = parseMintAccount(info.account.owner, info.account.data);
          if (!parsed.ok) {
            result = 'not_a_mint';
            mismatches = [parsed.detail];
          } else {
            onChain = parsed.mint;
            mismatches = compareMint(
              {
                decimals: row.decimals,
                tokenProgram: row.tokenProgram as Instrument['tokenProgram'],
              },
              parsed.mint,
            );
            result = mismatches.length === 0 ? 'verified' : 'mismatch';
          }
        }
      } catch (error) {
        result = 'error';
        mismatches = [
          error instanceof SolanaRpcError ? `${error.kind}: ${error.message}` : 'rpc call failed',
        ];
      }
      const record = await recordMintVerification(db, {
        instrumentId,
        rpcHost: client.host,
        slot,
        result,
        onChain,
        mismatches,
        verifiedAt,
      });
      await audit(principal, 'catalog.mint.verified', 'instrument', instrumentId, requestId, {
        result,
        mismatches,
        rpcHost: client.host,
      });
      return toVerification(record);
    },

    async decide(principal, instrumentId, input, requestId) {
      const row = await findInstrument(db, instrumentId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      const status = row.status as InstrumentStatus;
      const newStatus = TRANSITIONS[status][input.decision];
      if (newStatus === undefined) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `decision ${input.decision} is not allowed from status ${status}`,
          [
            {
              path: 'decision',
              message: `allowed: ${Object.keys(TRANSITIONS[status]).join(', ') || 'none'}`,
            },
          ],
        );
      }
      if (newStatus === 'admitted') {
        const latest = await latestMintVerification(db, instrumentId);
        const current = latest?.result === 'verified' && latest.verifiedAt >= row.updatedAt;
        if (!current) {
          throw new ApiError(
            'ADMISSION_BLOCKED',
            'admission needs a matching mint verification recorded after the last upstream change',
            [
              {
                path: 'mintVerification',
                message: latest
                  ? `latest result: ${latest.result} at ${latest.verifiedAt.toISOString()}`
                  : 'no verification recorded',
              },
            ],
          );
        }
      }
      let decision: InstrumentDecisionRow;
      try {
        decision = await recordInstrumentDecision(db, {
          instrumentId,
          decision: input.decision,
          reason: input.reason,
          evidence: input.evidence,
          decidedBy: principal.id,
          expectedPreviousStatus: status,
          newStatus,
          decidedAt: now(),
        });
      } catch (error) {
        if (error instanceof InstrumentStatusConflictError) {
          throw new ApiError(
            'IDEMPOTENCY_CONFLICT',
            'instrument status changed concurrently; reload and decide again',
          );
        }
        throw error;
      }
      await audit(
        principal,
        `catalog.instrument.${input.decision}`,
        'instrument',
        instrumentId,
        requestId,
        {
          previousStatus: status,
          newStatus,
          reason: input.reason,
          evidence: input.evidence,
        },
      );
      return toDecision(decision);
    },

    async listDecisions(instrumentId) {
      if (!(await findInstrument(db, instrumentId))) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      return (await listInstrumentDecisions(db, instrumentId)).map(toDecision);
    },

    async listSnapshots(issuer) {
      return (await listIssuerSnapshots(db, issuer)).map(toSnapshot);
    },
  };
}
