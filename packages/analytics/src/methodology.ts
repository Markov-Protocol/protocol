import {
  type MethodologySummary,
  PERFORMANCE_METHODOLOGY_VERSION,
  PRICE_MAX_AGE_MS,
  RANKING_MIN_HISTORY_DAYS,
  STABLECOIN_DEPEG_BPS,
  VALUATION_CURRENCY,
} from '@markov/contracts';

/** The fixed wording every performance answer carries. */
export const PERFORMANCE_NOTE =
  'Valuations use recorded reference prices, never executable quotes, and historical multipliers. A deposit or withdrawal is an external flow, never a return. A model series is the published recipe held from its start without costs; an actual series is this account’s executed holdings. Incomplete periods report no return.' as const;

export const RANKING_NOTE =
  'Model series of published recipes under one methodology version, ranked by time-weighted return over the period. Nobody’s account is ranked here; an incomplete or short history is listed without a rank and without a return.' as const;

export const PRICE_HISTORY_NOTE =
  'Recorded reference observations with their kind, unit, time and source. A reference price is not an executable offer, and an implied company valuation is not a token price.' as const;

export const METHODOLOGY_DOCUMENT =
  'docs/markov/accounting-methodology.md#valuation-and-performance-b13';

export function methodologySummary(): MethodologySummary {
  return {
    version: PERFORMANCE_METHODOLOGY_VERSION,
    currency: VALUATION_CURRENCY,
    priceMaxAgeMs: PRICE_MAX_AGE_MS,
    rankingMinHistoryDays: RANKING_MIN_HISTORY_DAYS,
    stablecoinDepegBps: STABLECOIN_DEPEG_BPS,
    pricing:
      'At each point the latest recorded observation at or before the point values a token, taking a secondary-market price first, an issuer mark second and the underlying equity price third (stated as an assumption); an implied company valuation never prices a token. An observation older than priceMaxAgeMs, or in another unit, values nothing and the point is incomplete. A scaled token is valued as raw units × the multiplier in force at the point (from recorded evidence; never assumed) × the price per display unit.',
    cashTreatment:
      'The configured stablecoin is valued at its recorded observation when one is fresh, otherwise at par (1 per unit) as a stated assumption; an observation more than stablecoinDepegBps from par is reported as a depeg. Lamports are valued only from recorded SOL observations.',
    flows:
      'Points sit on every UTC midnight between start and end, plus the start, the end and the exact time of every external flow (deposits, withdrawals, transfers acknowledged or pending; for a strategy instance the cost of what it bought and the proceeds of what it sold). A flow is valued at its own time. Each subperiod return is (V_k − F_k) / V_{k−1} − 1 with F_k the net flow at its end, so money entering the subject never counts as gain.',
    returns:
      'The time-weighted return chains the subperiod returns (the index starts at 100). The money-weighted return is Modified Dietz over the window with flows weighted by the time they were in the portfolio. Drawdown is the largest peak-to-trough decline of the chained index. Turnover is the traded value in the window over the average valuation. Realized P&L is proceeds minus FIFO cost of consumed lots; unrealized P&L is the end value minus the remaining cost of open lots. Any incomplete point, unvalued flow or non-positive base leaves the window’s return and drawdown null with the reason.',
    modelAssumptions:
      'A model series buys whole base units of every leg at the first point at or after the freeze where every leg is priced and every multiplier known, at the target weights of an opening notional, holds the cash weight in the stablecoin, and never rebalances; it carries no fees, slippage or taxes and is not anyone’s account. Rankings use model series only, compare one period and one methodology version, and require at least rankingMinHistoryDays of complete history, a complete window and a fresh end price.',
    document: METHODOLOGY_DOCUMENT,
  };
}
