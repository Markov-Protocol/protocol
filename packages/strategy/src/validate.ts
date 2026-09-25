import {
  companyKey,
  type DraftIssue,
  type Issuer,
  STRATEGY_TOTAL_BPS,
  type StrategyDraftContent,
} from '@markov/contracts';

/** What the validator needs to know about a catalog instrument. */
export interface KnownInstrument {
  readonly instrumentId: string;
  readonly status: string;
  readonly issuer: Issuer;
  readonly mint: string;
  readonly tokenProgram: string;
  readonly companyName: string;
  readonly symbol: string;
}

export interface ValidationLimits {
  readonly maxLegs: number;
  readonly maxIssuerConcentrationBps: number;
  readonly maxCompanyConcentrationBps: number;
}

export interface ValidationTotals {
  readonly legsBps: number;
  readonly cashBps: number;
  readonly totalBps: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: DraftIssue[];
  readonly totals: ValidationTotals;
}

const issue = (
  code: DraftIssue['code'],
  severity: DraftIssue['severity'],
  path: string,
  message: string,
  limit: number | null = null,
  observed: number | null = null,
): DraftIssue => ({ code, severity, path, message, limit, observed });

/**
 * Exact, deterministic recipe validation. Errors block freezing: legs must
 * exist, be at most the cap, reference distinct admitted instruments with
 * distinct mint identities, and weights plus cash must equal exactly
 * 10,000 basis points (integer arithmetic; nothing is renormalised).
 * Concentration by issuer and by underlying company is reported against
 * the policy ceiling as a warning: the execution policy re-checks the
 * account's real exposure with actual holdings (B05, B09).
 */
export function validateDraft(
  content: StrategyDraftContent,
  context: {
    readonly instruments: ReadonlyMap<string, KnownInstrument>;
    readonly limits: ValidationLimits;
  },
): ValidationResult {
  const issues: DraftIssue[] = [];
  const { legs } = content;
  if (legs.length === 0) {
    issues.push(
      issue(
        'NO_LEGS',
        'error',
        'legs',
        'a recipe needs at least one admitted instrument; cash alone is not a strategy',
      ),
    );
  }
  if (legs.length > context.limits.maxLegs) {
    issues.push(
      issue(
        'TOO_MANY_LEGS',
        'error',
        'legs',
        `at most ${context.limits.maxLegs} constituents are allowed in this deployment`,
        context.limits.maxLegs,
        legs.length,
      ),
    );
  }
  const seenInstruments = new Set<string>();
  const seenMints = new Map<string, string>();
  const issuerWeights = new Map<Issuer, number>();
  const companyWeights = new Map<string, { name: string; weight: number }>();
  let legsBps = 0;
  legs.forEach((leg, index) => {
    const path = `legs/${index}`;
    legsBps += leg.weightBps;
    if (seenInstruments.has(leg.instrumentId)) {
      issues.push(
        issue(
          'DUPLICATE_INSTRUMENT',
          'error',
          path,
          `instrument ${leg.instrumentId} appears twice`,
        ),
      );
    }
    seenInstruments.add(leg.instrumentId);
    if (leg.weightBps <= 0) {
      issues.push(
        issue(
          'ZERO_WEIGHT',
          'error',
          path,
          'a constituent needs a weight above zero; give it one or remove it',
          1,
          leg.weightBps,
        ),
      );
    }
    const instrument = context.instruments.get(leg.instrumentId);
    if (!instrument) {
      issues.push(
        issue(
          'UNKNOWN_INSTRUMENT',
          'error',
          path,
          `instrument ${leg.instrumentId} is not in the catalog`,
        ),
      );
      return;
    }
    if (instrument.status !== 'admitted') {
      issues.push(
        issue(
          'INSTRUMENT_NOT_ADMITTED',
          'error',
          path,
          `${instrument.symbol} is ${instrument.status}; only admitted instruments can be constituents`,
        ),
      );
    }
    const mintIdentity = `${instrument.tokenProgram}:${instrument.mint}`;
    const previous = seenMints.get(mintIdentity);
    if (previous !== undefined && previous !== leg.instrumentId) {
      issues.push(
        issue(
          'DUPLICATE_MINT',
          'error',
          path,
          `${instrument.symbol} shares its mint with another constituent`,
        ),
      );
    }
    seenMints.set(mintIdentity, leg.instrumentId);
    issuerWeights.set(
      instrument.issuer,
      (issuerWeights.get(instrument.issuer) ?? 0) + leg.weightBps,
    );
    const key = companyKey(instrument.companyName);
    const company = companyWeights.get(key) ?? { name: instrument.companyName, weight: 0 };
    company.weight += leg.weightBps;
    companyWeights.set(key, company);
  });
  const totalBps = legsBps + content.cashWeightBps;
  if (totalBps !== STRATEGY_TOTAL_BPS) {
    issues.push(
      issue(
        'WEIGHTS_TOTAL',
        'error',
        'cashWeightBps',
        `legs plus cash must equal exactly ${STRATEGY_TOTAL_BPS} basis points (${legsBps} in legs, ${content.cashWeightBps} cash)`,
        STRATEGY_TOTAL_BPS,
        totalBps,
      ),
    );
  }
  for (const [issuer, weight] of issuerWeights) {
    if (weight > context.limits.maxIssuerConcentrationBps) {
      issues.push(
        issue(
          'ISSUER_CONCENTRATION',
          'warning',
          'legs',
          `${weight} bps rest on ${issuer}; the policy ceiling for one issuer is ${context.limits.maxIssuerConcentrationBps} bps of an account`,
          context.limits.maxIssuerConcentrationBps,
          weight,
        ),
      );
    }
  }
  for (const company of companyWeights.values()) {
    if (company.weight > context.limits.maxCompanyConcentrationBps) {
      issues.push(
        issue(
          'COMPANY_CONCENTRATION',
          'warning',
          'legs',
          `${company.weight} bps rest on ${company.name} across issuers; the policy ceiling for one company is ${context.limits.maxCompanyConcentrationBps} bps of an account`,
          context.limits.maxCompanyConcentrationBps,
          company.weight,
        ),
      );
    }
  }
  return {
    valid: issues.every((item) => item.severity !== 'error'),
    issues,
    totals: { legsBps, cashBps: content.cashWeightBps, totalBps },
  };
}
