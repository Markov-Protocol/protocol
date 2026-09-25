import { isStepUpFresh, type Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type BetaParticipant,
  type BetaParticipantListResponse,
  type CurrentTermsResponse,
  type EffectiveLimitsResponse,
  type EligibilityDecision,
  type EligibilityHistoryResponse,
  type EligibilityStatusResponse,
  type EligibilityStep,
  FIXTURE_JURISDICTIONS,
  type InstrumentActionAvailability,
  type InstrumentDetail,
  type Issuer,
  type JurisdictionRuleSet,
  type OwnerLimits,
  type OwnerLimitsUpdateRequest,
  type PolicyDecision,
  type PolicyEvaluationRequest,
  type PublishedRuleSet,
  type ReservationListResponse,
  type RuleSetListResponse,
  type SpendReservation,
  type TermsAcknowledgement,
  type TermsDocument,
  type TermsPublishRequest,
} from '@markov/contracts';
import {
  activeJurisdictionRuleSet,
  addBetaParticipant,
  budgetUsage,
  type Database,
  type EligibilityDecisionRow,
  findEligibilityDecision,
  findInstrumentsByIds,
  findOwnerLimits,
  findPolicyDecision,
  findReservationById,
  findTermsDocument,
  isBetaParticipant,
  type JurisdictionRuleSetRow,
  latestEligibilityDecision,
  listActiveTermsDocuments,
  listBetaParticipants,
  listCapabilityReadiness,
  listEligibilityDecisions,
  listJurisdictionRuleSets,
  listReservations,
  listTermsAcknowledgements,
  listWallets,
  PolicyVersionConflictError,
  publishJurisdictionRuleSet,
  publishTermsDocument,
  recordAuditEvent,
  recordEligibilityDecision,
  recordPolicyDecision,
  recordTermsAcknowledgement,
  releaseReservation,
  removeBetaParticipant,
  reserveSpend,
  revokeEligibilityDecision,
  type SpendReservationRow,
  type TermsAcknowledgementRow,
  type TermsDocumentRow,
  upsertOwnerLimits,
} from '@markov/db';
import {
  capabilityStatesFor,
  ceilingLimits,
  companyKeyOf,
  type EligibilityStanding,
  effectiveLimits,
  eligibilityStanding,
  evaluateEligibility,
  evaluatePolicy,
  type PolicyEvaluation,
  type PolicyInput,
  type PolicyPosition,
  validateOwnerLimits,
} from '@markov/policy';
import type { CatalogService } from '../catalog/service.js';
import { ApiError } from '../errors.js';

/** Holds outlive a decision so a planned intent can be quoted, reviewed and submitted (B10 consumes or releases). */
export const RESERVATION_TTL_SECONDS = 900;
const CAPABILITY = 'trade_stocks' as const;
const VENUE_READY_STATUSES = new Set([
  'IMPLEMENTED',
  'FIXTURE_VERIFIED',
  'LIVE_READ_VERIFIED',
  'LIVE_WRITE_VERIFIED',
]);

export interface PolicyServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly catalog: CatalogService;
  readonly now?: () => Date;
}

export interface PolicyService {
  eligibilityStatus(principal: Principal): Promise<EligibilityStatusResponse>;
  declareJurisdiction(
    principal: Principal,
    request: { jurisdiction: string },
    requestId: string,
  ): Promise<EligibilityDecision>;
  currentTerms(): Promise<CurrentTermsResponse>;
  acknowledgeTerms(
    principal: Principal,
    request: { termsVersion: string; contentHash: string; channel: 'app' | 'cli' },
    requestId: string,
  ): Promise<TermsAcknowledgement>;
  limits(principal: Principal): Promise<EffectiveLimitsResponse>;
  updateLimits(
    principal: Principal,
    request: OwnerLimitsUpdateRequest,
    requestId: string,
  ): Promise<EffectiveLimitsResponse>;
  availability(
    principal: Principal | null,
    instrumentId: string,
  ): Promise<InstrumentActionAvailability>;
  evaluate(
    principal: Principal,
    request: PolicyEvaluationRequest,
    requestId: string,
  ): Promise<PolicyDecision>;
  /** One of the caller's own earlier decisions, exactly as recorded (B15 explains it). */
  decision(principal: Principal, decisionId: string): Promise<PolicyDecision>;
  listReservations(principal: Principal): Promise<ReservationListResponse>;
  releaseReservation(
    principal: Principal,
    intentId: string,
    requestId: string,
  ): Promise<SpendReservation>;
  publishRules(
    principal: Principal,
    ruleSet: JurisdictionRuleSet,
    requestId: string,
  ): Promise<PublishedRuleSet>;
  listRuleSets(): Promise<RuleSetListResponse>;
  publishTerms(
    principal: Principal,
    document: TermsPublishRequest,
    requestId: string,
  ): Promise<TermsDocument>;
  revokeEligibility(
    principal: Principal,
    decisionId: string,
    reason: string,
    requestId: string,
  ): Promise<EligibilityDecision>;
  eligibilityHistory(userId: string): Promise<EligibilityHistoryResponse>;
  addParticipant(
    principal: Principal,
    request: { userId: string; note: string },
    requestId: string,
  ): Promise<BetaParticipant>;
  removeParticipant(principal: Principal, userId: string, requestId: string): Promise<void>;
  listParticipants(): Promise<BetaParticipantListResponse>;
}

function toDecision(row: EligibilityDecisionRow): EligibilityDecision {
  return {
    decisionId: row.id,
    userId: row.userId,
    capability: row.capability as EligibilityDecision['capability'],
    policyVersion: row.policyVersion,
    jurisdiction: row.jurisdiction,
    evidenceKind: row.evidenceKind as EligibilityDecision['evidenceKind'],
    outcome: row.outcome as EligibilityDecision['outcome'],
    reasons: row.reasons,
    issuers: row.issuers as Issuer[],
    decidedAt: row.decidedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason,
    decidedBy: row.decidedBy,
  };
}

function toTerms(row: TermsDocumentRow): TermsDocument {
  return {
    termsVersion: row.termsVersion,
    title: row.title,
    contentHash: row.contentHash,
    url: row.url,
    requiredFor: row.requiredFor as TermsDocument['requiredFor'],
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
    active: row.active === 1,
  };
}

function toAcknowledgement(row: TermsAcknowledgementRow): TermsAcknowledgement {
  return {
    userId: row.userId,
    termsVersion: row.termsVersion,
    contentHash: row.contentHash,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
    channel: row.channel as TermsAcknowledgement['channel'],
  };
}

function toRuleSet(row: JurisdictionRuleSetRow): PublishedRuleSet {
  return {
    policyVersion: row.policyVersion,
    validityDays: row.validityDays,
    rules: row.rules,
    evidence: row.evidence,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
    active: row.active === 1,
  };
}

function toReservation(row: SpendReservationRow): SpendReservation {
  return {
    reservationId: row.id,
    userId: row.userId,
    intentId: row.intentId,
    instrumentId: row.instrumentId,
    side: row.side as SpendReservation['side'],
    notionalUsdcRaw: row.notionalUsdcRaw,
    status: row.status as SpendReservation['status'],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    releasedAt: row.releasedAt?.toISOString() ?? null,
  };
}

function ruleSetOf(row: JurisdictionRuleSetRow | null): JurisdictionRuleSet | null {
  return row === null
    ? null
    : {
        policyVersion: row.policyVersion,
        validityDays: row.validityDays,
        rules: row.rules,
        evidence: row.evidence,
      };
}

function nonTransferable(instrument: InstrumentDetail): boolean {
  return (
    instrument.latestMintVerification?.compatibility?.findings.some(
      (finding) => finding.extension === 'NonTransferable',
    ) ?? false
  );
}

interface TermsPicture {
  readonly required: TermsDocument[];
  readonly acknowledged: TermsAcknowledgement[];
  readonly complete: boolean;
}

interface EligibilityPicture {
  readonly active: JurisdictionRuleSetRow | null;
  readonly decision: EligibilityDecisionRow | null;
  readonly standing: EligibilityStanding;
}

export function createPolicyService(deps: PolicyServiceDeps): PolicyService {
  const { config, db, catalog } = deps;
  const now = deps.now ?? (() => new Date());
  const isDev = config.markovEnv === 'local' || config.markovEnv === 'test';

  /** Interactive users and agents acting for their owner; the route decides which scopes are needed. */
  const requireUserId = (principal: Principal): string => {
    if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
      throw new ApiError(
        'FORBIDDEN',
        'this operation requires a user session or an agent acting for one',
      );
    }
    return principal.userId;
  };

  const requireInteractive = (principal: Principal): string => {
    if (principal.class !== 'user' || principal.userId === null) {
      throw new ApiError('FORBIDDEN', 'this operation requires an interactive user session');
    }
    return principal.userId;
  };

  const requireStepUp = (principal: Principal): string => {
    const userId = requireInteractive(principal);
    if (!isStepUpFresh(principal, config.auth.stepUpMaxAgeSeconds, now())) {
      throw new ApiError('STEP_UP_REQUIRED', 'sign in again to change trading limits');
    }
    return userId;
  };

  const termsPicture = async (userId: string): Promise<TermsPicture> => {
    const [documents, acknowledgements] = await Promise.all([
      listActiveTermsDocuments(db),
      listTermsAcknowledgements(db, userId),
    ]);
    const required = documents.filter((doc) => doc.requiredFor.includes(CAPABILITY)).map(toTerms);
    const acknowledged = acknowledgements
      .filter((ack) =>
        required.some(
          (doc) => doc.termsVersion === ack.termsVersion && doc.contentHash === ack.contentHash,
        ),
      )
      .map(toAcknowledgement);
    return {
      required,
      acknowledged,
      complete: required.every((doc) =>
        acknowledged.some((ack) => ack.termsVersion === doc.termsVersion),
      ),
    };
  };

  const eligibilityPicture = async (userId: string): Promise<EligibilityPicture> => {
    const [active, decision] = await Promise.all([
      activeJurisdictionRuleSet(db),
      latestEligibilityDecision(db, userId, CAPABILITY),
    ]);
    return {
      active,
      decision,
      standing: eligibilityStanding(decision, active?.policyVersion ?? null, now()),
    };
  };

  const venueEnabled = async (): Promise<boolean> => {
    const readiness = await listCapabilityReadiness(db);
    const quote = readiness.find((row) => row.capability === 'execution.jupiter.quote');
    return quote !== undefined && VENUE_READY_STATUSES.has(quote.status);
  };

  const participantAllowlisted = async (userId: string): Promise<boolean> => {
    if (config.execution.betaCaps?.participantAllowlistEnabled !== true) {
      return true;
    }
    return isBetaParticipant(db, userId);
  };

  const limitsFor = async (userId: string): Promise<EffectiveLimitsResponse> => {
    const { ceiling, source } = ceilingLimits(config.execution.betaCaps);
    const owner = await findOwnerLimits(db, userId);
    return {
      effective: effectiveLimits(ceiling, owner?.limits ?? null),
      owner: owner?.limits ?? null,
      ceiling,
      ceilingSource: source,
      updatedAt: owner?.updatedAt.toISOString() ?? null,
    };
  };

  const resolvePositions = async (request: PolicyEvaluationRequest): Promise<PolicyPosition[]> => {
    const ids = [...new Set(request.exposure.positions.map((position) => position.instrumentId))];
    const rows = await findInstrumentsByIds(db, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const positions: PolicyPosition[] = [];
    const unknown: string[] = [];
    for (const position of request.exposure.positions) {
      const row = byId.get(position.instrumentId);
      if (!row) {
        unknown.push(position.instrumentId);
        continue;
      }
      positions.push({
        instrumentId: row.id,
        issuer: row.issuer as Issuer,
        companyKey: companyKeyOf(row.companyName),
        notionalUsdcRaw: position.notionalUsdcRaw,
      });
    }
    if (unknown.length > 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'exposure names instruments that do not exist',
        unknown.map((id) => ({
          path: 'body/exposure/positions',
          message: `unknown instrument ${id}`,
        })),
      );
    }
    return positions;
  };

  return {
    async eligibilityStatus(principal) {
      const userId = requireUserId(principal);
      const [picture, terms, wallets] = await Promise.all([
        eligibilityPicture(userId),
        termsPicture(userId),
        listWallets(db, userId),
      ]);
      const inForce = picture.standing === 'in_force' && picture.decision !== null;
      const outcome = inForce
        ? (picture.decision?.outcome as EligibilityDecision['outcome'])
        : 'unknown';
      const steps: EligibilityStep[] = [];
      const summaryParts: string[] = [];
      if (!inForce) {
        steps.push('declare_jurisdiction');
        summaryParts.push(
          picture.decision === null
            ? 'Declare where you live to find out whether tokenised stocks are available to you.'
            : picture.standing === 'superseded'
              ? 'The eligibility rules changed since your last declaration; declare again.'
              : picture.standing === 'revoked'
                ? 'Your eligibility decision was revoked; declare again.'
                : 'Your eligibility decision expired; declare again.',
        );
      } else if (outcome === 'unknown') {
        steps.push('await_review');
        summaryParts.push(
          picture.active === null
            ? 'Eligibility rules have not been published yet (OD-06); trading stays unavailable until they are.'
            : 'Your declaration is waiting for review or stronger evidence.',
        );
      } else if (outcome === 'ineligible') {
        summaryParts.push('Tokenised stocks are not available in your jurisdiction.');
      } else {
        summaryParts.push('You are eligible to trade tokenised stocks from the covered issuers.');
      }
      if (!terms.complete) {
        steps.push('acknowledge_terms');
        summaryParts.push('Read and acknowledge the current terms.');
      }
      if (wallets.length === 0) {
        steps.push('verify_wallet');
        summaryParts.push('Verify a wallet before funding or trading.');
      }
      return {
        capability: CAPABILITY,
        outcome,
        decision: picture.decision === null ? null : toDecision(picture.decision),
        policyVersion: picture.active?.policyVersion ?? null,
        terms,
        steps,
        summary: summaryParts.join(' ').slice(0, 500),
      };
    },

    async declareJurisdiction(principal, request, requestId) {
      const userId = requireInteractive(principal);
      const at = now();
      const active = await activeJurisdictionRuleSet(db);
      const evaluation = evaluateEligibility({
        ruleSet: ruleSetOf(active),
        jurisdiction: request.jurisdiction,
        evidenceKind: 'self_declared',
        capability: CAPABILITY,
        now: at,
      });
      const row = await recordEligibilityDecision(db, {
        userId,
        capability: CAPABILITY,
        policyVersion: evaluation.policyVersion,
        jurisdiction: request.jurisdiction,
        evidenceKind: 'self_declared',
        outcome: evaluation.outcome,
        reasons: evaluation.reasons,
        issuers: evaluation.issuers,
        decidedAt: at,
        expiresAt: evaluation.expiresAt,
        decidedBy: principal.id,
      });
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.eligibility.declared',
        targetType: 'eligibility_decision',
        targetId: row.id,
        requestId,
        details: {
          jurisdiction: request.jurisdiction,
          outcome: evaluation.outcome,
          policyVersion: evaluation.policyVersion,
        },
      });
      return toDecision(row);
    },

    async currentTerms() {
      const documents = await listActiveTermsDocuments(db);
      return { documents: documents.map(toTerms) };
    },

    async acknowledgeTerms(principal, request, requestId) {
      const userId = requireInteractive(principal);
      const document = await findTermsDocument(db, request.termsVersion);
      if (document === null || document.active !== 1) {
        throw new ApiError('NOT_FOUND', 'no active terms document has that version');
      }
      if (document.contentHash !== request.contentHash) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'the acknowledged text differs from the published document',
          [{ path: 'body/contentHash', message: 'does not match the published content hash' }],
        );
      }
      const row = await recordTermsAcknowledgement(db, {
        userId,
        termsVersion: document.termsVersion,
        contentHash: document.contentHash,
        channel: request.channel,
        now: now(),
      });
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.terms.acknowledged',
        targetType: 'terms_document',
        targetId: document.termsVersion,
        requestId,
        details: { channel: request.channel },
      });
      return toAcknowledgement(row);
    },

    async limits(principal) {
      return limitsFor(requireUserId(principal));
    },

    async updateLimits(principal, request, requestId) {
      const userId = requireStepUp(principal);
      const { ceiling } = ceilingLimits(config.execution.betaCaps);
      const issues = validateOwnerLimits(ceiling, request);
      if (issues.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'owner limits may only tighten the ceiling',
          issues.map((issue) => ({ path: `body/${issue.path}`, message: issue.message })),
        );
      }
      const existing = await findOwnerLimits(db, userId);
      const merged: Partial<OwnerLimits> = { ...(existing?.limits ?? {}) };
      for (const [key, value] of Object.entries(request)) {
        if (value !== undefined) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      await upsertOwnerLimits(db, { userId, limits: merged, now: now() });
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.limits.updated',
        targetType: 'user',
        targetId: userId,
        requestId,
        details: { changed: Object.keys(request) },
      });
      return limitsFor(userId);
    },

    async availability(principal, instrumentId) {
      const instrument = await catalog.getPublic(instrumentId);
      const userId =
        principal !== null && (principal.class === 'user' || principal.class === 'agent')
          ? principal.userId
          : null;
      const [picture, terms, venue] = await Promise.all([
        userId === null ? null : eligibilityPicture(userId),
        userId === null ? null : termsPicture(userId),
        venueEnabled(),
      ]);
      const active = picture?.active ?? (await activeJurisdictionRuleSet(db));
      return capabilityStatesFor({
        instrument: {
          instrumentId: instrument.instrumentId,
          issuer: instrument.issuer,
          status: instrument.status,
          availability: instrument.availability,
          lifecycle: instrument.lifecycle,
          referencePrice: instrument.referencePrice,
          nonTransferable: nonTransferable(instrument),
        },
        eligibility:
          picture === null || picture.decision === null
            ? null
            : {
                outcome: picture.decision.outcome as EligibilityDecision['outcome'],
                issuers: picture.decision.issuers as Issuer[],
                standing: picture.standing,
              },
        termsComplete: terms?.complete ?? false,
        executionWritesEnabled: config.execution.writesEnabled,
        venueEnabled: venue,
        policyVersion: active?.policyVersion ?? null,
        now: now(),
      });
    },

    async evaluate(principal, request, requestId) {
      const userId = requireUserId(principal);
      const at = now();
      const instrument = await catalog.getPublic(request.instrumentId);
      const [picture, terms, limits, allowlisted, venue, positions] = await Promise.all([
        eligibilityPicture(userId),
        termsPicture(userId),
        limitsFor(userId),
        participantAllowlisted(userId),
        venueEnabled(),
        resolvePositions(request),
      ]);
      const decision = picture.decision;
      const base: Omit<PolicyInput, 'dailyUsedUsdcRaw' | 'reservedUsdcRaw'> = {
        now: at,
        stage: request.stage,
        side: request.side,
        instrument: {
          instrumentId: instrument.instrumentId,
          issuer: instrument.issuer,
          companyKey: companyKeyOf(instrument.companyName),
          status: instrument.status,
          lifecycle: instrument.lifecycle,
          referencePriceStale: instrument.referencePrice?.stale ?? null,
        },
        notionalUsdcRaw: request.notionalUsdcRaw,
        venue: request.venue,
        slippageBps: request.slippageBps,
        quoteObservedAt:
          request.quoteObservedAt === null ? null : new Date(request.quoteObservedAt),
        exposure: request.exposure,
        positions,
        limits: limits.effective,
        eligibility:
          decision === null
            ? null
            : {
                decisionId: decision.id,
                outcome: decision.outcome as EligibilityDecision['outcome'],
                issuers: decision.issuers as Issuer[],
                expiresAt: decision.expiresAt.toISOString(),
                revokedAt: decision.revokedAt?.toISOString() ?? null,
                policyVersion: decision.policyVersion,
              },
        activePolicyVersion: picture.active?.policyVersion ?? null,
        termsComplete: terms.complete,
        executionWritesEnabled: config.execution.writesEnabled,
        venueEnabled: venue,
        participantAllowlisted: allowlisted,
      };
      const decide = (usage: { dailyUsedUsdcRaw: string; reservedUsdcRaw: string }) => {
        const evaluation = evaluatePolicy({ ...base, ...usage });
        return { allow: evaluation.outcome === 'allow', evaluation };
      };

      let evaluation: PolicyEvaluation;
      let reservation: SpendReservationRow | null = null;
      if (request.reserve) {
        const outcome = await reserveSpend(db, {
          userId,
          intentId: request.intentId,
          instrumentId: instrument.instrumentId,
          side: request.side,
          notionalUsdcRaw: request.notionalUsdcRaw,
          now: at,
          expiresAt: new Date(at.getTime() + RESERVATION_TTL_SECONDS * 1000),
          decide,
        });
        if (outcome.kind === 'existing') {
          if (outcome.row.status !== 'held') {
            throw new ApiError(
              'IDEMPOTENCY_CONFLICT',
              `intent ${request.intentId} was already ${outcome.row.status}; use a new intent id`,
            );
          }
          // The hold already counts in the usage; evaluate as if it were this request.
          const held = BigInt(outcome.row.notionalUsdcRaw);
          const dailyUsed = BigInt(outcome.usage.dailyUsedUsdcRaw) - held;
          const reserved =
            outcome.row.side === 'buy'
              ? BigInt(outcome.usage.reservedUsdcRaw) - held
              : BigInt(outcome.usage.reservedUsdcRaw);
          evaluation = decide({
            dailyUsedUsdcRaw: (dailyUsed < 0n ? 0n : dailyUsed).toString(),
            reservedUsdcRaw: (reserved < 0n ? 0n : reserved).toString(),
          }).evaluation;
          reservation = outcome.row;
        } else {
          evaluation = outcome.decision.evaluation;
          reservation = outcome.kind === 'created' ? outcome.row : null;
        }
      } else {
        evaluation = decide(await budgetUsage(db, userId, at)).evaluation;
      }

      const evidence: PolicyDecision['evidence'] = {
        policyVersion: picture.active?.policyVersion ?? null,
        eligibilityDecisionId: decision?.id ?? null,
        termsVersions: terms.acknowledged.map((ack) => ack.termsVersion),
        instrumentUpdatedAt: instrument.updatedAt,
        limitsUpdatedAt: limits.updatedAt,
        ceilingSource: limits.ceilingSource,
        exposureSource: request.exposure.source,
      };
      const row = await recordPolicyDecision(db, {
        userId,
        instrumentId: instrument.instrumentId,
        side: request.side,
        stage: request.stage,
        notionalUsdcRaw: request.notionalUsdcRaw,
        outcome: evaluation.outcome,
        denials: evaluation.denials,
        evidence,
        limits: limits.effective,
        budget: evaluation.budget,
        reservationId: reservation?.id ?? null,
        evaluatedAt: at,
        expiresAt: evaluation.expiresAt,
      });
      if (reservation !== null && request.reserve) {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'policy.reservation.held',
          targetType: 'spend_reservation',
          targetId: reservation.id,
          requestId,
          details: {
            intentId: request.intentId,
            notionalUsdcRaw: request.notionalUsdcRaw,
            decisionId: row.id,
          },
        });
      }
      return {
        decisionId: row.id,
        outcome: evaluation.outcome,
        stage: request.stage,
        side: request.side,
        instrumentId: instrument.instrumentId,
        notionalUsdcRaw: request.notionalUsdcRaw,
        denials: evaluation.denials,
        evidence,
        limitsApplied: limits.effective,
        budget: evaluation.budget,
        reservation: reservation === null ? null : toReservation(reservation),
        evaluatedAt: at.toISOString(),
        expiresAt: evaluation.expiresAt.toISOString(),
      };
    },

    async decision(principal, decisionId) {
      const userId = requireUserId(principal);
      const row = await findPolicyDecision(db, userId, decisionId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no policy decision with that id');
      }
      const reservation =
        row.reservationId === null
          ? null
          : await findReservationById(db, userId, row.reservationId);
      return {
        decisionId: row.id,
        outcome: row.outcome as PolicyDecision['outcome'],
        stage: row.stage as PolicyDecision['stage'],
        side: row.side as PolicyDecision['side'],
        instrumentId: row.instrumentId,
        notionalUsdcRaw: row.notionalUsdcRaw,
        denials: row.denials,
        evidence: row.evidence as PolicyDecision['evidence'],
        limitsApplied: row.limits,
        budget: row.budget as PolicyDecision['budget'],
        reservation: reservation === null ? null : toReservation(reservation),
        evaluatedAt: row.evaluatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    },

    async listReservations(principal) {
      const userId = requireUserId(principal);
      const rows = await listReservations(db, userId, now());
      return { reservations: rows.map(toReservation) };
    },

    async releaseReservation(principal, intentId, requestId) {
      const userId = requireUserId(principal);
      const row = await releaseReservation(db, { userId, intentId, now: now() });
      if (row === null) {
        throw new ApiError('NOT_FOUND', 'no held reservation exists for that intent');
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.reservation.released',
        targetType: 'spend_reservation',
        targetId: row.id,
        requestId,
        details: { intentId },
      });
      return toReservation(row);
    },

    async publishRules(principal, ruleSet, requestId) {
      const fixtureRules = ruleSet.rules.filter((rule) =>
        (FIXTURE_JURISDICTIONS as readonly string[]).includes(rule.jurisdiction),
      );
      if (fixtureRules.length > 0 && !isDev) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'fixture jurisdictions are refused outside local and test',
          [
            {
              path: 'body/rules',
              message: `user-assigned codes: ${fixtureRules.map((rule) => rule.jurisdiction).join(', ')}`,
            },
          ],
        );
      }
      let row: JurisdictionRuleSetRow;
      try {
        row = await publishJurisdictionRuleSet(db, {
          policyVersion: ruleSet.policyVersion,
          validityDays: ruleSet.validityDays,
          rules: ruleSet.rules,
          evidence: ruleSet.evidence,
          publishedBy: principal.id,
          now: now(),
        });
      } catch (error) {
        if (error instanceof PolicyVersionConflictError) {
          throw new ApiError('IDEMPOTENCY_CONFLICT', error.message);
        }
        throw error;
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.rules.published',
        targetType: 'jurisdiction_rule_set',
        targetId: row.policyVersion,
        requestId,
        details: {
          ruleCount: ruleSet.rules.length,
          validityDays: ruleSet.validityDays,
          evidence: ruleSet.evidence,
        },
      });
      return toRuleSet(row);
    },

    async listRuleSets() {
      const rows = await listJurisdictionRuleSets(db);
      return { ruleSets: rows.map(toRuleSet) };
    },

    async publishTerms(principal, document, requestId) {
      if (!document.url.startsWith('https://')) {
        throw new ApiError('VALIDATION_FAILED', 'terms must be published at an https URL', [
          { path: 'body/url', message: 'https required' },
        ]);
      }
      let row: TermsDocumentRow;
      try {
        row = await publishTermsDocument(db, {
          ...document,
          publishedBy: principal.id,
          now: now(),
        });
      } catch (error) {
        if (error instanceof PolicyVersionConflictError) {
          throw new ApiError('IDEMPOTENCY_CONFLICT', error.message);
        }
        throw error;
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.terms.published',
        targetType: 'terms_document',
        targetId: row.termsVersion,
        requestId,
        details: { contentHash: row.contentHash, requiredFor: row.requiredFor },
      });
      return toTerms(row);
    },

    async revokeEligibility(principal, decisionId, reason, requestId) {
      const existing = await findEligibilityDecision(db, decisionId);
      if (existing === null) {
        throw new ApiError('NOT_FOUND', 'no such eligibility decision');
      }
      const row = await revokeEligibilityDecision(db, { decisionId, reason, now: now() });
      if (row === null) {
        throw new ApiError('IDEMPOTENCY_CONFLICT', 'the decision was already revoked');
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.eligibility.revoked',
        targetType: 'eligibility_decision',
        targetId: row.id,
        requestId,
        details: { userId: row.userId, reason },
      });
      return toDecision(row);
    },

    async eligibilityHistory(userId) {
      const rows = await listEligibilityDecisions(db, userId);
      return { decisions: rows.map(toDecision) };
    },

    async addParticipant(principal, request, requestId) {
      const row = await addBetaParticipant(db, { ...request, addedBy: principal.id, now: now() });
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.participant.added',
        targetType: 'user',
        targetId: row.userId,
        requestId,
        details: { note: row.note },
      });
      return {
        userId: row.userId,
        note: row.note,
        addedAt: row.addedAt.toISOString(),
        addedBy: row.addedBy,
      };
    },

    async removeParticipant(principal, userId, requestId) {
      const removed = await removeBetaParticipant(db, userId);
      if (!removed) {
        throw new ApiError('NOT_FOUND', 'that user is not a beta participant');
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'policy.participant.removed',
        targetType: 'user',
        targetId: userId,
        requestId,
      });
    },

    async listParticipants() {
      const rows = await listBetaParticipants(db);
      return {
        participants: rows.map((row) => ({
          userId: row.userId,
          note: row.note,
          addedAt: row.addedAt.toISOString(),
          addedBy: row.addedBy,
        })),
      };
    },
  };
}
