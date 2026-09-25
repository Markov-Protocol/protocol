import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type DraftValidation,
  type FreezeRequest,
  type InstanceCreateRequest,
  type InstanceListResponse,
  type PortfolioInstance,
  STRATEGY_KINDS,
  STRATEGY_SCHEMA_VERSION,
  STRATEGY_TOTAL_BPS,
  type Strategy,
  type StrategyCreateRequest,
  type StrategyDetail,
  type StrategyDraft,
  type StrategyDraftContent,
  type StrategyDraftSaveRequest,
  type StrategyLimits,
  type StrategyListResponse,
  type StrategyStatus,
  type StrategyVersion,
  type VersionDiff,
  type VersionListResponse,
  type VersionSummary,
} from '@markov/contracts';
import {
  createInstance,
  createStrategy,
  type Database,
  findInstance,
  findInstrumentsByIds,
  findPublicVersion,
  findStrategy,
  findVersion,
  findVersionById,
  freezeVersion,
  latestVerificationsFor,
  listInstances,
  listStrategies,
  listVersions,
  listWallets,
  type PortfolioInstanceRow,
  pinInstance,
  readDraft,
  recordAuditEvent,
  type StrategyDraftRow,
  type StrategyRow,
  type StrategyVersionRow,
  saveDraft,
  updateStrategyStatus,
} from '@markov/db';
import { ceilingLimits } from '@markov/policy';
import {
  canonicalContent,
  canonicalManifest,
  contentDigestOf,
  diffVersions,
  disclosuresOf,
  type FreezeEvidence,
  freezeLegs,
  type KnownInstrument,
  manifestHashOf,
  validateDraft,
} from '@markov/strategy';
import { ApiError } from '../errors.js';

export interface StrategyServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  readonly now?: () => Date;
}

export interface StrategyService {
  limits(): StrategyLimits;
  create(
    principal: Principal,
    request: StrategyCreateRequest,
    requestId: string,
  ): Promise<StrategyDetail>;
  list(principal: Principal): Promise<StrategyListResponse>;
  get(principal: Principal, strategyId: string): Promise<StrategyDetail>;
  updateStatus(
    principal: Principal,
    strategyId: string,
    status: StrategyStatus,
    requestId: string,
  ): Promise<Strategy>;
  saveDraft(
    principal: Principal,
    strategyId: string,
    request: StrategyDraftSaveRequest,
    requestId: string,
  ): Promise<StrategyDraft>;
  freeze(
    principal: Principal,
    strategyId: string,
    request: FreezeRequest,
    requestId: string,
  ): Promise<{ version: StrategyVersion; created: boolean }>;
  listVersions(principal: Principal, strategyId: string): Promise<VersionListResponse>;
  getVersion(principal: Principal, strategyId: string, versionId: string): Promise<StrategyVersion>;
  diff(
    principal: Principal,
    strategyId: string,
    versionId: string,
    againstVersionId: string,
  ): Promise<VersionDiff>;
  fork(
    principal: Principal,
    strategyId: string,
    versionId: string,
    requestId: string,
  ): Promise<StrategyDetail>;
  createInstance(
    principal: Principal,
    request: InstanceCreateRequest,
    requestId: string,
  ): Promise<PortfolioInstance>;
  listInstances(principal: Principal): Promise<InstanceListResponse>;
  getInstance(principal: Principal, instanceId: string): Promise<PortfolioInstance>;
  pin(
    principal: Principal,
    instanceId: string,
    versionId: string,
    requestId: string,
  ): Promise<PortfolioInstance>;
}

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

function summaryOf(row: StrategyVersionRow): VersionSummary {
  return {
    versionId: row.id,
    strategyId: row.strategyId,
    versionNumber: row.versionNumber,
    title: row.title,
    manifestHash: row.manifestHash,
    publication: row.publication as StrategyVersion['publication'],
    deprecatedBy: row.deprecatedBy,
    frozenAt: row.frozenAt.toISOString(),
  };
}

function strategyOf(
  row: StrategyRow,
  current: StrategyVersionRow | null,
  draftRevision: number,
): Strategy {
  return {
    strategyId: row.id,
    ownerUserId: row.ownerUserId,
    status: row.status as StrategyStatus,
    forkOf:
      row.forkOfStrategyId && row.forkOfVersionId
        ? { strategyId: row.forkOfStrategyId, versionId: row.forkOfVersionId }
        : null,
    currentVersion: current ? summaryOf(current) : null,
    draftRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function versionOf(row: StrategyVersionRow): StrategyVersion {
  return {
    versionId: row.id,
    strategyId: row.strategyId,
    versionNumber: row.versionNumber,
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    kind: row.kind as StrategyVersion['kind'],
    authorPrincipal: row.authorPrincipal,
    publisherWallet: row.publisherWallet,
    parentVersionId: row.parentVersionId,
    forkOf:
      row.forkOfStrategyId && row.forkOfVersionId
        ? { strategyId: row.forkOfStrategyId, versionId: row.forkOfVersionId }
        : null,
    title: row.title,
    thesis: row.thesis,
    thesisId: row.thesisId,
    legs: row.legs,
    cashWeightBps: row.cashWeightBps,
    maintenance: row.maintenance,
    disclosures: row.disclosures,
    references: row.references,
    manifestHash: row.manifestHash,
    contentDigest: row.contentDigest,
    publication: row.publication as StrategyVersion['publication'],
    moderation: row.moderation as StrategyVersion['moderation'],
    deprecatedBy: row.deprecatedBy,
    frozenAt: row.frozenAt.toISOString(),
  };
}

function diffable(row: StrategyVersionRow) {
  return {
    versionId: row.id,
    title: row.title,
    thesis: row.thesis,
    legs: row.legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      symbol: leg.symbol,
      weightBps: leg.weightBps,
    })),
    cashWeightBps: row.cashWeightBps,
    maintenance: row.maintenance,
    references: row.references,
  };
}

/** Recipes: exact, versioned, owner-scoped. Nothing here spends, quotes or implies suitability. */
export function createStrategyService(deps: StrategyServiceDeps): StrategyService {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
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

  const limits = (): StrategyLimits => {
    const { ceiling, source } = ceilingLimits(config.execution.betaCaps);
    return {
      schemaVersion: STRATEGY_SCHEMA_VERSION,
      kinds: [...STRATEGY_KINDS],
      totalBps: STRATEGY_TOTAL_BPS,
      maxLegs: config.strategies.maxLegs,
      maxIssuerConcentrationBps: ceiling.maxIssuerConcentrationBps,
      maxCompanyConcentrationBps: ceiling.maxCompanyConcentrationBps,
      ceilingSource: source,
    };
  };

  const knownInstruments = async (content: StrategyDraftContent) => {
    const rows = await findInstrumentsByIds(
      db,
      content.legs.map((leg) => leg.instrumentId),
    );
    const instruments = new Map<string, KnownInstrument>(
      rows.map((row) => [
        row.id,
        {
          instrumentId: row.id,
          status: row.status,
          issuer: row.issuer as KnownInstrument['issuer'],
          mint: row.mint,
          tokenProgram: row.tokenProgram,
          companyName: row.companyName,
          symbol: row.symbol,
        },
      ]),
    );
    return { rows, instruments };
  };

  const validation = async (content: StrategyDraftContent): Promise<DraftValidation> => {
    const { instruments } = await knownInstruments(content);
    const current = limits();
    const result = validateDraft(content, { instruments, limits: current });
    return {
      valid: result.valid,
      issues: result.issues,
      totals: result.totals,
      limits: current,
      evaluatedAt: now().toISOString(),
    };
  };

  const draftOf = async (row: StrategyDraftRow): Promise<StrategyDraft> => ({
    strategyId: row.strategyId,
    revision: row.revision,
    content: row.content,
    validation: await validation(row.content),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  const ownedStrategy = async (principal: Principal, strategyId: string): Promise<StrategyRow> => {
    const row = await findStrategy(db, ownerOf(principal), strategyId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no strategy with that id');
    }
    return row;
  };

  const detailOf = async (row: StrategyRow): Promise<StrategyDetail> => {
    const [draft, versions] = await Promise.all([readDraft(db, row.id), listVersions(db, row.id)]);
    const current = versions.find((version) => version.id === row.currentVersionId) ?? null;
    return {
      strategy: strategyOf(row, current, draft.revision),
      draft: await draftOf(draft),
      versions: versions.map(summaryOf),
    };
  };

  const instanceOf = async (row: PortfolioInstanceRow): Promise<PortfolioInstance> => {
    const pinned = await findVersionById(db, row.pinnedVersionId);
    return {
      instanceId: row.id,
      ownerUserId: row.ownerUserId,
      strategyId: row.strategyId,
      pinnedVersionId: row.pinnedVersionId,
      pinnedVersionNumber: pinned?.versionNumber ?? 0,
      proposedVersionId: row.proposedVersionId,
      walletId: row.walletId,
      label: row.label,
      status: row.status as PortfolioInstance['status'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  const conflict = (revision: number) =>
    new ApiError('IDEMPOTENCY_CONFLICT', 'the draft changed elsewhere; reload it before saving', [
      { path: 'ifRevision', message: `the current revision is ${revision}` },
    ]);

  return {
    limits,

    async create(principal, request, requestId) {
      const created = await createStrategy(db, {
        ownerUserId: ownerOf(principal),
        content: request.content,
        forkOf: null,
        now: now(),
      });
      await audit(principal, 'strategy.create', 'strategy', created.strategy.id, requestId, {
        legs: request.content.legs.length,
      });
      return detailOf(created.strategy);
    },

    async list(principal) {
      const rows = await listStrategies(db, ownerOf(principal));
      return {
        strategies: rows.map(({ strategy, draft, current }) => ({
          ...strategyOf(strategy, current, draft.revision),
          title: current?.title ?? draft.content.title,
        })),
      };
    },

    async get(principal, strategyId) {
      return detailOf(await ownedStrategy(principal, strategyId));
    },

    async updateStatus(principal, strategyId, status, requestId) {
      const updated = await updateStrategyStatus(db, {
        ownerUserId: ownerOf(principal),
        strategyId,
        status,
        now: now(),
      });
      if (!updated) {
        throw new ApiError('NOT_FOUND', 'no strategy with that id');
      }
      await audit(principal, 'strategy.status', 'strategy', strategyId, requestId, { status });
      const [draft, current] = await Promise.all([
        readDraft(db, updated.id),
        updated.currentVersionId
          ? findVersionById(db, updated.currentVersionId)
          : Promise.resolve(null),
      ]);
      return strategyOf(updated, current, draft.revision);
    },

    async saveDraft(principal, strategyId, request, requestId) {
      const strategy = await ownedStrategy(principal, strategyId);
      if (strategy.status === 'archived') {
        throw new ApiError(
          'VALIDATION_FAILED',
          'an archived strategy takes no edits; restore it first',
        );
      }
      const result = await saveDraft(db, {
        ownerUserId: strategy.ownerUserId,
        strategyId: strategy.id,
        content: request.content,
        ifRevision: request.ifRevision ?? null,
        now: now(),
      });
      if (result.outcome === 'not_found') {
        throw new ApiError('NOT_FOUND', 'no strategy with that id');
      }
      if (result.outcome === 'conflict') {
        throw conflict(result.draft.revision);
      }
      await audit(principal, 'strategy.draft.save', 'strategy', strategy.id, requestId, {
        revision: result.draft.revision,
      });
      return draftOf(result.draft);
    },

    async freeze(principal, strategyId, request, requestId) {
      const owner = ownerOf(principal);
      const author = `${principal.class}:${principal.id}`;
      const result = await freezeVersion(db, {
        ownerUserId: owner,
        strategyId,
        ifRevision: request.ifRevision ?? null,
        now: now(),
        build: async (draft, strategy, versionNumber) => {
          const content = draft.content;
          const { rows, instruments } = await knownInstruments(content);
          const current = limits();
          const validated = validateDraft(content, { instruments, limits: current });
          if (!validated.valid) {
            throw new ApiError(
              'VALIDATION_FAILED',
              'the draft breaks a recipe rule; fix it before freezing',
              validated.issues
                .filter((issue) => issue.severity === 'error')
                .map((issue) => ({ path: issue.path, message: issue.message })),
            );
          }
          const verifications = await latestVerificationsFor(
            db,
            rows.map((row) => row.id),
          );
          const evidence = new Map<string, FreezeEvidence>(
            rows.map((row) => {
              const verification = verifications.get(row.id);
              return [
                row.id,
                {
                  admittedAt: row.admittedAt?.toISOString() ?? null,
                  verificationId: verification?.id ?? null,
                  verifiedAt: verification?.verifiedAt.toISOString() ?? null,
                  decimals: row.decimals,
                  genesisHash: row.genesisHash,
                },
              ];
            }),
          );
          const legs = freezeLegs(content, instruments, evidence);
          const forkOf =
            strategy.forkOfStrategyId && strategy.forkOfVersionId
              ? { strategyId: strategy.forkOfStrategyId, versionId: strategy.forkOfVersionId }
              : null;
          const economic = {
            schemaVersion: STRATEGY_SCHEMA_VERSION,
            kind: content.kind,
            genesisHash: deps.genesisHash,
            title: content.title,
            thesis: content.thesis,
            thesisId: content.thesisId,
            legs: legs.map((leg) => ({
              instrumentId: leg.instrumentId,
              mint: leg.admission.mint,
              tokenProgram: leg.admission.tokenProgram,
              weightBps: leg.weightBps,
            })),
            cashWeightBps: content.cashWeightBps,
            maintenance: content.maintenance,
            references: content.references,
          };
          const canonical = canonicalManifest({
            ...economic,
            strategyId: strategy.id,
            versionNumber,
            parentVersionId: strategy.currentVersionId,
            forkOf,
          });
          return {
            schemaVersion: STRATEGY_SCHEMA_VERSION,
            kind: content.kind,
            authorPrincipal: author,
            title: content.title,
            thesis: content.thesis,
            thesisId: content.thesisId,
            legs,
            cashWeightBps: content.cashWeightBps,
            maintenance: content.maintenance,
            disclosures: disclosuresOf(legs),
            references: [...content.references],
            canonicalManifest: canonical,
            manifestHash: manifestHashOf(canonical, STRATEGY_SCHEMA_VERSION, deps.genesisHash),
            contentDigest: contentDigestOf(
              canonicalContent(economic),
              STRATEGY_SCHEMA_VERSION,
              deps.genesisHash,
            ),
          };
        },
      });
      switch (result.outcome) {
        case 'not_found':
          throw new ApiError('NOT_FOUND', 'no strategy with that id');
        case 'archived':
          throw new ApiError(
            'VALIDATION_FAILED',
            'an archived strategy cannot be frozen; restore it first',
          );
        case 'conflict':
          throw conflict(result.draft.revision);
        case 'unchanged':
          return { version: versionOf(result.version), created: false };
        case 'frozen':
          await audit(
            principal,
            'strategy.version.freeze',
            'strategy_version',
            result.version.id,
            requestId,
            {
              strategyId,
              versionNumber: result.version.versionNumber,
              manifestHash: result.version.manifestHash,
            },
          );
          return { version: versionOf(result.version), created: true };
      }
    },

    async listVersions(principal, strategyId) {
      const strategy = await ownedStrategy(principal, strategyId);
      return { versions: (await listVersions(db, strategy.id)).map(versionOf) };
    },

    async getVersion(principal, strategyId, versionId) {
      const strategy = await ownedStrategy(principal, strategyId);
      const version = await findVersion(db, strategy.id, versionId);
      if (!version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      return versionOf(version);
    },

    async diff(principal, strategyId, versionId, againstVersionId) {
      const strategy = await ownedStrategy(principal, strategyId);
      const [from, to] = await Promise.all([
        findVersion(db, strategy.id, againstVersionId),
        findVersion(db, strategy.id, versionId),
      ]);
      if (!from || !to) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      return diffVersions(diffable(from), diffable(to));
    },

    async fork(principal, strategyId, versionId, requestId) {
      // The owner forks any of their versions; anyone else forks a registered, unmoderated one (F08).
      const own = await findStrategy(db, ownerOf(principal), strategyId);
      const version = own
        ? await findVersion(db, own.id, versionId)
        : ((await findPublicVersion(db, strategyId, versionId))?.version ?? null);
      if (!version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      const source = { id: version.strategyId };
      const content: StrategyDraftContent = {
        title: `${version.title} (fork)`.slice(0, 120),
        thesis: version.thesis,
        thesisId: version.thesisId,
        kind: version.kind as StrategyDraftContent['kind'],
        legs: version.legs.map((leg) => ({
          instrumentId: leg.instrumentId,
          weightBps: leg.weightBps,
          note: leg.note,
        })),
        cashWeightBps: version.cashWeightBps,
        maintenance: version.maintenance,
        references: [...version.references],
      };
      const created = await createStrategy(db, {
        ownerUserId: ownerOf(principal),
        content,
        forkOf: { strategyId: source.id, versionId: version.id },
        now: now(),
      });
      await audit(principal, 'strategy.fork', 'strategy', created.strategy.id, requestId, {
        forkOfStrategyId: source.id,
        forkOfVersionId: version.id,
      });
      return detailOf(created.strategy);
    },

    async createInstance(principal, request, requestId) {
      const owner = ownerOf(principal);
      const strategy = await findStrategy(db, owner, request.strategyId);
      if (!strategy) {
        throw new ApiError('NOT_FOUND', 'no strategy with that id');
      }
      const version = await findVersion(db, strategy.id, request.versionId);
      if (!version) {
        throw new ApiError('NOT_FOUND', 'no version with that id');
      }
      const wallet = (await listWallets(db, owner)).find((row) => row.id === request.walletId);
      if (!wallet) {
        throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
      }
      const instance = await createInstance(db, {
        ownerUserId: owner,
        strategyId: strategy.id,
        versionId: version.id,
        walletId: wallet.id,
        label: request.label,
        now: now(),
      });
      await audit(principal, 'instance.create', 'portfolio_instance', instance.id, requestId, {
        strategyId: strategy.id,
        versionId: version.id,
      });
      return instanceOf(instance);
    },

    async listInstances(principal) {
      const rows = await listInstances(db, ownerOf(principal));
      return { instances: await Promise.all(rows.map(instanceOf)) };
    },

    async getInstance(principal, instanceId) {
      const row = await findInstance(db, ownerOf(principal), instanceId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no instance with that id');
      }
      return instanceOf(row);
    },

    async pin(principal, instanceId, versionId, requestId) {
      const owner = ownerOf(principal);
      const row = await findInstance(db, owner, instanceId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no instance with that id');
      }
      const version = await findVersion(db, row.strategyId, versionId);
      if (!version) {
        throw new ApiError('NOT_FOUND', 'no version with that id for this instance’s strategy');
      }
      const pinned = await pinInstance(db, {
        ownerUserId: owner,
        instanceId,
        versionId,
        now: now(),
      });
      if (!pinned) {
        throw new ApiError('VALIDATION_FAILED', 'a closed instance cannot change its pin');
      }
      await audit(principal, 'instance.pin', 'portfolio_instance', instanceId, requestId, {
        versionId,
        versionNumber: version.versionNumber,
      });
      return instanceOf(pinned);
    },
  };
}
