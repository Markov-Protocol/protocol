import { rawToScaled, scaledToRaw } from '@markov/amounts';
import type { Principal } from '@markov/auth';
import {
  assessExtensions,
  availabilityFor,
  compareMint,
  contentHash,
  type ExistingInstrument,
  isPubliclyVisible,
  lifecycleFrom,
  type MultiplierPoint,
  multiplierAfterAction,
  multiplierAsOf,
  parseCorporateActionFeed,
  parseIssuerFeed,
  parseMintAccount,
  planCorporateActions,
  planIngestion,
  productFingerprint,
  REFERENCE_PRICE_STALE_AFTER_MS,
} from '@markov/catalog';
import type { MarkovConfig } from '@markov/config';
import type {
  CorporateAction,
  CorporateActionIngestionReport,
  CorporateActionStatus,
  CorporateActionType,
  ExtensionAssessment,
  IngestionReport,
  IngestionSource,
  Instrument,
  InstrumentDecision,
  InstrumentDecisionKind,
  InstrumentDetail,
  InstrumentLifecycle,
  InstrumentListResponse,
  InstrumentMultiplier,
  InstrumentStatus,
  Issuer,
  IssuerSnapshot,
  MintVerification,
  MintVerificationResult,
  MultiplierAsOfResponse,
  MultiplierSource,
  OnChainMint,
  QuantityConversionResponse,
  SnapshotKindSchemaType,
} from '@markov/contracts';
import {
  applyCorporateAction,
  applyCorporateActionWrites,
  applyIngestion,
  type CorporateActionRow,
  CorporateActionStatusConflictError,
  type Database,
  findCorporateAction,
  findInstrument,
  findInstrumentByProduct,
  type IngestionWrite,
  type InstrumentDecisionRow,
  type InstrumentMultiplierRow,
  type InstrumentRow,
  InstrumentStatusConflictError,
  type IssuerSnapshotRow,
  latestMintVerification,
  latestVerificationsFor,
  listCorporateActions,
  listCorporateActionsForPlanning,
  listInstrumentDecisions,
  listInstrumentMultipliers,
  listInstruments,
  listInstrumentsForPlanning,
  listIssuerSnapshots,
  listMultipliersFor,
  type MintVerificationRow,
  recordAuditEvent,
  recordInstrumentDecision,
  recordInstrumentMultiplier,
  recordIssuerSnapshot,
  recordMintVerification,
  recordPriceObservations,
  rejectCorporateAction,
} from '@markov/db';
import { createPrestocksFixtureSource, createPrestocksUrlSource } from '@markov/issuer-prestocks';
import { createXstocksFixtureSource, createXstocksUrlSource } from '@markov/issuer-xstocks';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { observationsFromInstruments } from '../analytics/service.js';
import { ApiError } from '../errors.js';

/** Any issuer feed source: fixture or configured URL, products or corporate actions. */
export interface FeedSource {
  fetch(): Promise<{
    readonly sourceRef: string;
    readonly fetchedAt: Date;
    readonly payload: unknown;
    readonly bytes: number;
  }>;
}

export interface CatalogServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  /** Primary first; verification uses the first client. */
  readonly rpcClients: readonly SolanaRpcClient[];
  /** Overridable for tests; defaults to the fixture and configured-URL sources of the issuer packages. */
  readonly sourceFor?: (
    issuer: Issuer,
    kind: SnapshotKindSchemaType,
    source: IngestionSource,
  ) => FeedSource;
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

export interface QuantityQuery {
  readonly raw?: string | undefined;
  readonly scaled?: string | undefined;
  readonly asOf?: string | undefined;
  readonly rounding: 'down' | 'up' | 'half_up' | 'half_even';
}

export interface CatalogService {
  ingest(
    principal: Principal,
    request: { issuer: Issuer; source: IngestionSource },
    requestId: string,
  ): Promise<IngestionReport>;
  ingestCorporateActions(
    principal: Principal,
    request: { issuer: Issuer; source: IngestionSource },
    requestId: string,
  ): Promise<CorporateActionIngestionReport>;
  listPublic(query: ListQuery): Promise<InstrumentListResponse>;
  getPublic(instrumentId: string): Promise<InstrumentDetail>;
  /** Public projection of given catalog rows whatever their status (watchlists show delisted items as delisted). */
  projectInstruments(rows: readonly InstrumentRow[]): Promise<Instrument[]>;
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
  listInstrumentActions(instrumentId: string, publicOnly: boolean): Promise<CorporateAction[]>;
  listActions(filter: {
    issuer?: Issuer | undefined;
    status?: CorporateActionStatus | undefined;
  }): Promise<CorporateAction[]>;
  applyAction(
    principal: Principal,
    actionId: string,
    input: { reason: string; evidence: Record<string, string> },
    requestId: string,
  ): Promise<{ action: CorporateAction; multiplier: InstrumentMultiplier | null }>;
  rejectAction(
    principal: Principal,
    actionId: string,
    reason: string,
    requestId: string,
  ): Promise<CorporateAction>;
  multiplierHistory(instrumentId: string, publicOnly: boolean): Promise<InstrumentMultiplier[]>;
  multiplierAt(
    instrumentId: string,
    asOf: Date,
    publicOnly: boolean,
  ): Promise<MultiplierAsOfResponse>;
  convertQuantity(
    instrumentId: string,
    query: QuantityQuery,
    publicOnly: boolean,
  ): Promise<QuantityConversionResponse>;
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
    kind: row.kind as SnapshotKindSchemaType,
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
    compatibility: row.compatibility ?? null,
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

function toAction(row: CorporateActionRow): CorporateAction {
  return {
    actionId: row.id,
    instrumentId: row.instrumentId,
    issuer: row.issuer as Issuer,
    externalId: row.externalId,
    type: row.type as CorporateActionType,
    status: row.status as CorporateActionStatus,
    announcedAt: row.announcedAt.toISOString(),
    effectiveAt: row.effectiveAt.toISOString(),
    summary: row.summary,
    details: row.details,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    appliedBy: row.appliedBy,
    statusReason: row.statusReason,
    sourceSnapshotId: row.sourceSnapshotId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMultiplier(row: InstrumentMultiplierRow): InstrumentMultiplier {
  return {
    multiplierId: row.id,
    instrumentId: row.instrumentId,
    effectiveAt: row.effectiveAt.toISOString(),
    multiplier: row.multiplier,
    multiplierExact: row.multiplierExact,
    source: row.source as MultiplierSource,
    evidence: row.evidence,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toPoints(rows: readonly InstrumentMultiplierRow[]): MultiplierPoint[] {
  return rows.map((row) => ({
    effectiveAt: row.effectiveAt.toISOString(),
    multiplier: row.multiplier,
    source: row.source as MultiplierSource,
  }));
}

function toInstrument(row: InstrumentRow, lifecycle: InstrumentLifecycle, now: Date): Instrument {
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
          stale:
            now.getTime() - new Date(price.observedAt).getTime() > REFERENCE_PRICE_STALE_AFTER_MS,
        }
      : null,
    underlying: { ticker: row.underlyingTicker, exchange: row.underlyingExchange },
    lifecycle,
    availability: availabilityFor(status, lifecycle, now),
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

  const defaultSourceFor = (
    issuer: Issuer,
    kind: SnapshotKindSchemaType,
    source: IngestionSource,
  ): FeedSource => {
    if (source === 'fixture' && !isDev) {
      throw new ApiError('FORBIDDEN', 'fixture sources are refused outside local and test');
    }
    if (issuer === 'prestocks') {
      if (kind !== 'products') {
        throw new ApiError(
          'VALIDATION_FAILED',
          'PreStocks corporate-action feeds are not part of the contract yet',
        );
      }
      if (source === 'fixture') {
        return createPrestocksFixtureSource('default');
      }
      if (config.catalog.prestocksFeedUrl === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'no PreStocks feed is configured (PRESTOCKS_FEED_URL); the live endpoint is an open decision',
        );
      }
      return createPrestocksUrlSource({
        url: config.catalog.prestocksFeedUrl,
        allowInsecure: isDev,
      });
    }
    if (issuer === 'xstocks') {
      if (source === 'fixture') {
        return createXstocksFixtureSource(kind === 'products' ? 'products' : 'events');
      }
      const url =
        kind === 'products' ? config.catalog.xstocksFeedUrl : config.catalog.xstocksEventsUrl;
      if (url === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          `no xStocks ${kind === 'products' ? 'product' : 'corporate-action'} feed is configured; the live endpoints are an open decision`,
        );
      }
      return createXstocksUrlSource({ url, kind, allowInsecure: isDev });
    }
    throw new ApiError(
      'VALIDATION_FAILED',
      `issuer ${issuer} ingestion arrives with a later session`,
    );
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

  const fetchSnapshot = async (
    principal: Principal,
    request: { issuer: Issuer; source: IngestionSource },
    kind: SnapshotKindSchemaType,
  ) => {
    const source = sourceFor(request.issuer, kind, request.source);
    const fetchedAt = now();
    try {
      return { fetched: await source.fetch(), fetchedAt };
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'fetch failed';
      await recordIssuerSnapshot(db, {
        issuer: request.issuer,
        kind,
        source: request.source,
        sourceRef: request.source === 'fixture' ? 'fixture' : 'configured url',
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
  };

  const lifecyclesFor = async (
    rows: readonly InstrumentRow[],
    at: Date,
  ): Promise<Map<string, InstrumentLifecycle>> => {
    const ids = rows.map((row) => row.id);
    const [pending, multipliers, verifications] = await Promise.all([
      listCorporateActions(db, { instrumentIds: ids, status: 'pending', limit: 1000 }),
      listMultipliersFor(db, ids),
      latestVerificationsFor(db, ids),
    ]);
    const result = new Map<string, InstrumentLifecycle>();
    for (const row of rows) {
      let migration: InstrumentLifecycle['migration'] = null;
      if (row.migrationTargetProductId && row.migrationDeadlineAt) {
        const target = await findInstrumentByProduct(
          db,
          row.issuer as Issuer,
          row.migrationTargetProductId,
        );
        migration = {
          targetProductId: row.migrationTargetProductId,
          targetInstrumentId: target?.id ?? null,
          deadlineAt: row.migrationDeadlineAt.toISOString(),
        };
      }
      result.set(
        row.id,
        lifecycleFrom(
          {
            haltedAt: row.haltedAt?.toISOString() ?? null,
            haltedReason: row.haltedReason,
            onChainPaused: verifications.get(row.id)?.compatibility?.paused === true,
            migration,
            sunsetAt: row.sunsetAt?.toISOString() ?? null,
            pendingActions: pending
              .filter((action) => action.instrumentId === row.id)
              .map((action) => ({
                actionId: action.id,
                type: action.type as CorporateActionType,
                effectiveAt: action.effectiveAt.toISOString(),
              })),
            multipliers: toPoints(multipliers.filter((item) => item.instrumentId === row.id)),
          },
          at,
        ),
      );
    }
    return result;
  };

  const detailOf = async (row: InstrumentRow): Promise<InstrumentDetail> => {
    const at = now();
    const [latest, lifecycles] = await Promise.all([
      latestMintVerification(db, row.id),
      lifecyclesFor([row], at),
    ]);
    const lifecycle = lifecycles.get(row.id) as InstrumentLifecycle;
    return {
      ...toInstrument(row, lifecycle, at),
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
    const lifecycles = await lifecyclesFor(page.rows, at);
    return {
      instruments: page.rows.map((row) =>
        toInstrument(row, lifecycles.get(row.id) as InstrumentLifecycle, at),
      ),
      nextCursor: page.nextCursor,
    };
  };

  const requireInstrument = async (
    instrumentId: string,
    publicOnly: boolean,
  ): Promise<InstrumentRow> => {
    const row = await findInstrument(db, instrumentId);
    if (!row || (publicOnly && !isPubliclyVisible(row.status as InstrumentStatus))) {
      throw new ApiError('NOT_FOUND', 'instrument not found');
    }
    return row;
  };

  const requireStatusChange = async (
    instrumentId: string,
    input: DecisionInput,
  ): Promise<{ row: InstrumentRow; status: InstrumentStatus; newStatus: InstrumentStatus }> => {
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
      const compatibility = latest?.compatibility ?? null;
      if (compatibility?.compatibility === 'unsupported') {
        throw new ApiError(
          'ADMISSION_BLOCKED',
          'the mint carries unsupported token extensions; admission is refused rather than rounding through them',
          compatibility.findings
            .filter((finding) => finding.verdict === 'unsupported')
            .map((finding) => ({ path: finding.extension, message: finding.detail })),
        );
      }
      if (
        compatibility?.compatibility === 'review_required' &&
        !input.evidence['extensionReview']
      ) {
        throw new ApiError(
          'ADMISSION_BLOCKED',
          'the mint carries extensions that need a documented issuer-terms review; provide evidence.extensionReview',
          compatibility.findings
            .filter((finding) => finding.verdict === 'review_required')
            .map((finding) => ({ path: finding.extension, message: finding.detail })),
        );
      }
    }
    return { row, status, newStatus };
  };

  return {
    async ingest(principal, request, requestId) {
      const { fetched, fetchedAt } = await fetchSnapshot(principal, request, 'products');
      const parsed = parseIssuerFeed(fetched.payload, request.issuer);
      if (!parsed.ok) {
        const snapshot = await recordIssuerSnapshot(db, {
          issuer: request.issuer,
          kind: 'products',
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
          { issuer: request.issuer, reason: parsed.reason.slice(0, 500) },
        );
        return {
          snapshot: toSnapshot(snapshot),
          products: [],
          counts: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, paused: 0 },
        };
      }
      const snapshot = await recordIssuerSnapshot(db, {
        issuer: request.issuer,
        kind: 'products',
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
        if (action.kind === 'insert') {
          writes.push({
            kind: 'insert',
            product: action.product,
            fingerprint: productFingerprint(action.product),
            status: action.status,
            reasons: action.reasons,
          });
        } else if (action.kind === 'update') {
          writes.push({
            kind: 'update',
            instrumentId: action.instrumentId,
            product: action.product,
            fingerprint: productFingerprint(action.product),
            newStatus: action.newStatus,
            reasons: action.reasons,
          });
        } else if (action.kind === 'invalid' && action.instrumentId && action.currentStatus) {
          writes.push({
            kind: 'invalid',
            instrumentId: action.instrumentId,
            currentStatus: action.currentStatus,
            reasons: action.reasons,
          });
        }
      }
      await applyIngestion(db, {
        issuer: request.issuer,
        genesisHash: deps.genesisHash,
        snapshotId: snapshot.id,
        writes,
        now: fetchedAt,
      });
      // B13: every reference price the snapshot carries becomes a recorded observation (never twice).
      await recordPriceObservations(
        db,
        observationsFromInstruments(
          await listInstrumentsForPlanning(db, request.issuer),
          request.source,
        ),
      );
      await audit(
        principal,
        'catalog.ingestion.applied',
        'issuer_snapshot',
        snapshot.id,
        requestId,
        { issuer: request.issuer, source: request.source, counts: plan.counts },
      );
      return { snapshot: toSnapshot(snapshot), products: plan.products, counts: plan.counts };
    },

    async ingestCorporateActions(principal, request, requestId) {
      const { fetched, fetchedAt } = await fetchSnapshot(principal, request, 'corporate_actions');
      const parsed = parseCorporateActionFeed(fetched.payload, request.issuer);
      const empty = { inserted: 0, updated: 0, unchanged: 0, rejected: 0, unmatched: 0 };
      if (!parsed.ok) {
        const snapshot = await recordIssuerSnapshot(db, {
          issuer: request.issuer,
          kind: 'corporate_actions',
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
          'catalog.events.rejected',
          'issuer_snapshot',
          snapshot.id,
          requestId,
          { issuer: request.issuer, reason: parsed.reason.slice(0, 500) },
        );
        return { snapshot: toSnapshot(snapshot), events: [], counts: empty };
      }
      const snapshot = await recordIssuerSnapshot(db, {
        issuer: request.issuer,
        kind: 'corporate_actions',
        source: request.source,
        sourceRef: fetched.sourceRef,
        fetchedAt: fetched.fetchedAt,
        contentHash: contentHash(fetched.payload),
        schemaVersion: parsed.feed.schemaVersion,
        itemCount: parsed.feed.events.length,
        status: 'accepted',
        rejectionReason: null,
        createdBy: principal.id,
      });
      const instrumentIdByProduct = new Map(
        (await listInstrumentsForPlanning(db, request.issuer)).map((row) => [
          row.issuerProductId,
          row.id,
        ]),
      );
      const existing = (await listCorporateActionsForPlanning(db, request.issuer)).map((row) => ({
        actionId: row.id,
        externalId: row.externalId,
        status: row.status as CorporateActionStatus,
        fingerprint: row.fingerprint,
      }));
      const plan = planCorporateActions(existing, instrumentIdByProduct, parsed.feed.events);
      await applyCorporateActionWrites(db, {
        issuer: request.issuer,
        snapshotId: snapshot.id,
        writes: plan.writes,
        now: fetchedAt,
      });
      await audit(principal, 'catalog.events.applied', 'issuer_snapshot', snapshot.id, requestId, {
        issuer: request.issuer,
        source: request.source,
        counts: plan.counts,
      });
      return { snapshot: toSnapshot(snapshot), events: plan.events, counts: plan.counts };
    },

    listPublic(query) {
      return listWith(query, PUBLIC_STATUSES);
    },

    async projectInstruments(rows) {
      const at = now();
      const lifecycles = await lifecyclesFor(rows, at);
      return rows.map((row) =>
        toInstrument(row, lifecycles.get(row.id) as InstrumentLifecycle, at),
      );
    },

    async getPublic(instrumentId) {
      return detailOf(await requireInstrument(instrumentId, true));
    },

    listForOperator(query) {
      return listWith(query, query.status ? [query.status] : ALL_STATUSES);
    },

    async getForOperator(instrumentId) {
      return detailOf(await requireInstrument(instrumentId, false));
    },

    async verifyMint(principal, instrumentId, requestId) {
      const row = await requireInstrument(instrumentId, false);
      const client = deps.rpcClients[0];
      if (!client) {
        throw new ApiError('SERVICE_NOT_READY', 'no rpc client configured');
      }
      const verifiedAt = now();
      let result: MintVerificationResult;
      let onChain: OnChainMint | null = null;
      let compatibility: ExtensionAssessment | null = null;
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
            compatibility = assessExtensions(parsed.entries);
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
        compatibility,
      });
      if (result === 'verified') {
        // Multiplier evidence: what the chain says now, and any scheduled change it already announces.
        const evidence = {
          rpcHost: client.host,
          slot: String(slot ?? ''),
          verificationId: String(record.id),
        };
        const scaled = compatibility?.scaledUiAmount ?? null;
        await recordInstrumentMultiplier(
          db,
          instrumentId,
          {
            effectiveAt: verifiedAt,
            multiplier: scaled?.multiplier ?? '1',
            multiplierExact: scaled?.multiplierExact ?? '1',
            source: 'on_chain',
            evidence: scaled ? evidence : { ...evidence, extension: 'none' },
          },
          verifiedAt,
        );
        if (
          scaled?.newMultiplierEffectiveAt &&
          new Date(scaled.newMultiplierEffectiveAt).getTime() > verifiedAt.getTime()
        ) {
          await recordInstrumentMultiplier(
            db,
            instrumentId,
            {
              effectiveAt: new Date(scaled.newMultiplierEffectiveAt),
              multiplier: scaled.newMultiplier,
              multiplierExact: scaled.newMultiplierExact,
              source: 'on_chain',
              evidence: { ...evidence, scheduled: 'true' },
            },
            verifiedAt,
          );
        }
      }
      await audit(principal, 'catalog.mint.verified', 'instrument', instrumentId, requestId, {
        result,
        mismatches,
        rpcHost: client.host,
        compatibility: compatibility?.compatibility ?? null,
      });
      return toVerification(record);
    },

    async decide(principal, instrumentId, input, requestId) {
      const { status, newStatus } = await requireStatusChange(instrumentId, input);
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
        { previousStatus: status, newStatus, reason: input.reason, evidence: input.evidence },
      );
      return toDecision(decision);
    },

    async listDecisions(instrumentId) {
      await requireInstrument(instrumentId, false);
      return (await listInstrumentDecisions(db, instrumentId)).map(toDecision);
    },

    async listSnapshots(issuer) {
      return (await listIssuerSnapshots(db, issuer)).map(toSnapshot);
    },

    async listInstrumentActions(instrumentId, publicOnly) {
      await requireInstrument(instrumentId, publicOnly);
      const rows = await listCorporateActions(db, { instrumentId });
      return rows
        .filter((row) => !publicOnly || row.status === 'pending' || row.status === 'applied')
        .map(toAction);
    },

    async listActions(filter) {
      return (await listCorporateActions(db, { issuer: filter.issuer, status: filter.status })).map(
        toAction,
      );
    },

    async applyAction(principal, actionId, input, requestId) {
      const action = await findCorporateAction(db, actionId);
      if (!action) {
        throw new ApiError('NOT_FOUND', 'corporate action not found');
      }
      if (action.status !== 'pending') {
        throw new ApiError('VALIDATION_FAILED', `corporate action is already ${action.status}`);
      }
      const at = now();
      if (action.effectiveAt.getTime() > at.getTime()) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `corporate action is not effective before ${action.effectiveAt.toISOString()}`,
        );
      }
      const type = action.type as CorporateActionType;
      const details = action.details;
      let lifecycle: Parameters<typeof applyCorporateAction>[1]['lifecycle'] = {};
      let multiplier: Parameters<typeof applyCorporateAction>[1]['multiplier'] = null;
      switch (type) {
        case 'halt':
          lifecycle = { haltedAt: action.effectiveAt, haltedReason: action.summary.slice(0, 500) };
          break;
        case 'resume':
          lifecycle = { haltedAt: null, haltedReason: null };
          break;
        case 'migration':
          lifecycle = details.migration
            ? {
                migrationTargetProductId: details.migration.targetProductId,
                migrationDeadlineAt: new Date(details.migration.deadlineAt),
              }
            : {};
          break;
        case 'sunset':
          lifecycle = { sunsetAt: details.sunsetAt ? new Date(details.sunsetAt) : null };
          break;
        case 'split':
        case 'reverse_split':
        case 'multiplier_change': {
          const rows = await listInstrumentMultipliers(db, action.instrumentId);
          const history = toPoints(rows);
          const before = multiplierAsOf(history, new Date(action.effectiveAt.getTime() - 1));
          const onChainAfter = rows
            .filter(
              (row) =>
                row.source === 'on_chain' &&
                row.effectiveAt.getTime() >= action.effectiveAt.getTime(),
            )
            .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())[0];
          if (before.complete && before.multiplier !== null) {
            // Derive from the multiplier in force before the effective time and refuse if the chain disagrees.
            const next = multiplierAfterAction({ type, details }, before.multiplier);
            if (next === null) {
              throw new ApiError(
                'VALIDATION_FAILED',
                'the action does not define a multiplier change',
              );
            }
            if (onChainAfter && onChainAfter.multiplier !== next) {
              throw new ApiError(
                'VALIDATION_FAILED',
                `on-chain evidence after the effective time shows multiplier ${onChainAfter.multiplier}, the action derives ${next}; investigate before applying`,
                [
                  {
                    path: 'multiplier',
                    message: `derived ${next} from ${before.multiplier}; chain ${onChainAfter.multiplier} at ${onChainAfter.effectiveAt.toISOString()}`,
                  },
                ],
              );
            }
            multiplier = {
              effectiveAt: action.effectiveAt,
              multiplier: next,
              multiplierExact: next,
              source: 'corporate_action',
              evidence: {
                actionId: action.id,
                externalId: action.externalId,
                basis: 'derived_from_previous',
                previousMultiplier: before.multiplier,
                ...input.evidence,
              },
            };
            break;
          }
          if (!onChainAfter) {
            throw new ApiError(
              'VALIDATION_FAILED',
              'no multiplier evidence exists for this instrument; verify the mint first so the adjustment has a base',
              [{ path: 'multiplier', message: before.detail }],
            );
          }
          // No evidence before the effective time: the chain already reflects the action. Record the observed
          // value from the effective time on and say so; the period before stays incomplete.
          if (
            type === 'multiplier_change' &&
            details.newMultiplier !== null &&
            details.newMultiplier !== onChainAfter.multiplier
          ) {
            throw new ApiError(
              'VALIDATION_FAILED',
              `the announced multiplier ${details.newMultiplier} differs from the on-chain multiplier ${onChainAfter.multiplier} observed after the effective time`,
            );
          }
          multiplier = {
            effectiveAt: action.effectiveAt,
            multiplier: onChainAfter.multiplier,
            multiplierExact: onChainAfter.multiplierExact,
            source: 'corporate_action',
            evidence: {
              actionId: action.id,
              externalId: action.externalId,
              basis: 'on_chain_after_effective_time',
              previousMultiplier: 'unknown',
              observedAt: onChainAfter.effectiveAt.toISOString(),
              ...input.evidence,
            },
          };
          break;
        }
        case 'distribution':
          break;
      }
      let applied: Awaited<ReturnType<typeof applyCorporateAction>>;
      try {
        applied = await applyCorporateAction(db, {
          actionId,
          appliedBy: principal.id,
          appliedAt: at,
          reason: input.reason,
          lifecycle,
          multiplier,
        });
      } catch (error) {
        if (error instanceof CorporateActionStatusConflictError) {
          throw new ApiError(
            'IDEMPOTENCY_CONFLICT',
            'corporate action status changed concurrently',
          );
        }
        throw error;
      }
      await audit(
        principal,
        `catalog.action.${type}.applied`,
        'corporate_action',
        actionId,
        requestId,
        {
          instrumentId: action.instrumentId,
          reason: input.reason,
          evidence: input.evidence,
          multiplier: applied.multiplier?.multiplier ?? null,
        },
      );
      return {
        action: toAction(applied.action),
        multiplier: applied.multiplier ? toMultiplier(applied.multiplier) : null,
      };
    },

    async rejectAction(principal, actionId, reason, requestId) {
      let rejected: CorporateActionRow;
      try {
        rejected = await rejectCorporateAction(db, {
          actionId,
          reason,
          decidedBy: principal.id,
          at: now(),
        });
      } catch (error) {
        if (error instanceof CorporateActionStatusConflictError) {
          throw error.currentStatus === null
            ? new ApiError('NOT_FOUND', 'corporate action not found')
            : new ApiError(
                'VALIDATION_FAILED',
                `corporate action is already ${error.currentStatus}`,
              );
        }
        throw error;
      }
      await audit(principal, 'catalog.action.rejected', 'corporate_action', actionId, requestId, {
        reason,
      });
      return toAction(rejected);
    },

    async multiplierHistory(instrumentId, publicOnly) {
      await requireInstrument(instrumentId, publicOnly);
      return (await listInstrumentMultipliers(db, instrumentId)).map(toMultiplier);
    },

    async multiplierAt(instrumentId, asOf, publicOnly) {
      await requireInstrument(instrumentId, publicOnly);
      const history = toPoints(await listInstrumentMultipliers(db, instrumentId));
      const point = multiplierAsOf(history, asOf);
      return { instrumentId, asOf: asOf.toISOString(), ...point };
    },

    async convertQuantity(instrumentId, query, publicOnly) {
      const row = await requireInstrument(instrumentId, publicOnly);
      if ((query.raw === undefined) === (query.scaled === undefined)) {
        throw new ApiError('VALIDATION_FAILED', 'provide exactly one of raw or scaled');
      }
      const asOf = query.asOf ? new Date(query.asOf) : now();
      const point = multiplierAsOf(
        toPoints(await listInstrumentMultipliers(db, instrumentId)),
        asOf,
      );
      if (!point.complete || point.multiplier === null || point.source === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'no multiplier evidence covers that time; the conversion would be a guess',
          [{ path: 'asOf', message: point.detail }],
        );
      }
      let raw: string;
      if (query.raw !== undefined) {
        raw = query.raw;
      } else {
        try {
          raw = scaledToRaw({
            scaled: query.scaled as string,
            decimals: row.decimals,
            multiplier: point.multiplier,
            rounding: query.rounding,
          }).raw;
        } catch (error) {
          throw new ApiError(
            'VALIDATION_FAILED',
            error instanceof Error ? error.message : 'invalid scaled amount',
          );
        }
      }
      const scaled = rawToScaled({
        raw,
        decimals: row.decimals,
        multiplier: point.multiplier,
        rounding: query.rounding,
      });
      return {
        instrumentId,
        asOf: asOf.toISOString(),
        decimals: row.decimals,
        multiplier: point.multiplier,
        multiplierEffectiveAt: point.effectiveAt,
        multiplierSource: point.source,
        raw,
        scaled: scaled.scaled,
        scaledExact: scaled.scaledExact,
        rounding: query.rounding,
        rounded: scaled.rounded,
      };
    },
  };
}
