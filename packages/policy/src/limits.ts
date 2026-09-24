import type { OwnerLimits } from '@markov/contracts';

/** Owner settings as they arrive: any subset, possibly with explicit undefined. */
export type OwnerLimitsPatch = { readonly [K in keyof OwnerLimits]?: OwnerLimits[K] | undefined };

/** Defaults that apply before any beta cap or owner setting; they can only be tightened below. */
export const POLICY_DEFAULT_LIMITS: OwnerLimits = {
  maxOrderNotionalUsdcRaw: '1000000000', // 1,000 USDC
  maxDailyNotionalUsdcRaw: '5000000000', // 5,000 USDC
  maxAccountNotionalUsdcRaw: '25000000000', // 25,000 USDC
  maxIssuerConcentrationBps: 5000,
  maxCompanyConcentrationBps: 3000,
  maxSlippageBps: 100,
  maxQuoteAgeSeconds: 60,
  cashReserveBps: 0,
  allowedVenues: ['jupiter'],
};

export interface BetaCapsLike {
  readonly maxOrderNotionalUsdcRaw: string;
  readonly maxDailyNotionalUsdcRaw: string;
  readonly maxAccountNotionalUsdcRaw: string;
}

export type CeilingSource = 'policy_defaults' | 'beta_caps';

function minRaw(a: string, b: string): string {
  return BigInt(a) <= BigInt(b) ? a : b;
}

/** The ceiling nobody can exceed: policy defaults, tightened by approved beta caps when configured. */
export function ceilingLimits(betaCaps: BetaCapsLike | null): {
  readonly ceiling: OwnerLimits;
  readonly source: CeilingSource;
} {
  if (betaCaps === null) {
    return { ceiling: POLICY_DEFAULT_LIMITS, source: 'policy_defaults' };
  }
  return {
    ceiling: {
      ...POLICY_DEFAULT_LIMITS,
      maxOrderNotionalUsdcRaw: minRaw(
        POLICY_DEFAULT_LIMITS.maxOrderNotionalUsdcRaw,
        betaCaps.maxOrderNotionalUsdcRaw,
      ),
      maxDailyNotionalUsdcRaw: minRaw(
        POLICY_DEFAULT_LIMITS.maxDailyNotionalUsdcRaw,
        betaCaps.maxDailyNotionalUsdcRaw,
      ),
      maxAccountNotionalUsdcRaw: minRaw(
        POLICY_DEFAULT_LIMITS.maxAccountNotionalUsdcRaw,
        betaCaps.maxAccountNotionalUsdcRaw,
      ),
    },
    source: 'beta_caps',
  };
}

/** Owner settings only ever tighten: every field is the minimum of the ceiling and the owner's value. */
export function effectiveLimits(ceiling: OwnerLimits, owner: OwnerLimitsPatch | null): OwnerLimits {
  if (owner === null) {
    return ceiling;
  }
  const venues = owner.allowedVenues
    ? ceiling.allowedVenues.filter((venue) => owner.allowedVenues?.includes(venue))
    : ceiling.allowedVenues;
  return {
    maxOrderNotionalUsdcRaw: minRaw(
      ceiling.maxOrderNotionalUsdcRaw,
      owner.maxOrderNotionalUsdcRaw ?? ceiling.maxOrderNotionalUsdcRaw,
    ),
    maxDailyNotionalUsdcRaw: minRaw(
      ceiling.maxDailyNotionalUsdcRaw,
      owner.maxDailyNotionalUsdcRaw ?? ceiling.maxDailyNotionalUsdcRaw,
    ),
    maxAccountNotionalUsdcRaw: minRaw(
      ceiling.maxAccountNotionalUsdcRaw,
      owner.maxAccountNotionalUsdcRaw ?? ceiling.maxAccountNotionalUsdcRaw,
    ),
    maxIssuerConcentrationBps: Math.min(
      ceiling.maxIssuerConcentrationBps,
      owner.maxIssuerConcentrationBps ?? ceiling.maxIssuerConcentrationBps,
    ),
    maxCompanyConcentrationBps: Math.min(
      ceiling.maxCompanyConcentrationBps,
      owner.maxCompanyConcentrationBps ?? ceiling.maxCompanyConcentrationBps,
    ),
    maxSlippageBps: Math.min(
      ceiling.maxSlippageBps,
      owner.maxSlippageBps ?? ceiling.maxSlippageBps,
    ),
    maxQuoteAgeSeconds: Math.min(
      ceiling.maxQuoteAgeSeconds,
      owner.maxQuoteAgeSeconds ?? ceiling.maxQuoteAgeSeconds,
    ),
    cashReserveBps: Math.max(
      ceiling.cashReserveBps,
      owner.cashReserveBps ?? ceiling.cashReserveBps,
    ),
    allowedVenues: venues.length > 0 ? venues : ceiling.allowedVenues,
  };
}

export interface LimitIssue {
  readonly path: string;
  readonly message: string;
}

/** Refuse settings that would loosen a ceiling instead of silently clamping them. */
export function validateOwnerLimits(
  ceiling: OwnerLimits,
  requested: OwnerLimitsPatch,
): LimitIssue[] {
  const issues: LimitIssue[] = [];
  const rawFields = [
    'maxOrderNotionalUsdcRaw',
    'maxDailyNotionalUsdcRaw',
    'maxAccountNotionalUsdcRaw',
  ] as const;
  for (const field of rawFields) {
    const value = requested[field];
    if (value !== undefined) {
      if (BigInt(value) === 0n) {
        issues.push({ path: field, message: 'must be greater than zero' });
      } else if (BigInt(value) > BigInt(ceiling[field])) {
        issues.push({ path: field, message: `cannot exceed the ceiling ${ceiling[field]}` });
      }
    }
  }
  const bpsFields = [
    'maxIssuerConcentrationBps',
    'maxCompanyConcentrationBps',
    'maxSlippageBps',
  ] as const;
  for (const field of bpsFields) {
    const value = requested[field];
    if (value !== undefined && value > ceiling[field]) {
      issues.push({ path: field, message: `cannot exceed the ceiling ${ceiling[field]} bps` });
    }
  }
  if (
    requested.maxQuoteAgeSeconds !== undefined &&
    requested.maxQuoteAgeSeconds > ceiling.maxQuoteAgeSeconds
  ) {
    issues.push({
      path: 'maxQuoteAgeSeconds',
      message: `cannot exceed the ceiling ${ceiling.maxQuoteAgeSeconds} s`,
    });
  }
  if (requested.cashReserveBps !== undefined && requested.cashReserveBps < ceiling.cashReserveBps) {
    issues.push({
      path: 'cashReserveBps',
      message: `cannot go below the ceiling ${ceiling.cashReserveBps} bps`,
    });
  }
  if (requested.allowedVenues) {
    for (const venue of requested.allowedVenues) {
      if (!ceiling.allowedVenues.includes(venue)) {
        issues.push({ path: 'allowedVenues', message: `${venue} is not an allowed venue` });
      }
    }
  }
  return issues;
}
