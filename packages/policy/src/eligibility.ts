import {
  type EligibilityCapability,
  type EligibilityOutcome,
  ISSUERS,
  type Issuer,
  type JurisdictionEvidenceKind,
  type JurisdictionRuleSet,
} from '@markov/contracts';

/** Stronger evidence satisfies a rule that asks for weaker evidence, never the reverse. */
export const EVIDENCE_STRENGTH: Readonly<Record<JurisdictionEvidenceKind, number>> = {
  self_declared: 0,
  operator_attested: 1,
  provider_verified: 2,
};

/** How long an `unknown` answer stands before the person is asked again. */
export const UNKNOWN_VALIDITY_DAYS = 1;

export interface EligibilityInput {
  readonly ruleSet: JurisdictionRuleSet | null;
  readonly jurisdiction: string;
  readonly evidenceKind: JurisdictionEvidenceKind;
  readonly capability: EligibilityCapability;
  readonly now: Date;
}

export interface EligibilityEvaluation {
  readonly outcome: EligibilityOutcome;
  readonly reasons: string[];
  readonly issuers: Issuer[];
  readonly expiresAt: Date;
  readonly policyVersion: string | null;
}

function days(from: Date, count: number): Date {
  return new Date(from.getTime() + count * 86_400_000);
}

/**
 * Evaluate eligibility from published rules only. No rule means unknown;
 * a deny rule wins over everything; an allow rule applies only when the
 * evidence is at least as strong as it requires; review answers unknown
 * until an operator attests. Deterministic for identical inputs.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityEvaluation {
  const { ruleSet } = input;
  if (ruleSet === null) {
    return {
      outcome: 'unknown',
      reasons: ['no jurisdiction rules are published; eligibility cannot be decided (OD-06)'],
      issuers: [],
      expiresAt: days(input.now, UNKNOWN_VALIDITY_DAYS),
      policyVersion: null,
    };
  }
  const applicable = ruleSet.rules.filter(
    (rule) => rule.jurisdiction === input.jurisdiction && rule.capability === input.capability,
  );
  if (applicable.length === 0) {
    return {
      outcome: 'unknown',
      reasons: [
        `no rule in policy ${ruleSet.policyVersion} covers jurisdiction ${input.jurisdiction} for ${input.capability}`,
      ],
      issuers: [],
      expiresAt: days(input.now, UNKNOWN_VALIDITY_DAYS),
      policyVersion: ruleSet.policyVersion,
    };
  }
  const denies = applicable.filter((rule) => rule.decision === 'deny');
  if (denies.length > 0) {
    return {
      outcome: 'ineligible',
      reasons: denies.map((rule) => rule.reason),
      issuers: [],
      expiresAt: days(input.now, ruleSet.validityDays),
      policyVersion: ruleSet.policyVersion,
    };
  }
  const strength = EVIDENCE_STRENGTH[input.evidenceKind];
  const allows = applicable.filter((rule) => rule.decision === 'allow');
  const satisfied = allows.filter((rule) => strength >= EVIDENCE_STRENGTH[rule.minimumEvidence]);
  if (satisfied.length > 0) {
    const issuers = new Set<Issuer>();
    for (const rule of satisfied) {
      for (const issuer of rule.issuers === 'all' ? ISSUERS : rule.issuers) {
        issuers.add(issuer);
      }
    }
    return {
      outcome: 'eligible',
      reasons: satisfied.map((rule) => rule.reason),
      issuers: [...issuers],
      expiresAt: days(input.now, ruleSet.validityDays),
      policyVersion: ruleSet.policyVersion,
    };
  }
  const reasons: string[] = [];
  for (const rule of allows) {
    reasons.push(
      `${rule.minimumEvidence} evidence is required; ${input.evidenceKind} was presented`,
    );
  }
  for (const rule of applicable.filter((candidate) => candidate.decision === 'review')) {
    reasons.push(`awaiting operator review: ${rule.reason}`);
  }
  return {
    outcome: 'unknown',
    reasons,
    issuers: [],
    expiresAt: days(input.now, UNKNOWN_VALIDITY_DAYS),
    policyVersion: ruleSet.policyVersion,
  };
}

export type EligibilityStanding = 'in_force' | 'missing' | 'revoked' | 'expired' | 'superseded';

export interface StandingDecision {
  readonly expiresAt: string | Date;
  readonly revokedAt: string | Date | null;
  readonly policyVersion: string | null;
}

/**
 * Whether a recorded decision still answers for the person: not revoked,
 * not past its expiry, and made under the rule set that is active now. A
 * decision under an older (or newer) version is contradictory evidence and
 * must be renewed; the service may tighten, never silently extend.
 */
export function eligibilityStanding(
  decision: StandingDecision | null,
  activePolicyVersion: string | null,
  now: Date,
): EligibilityStanding {
  if (decision === null) {
    return 'missing';
  }
  if (decision.revokedAt !== null) {
    return 'revoked';
  }
  if (new Date(decision.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  if (decision.policyVersion !== activePolicyVersion) {
    return 'superseded';
  }
  return 'in_force';
}

/** A decision still stands when it is not revoked and not past its expiry. */
export function decisionInForce(
  decision: { readonly expiresAt: string | Date; readonly revokedAt: string | Date | null } | null,
  now: Date,
): boolean {
  if (decision === null || decision.revokedAt !== null) {
    return false;
  }
  return new Date(decision.expiresAt).getTime() > now.getTime();
}

/** Rules for local and test environments only: user-assigned ISO codes, never a real country (OD-06). */
export const FIXTURE_JURISDICTION_RULE_SET: JurisdictionRuleSet = {
  policyVersion: '2026-09-24',
  validityDays: 180,
  evidence: { memo: 'fixture rule set for local and test environments; no counsel review' },
  rules: [
    {
      jurisdiction: 'ZZ',
      capability: 'trade_stocks',
      decision: 'allow',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture jurisdiction ZZ is allowed for every issuer',
    },
    {
      jurisdiction: 'XX',
      capability: 'trade_stocks',
      decision: 'deny',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture jurisdiction XX is denied',
    },
    {
      jurisdiction: 'XY',
      capability: 'trade_stocks',
      decision: 'allow',
      issuers: ['prestocks'],
      minimumEvidence: 'operator_attested',
      reason: 'fixture jurisdiction XY needs operator attestation and covers PreStocks only',
    },
    {
      jurisdiction: 'AA',
      capability: 'trade_stocks',
      decision: 'review',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture jurisdiction AA sits in the review queue',
    },
  ],
};

/** Fixture terms text and its SHA-256, so local journeys acknowledge a real hash of real text. */
export const FIXTURE_TERMS_TEXT =
  'Markov fixture terms 2026-09-24. Tokenised stock exposure is not a share of the underlying company. Prices shown are reference marks, never executable quotes. This text exists for local and test environments only.';
export const FIXTURE_TERMS_DOCUMENT = {
  termsVersion: '2026-09-24',
  title: 'Markov fixture terms',
  contentHash: '3e73752541d9a0114ae558e850d3d27ade94a5e524176b462cbcd401a52fb0b2',
  url: 'https://markov.pet/terms/fixture-2026-09-24',
  requiredFor: ['trade_stocks'] as ['trade_stocks'],
};
