import type { PolicyDecision, PolicyDenial, PolicyDenialCode } from '@markov/contracts';

/**
 * Owner-facing explanations of policy denials (B15). Each remedy names what
 * the person can do; none of it is something a tool does for them, and a
 * limit is never described as negotiable by an assistant.
 */
export const DENIAL_REMEDIES: Readonly<Record<PolicyDenialCode, string>> = {
  EXECUTION_DISABLED:
    'Execution writes are switched off on this deployment; plans can be reviewed but nothing is submitted until operators enable them.',
  PARTICIPANT_NOT_ALLOWLISTED:
    'Your account is not in the private beta allowlist; ask the operators to add it.',
  ELIGIBILITY_UNKNOWN:
    'Declare your jurisdiction under Settings → Eligibility so the policy can decide.',
  ELIGIBILITY_DENIED:
    'The declared jurisdiction is not served for this issuer; this is a rule of the platform, not a setting you can change.',
  ELIGIBILITY_EXPIRED: 'Your eligibility decision expired; declare your jurisdiction again.',
  ELIGIBILITY_SUPERSEDED:
    'The rules changed since your last declaration; declare your jurisdiction again under the current rules.',
  TERMS_NOT_ACKNOWLEDGED:
    'Read and acknowledge the current terms under Settings → Eligibility before trading.',
  INSTRUMENT_NOT_ADMITTED:
    'This instrument is not admitted for trading; pick an admitted one or wait for an operator decision.',
  ISSUER_NOT_COVERED: 'Your eligibility decision does not cover this issuer.',
  ISSUER_HALTED: 'The issuer is halted; nothing can be planned until the halt is lifted.',
  CORPORATE_ACTION_PENDING:
    'A corporate action is pending on this instrument; wait until it is applied.',
  MIGRATION_REQUIRED:
    'The instrument requires a migration by the issuer before it can be traded again.',
  INSTRUMENT_SUNSET: 'The instrument is being sunset; new purchases are refused.',
  MULTIPLIER_UNKNOWN:
    'The token’s scaled-amount multiplier is not known for now; quantities cannot be trusted until the catalog records it.',
  REFERENCE_STALE:
    'The reference price is stale; a plan waits for a fresh observation rather than trading blind.',
  ORDER_CAP_EXCEEDED:
    'Lower the order size, or raise your per-order limit under Settings → Limits (never above the platform ceiling).',
  DAILY_CAP_EXCEEDED:
    'The daily notional is used up; wait for the next UTC day or lower the order.',
  ACCOUNT_CAP_EXCEEDED:
    'The account notional cap is reached; sell down or wait for the beta caps to change.',
  ISSUER_CONCENTRATION_EXCEEDED:
    'The order would concentrate too much in one issuer; reduce it or diversify the recipe.',
  COMPANY_CONCENTRATION_EXCEEDED:
    'The order would concentrate too much in one company; reduce it or diversify the recipe.',
  SLIPPAGE_LIMIT_EXCEEDED:
    'The requested slippage is above your limit; leave it at the default or tighten the request.',
  QUOTE_STALE: 'The quote is older than your maximum quote age; request a fresh plan.',
  VENUE_NOT_ALLOWED: 'The venue is not in your allowed venues.',
  VENUE_DISABLED: 'The venue is not verified and enabled on this platform.',
  CASH_RESERVE_BREACHED:
    'The order would leave less cash than your cash reserve; lower it or the reserve.',
  EXPOSURE_UNKNOWN:
    'Your current exposure could not be established; reconcile the wallet before concentration limits can be checked.',
  NOTIONAL_ZERO: 'The amount must be greater than zero.',
};

export interface DenialExplanation {
  readonly code: PolicyDenialCode;
  readonly message: string;
  readonly remedy: string;
}

export function explainDenial(denial: PolicyDenial): DenialExplanation {
  return {
    code: denial.code,
    message: withLimit(denial),
    remedy: DENIAL_REMEDIES[denial.code],
  };
}

function withLimit(denial: PolicyDenial): string {
  if (denial.limit === null || denial.observed === null) {
    return denial.message.slice(0, 400);
  }
  const unit = denial.unit ? ` ${denial.unit}` : '';
  return `${denial.message} (limit ${denial.limit}${unit}, observed ${denial.observed}${unit})`.slice(
    0,
    400,
  );
}

export function explainDecision(decision: Pick<PolicyDecision, 'outcome' | 'denials'>): {
  readonly explanation: DenialExplanation[];
  readonly summary: string;
} {
  const explanation = decision.denials.map(explainDenial);
  if (decision.outcome === 'allow') {
    return {
      explanation,
      summary:
        'Allowed at this stage. A plan re-evaluates at quote time and again at submission; an allowance now is not an approval.',
    };
  }
  const codes = explanation.map((entry) => entry.code).join(', ');
  return {
    explanation,
    summary: `Denied by ${explanation.length} rule${explanation.length === 1 ? '' : 's'} (${codes}). Nothing was reserved or ordered; the remedies say what the owner can change.`,
  };
}
