import type { PlanMode, VenueQuote } from '@markov/contracts';
import { routeProgramVerdict } from './programs.js';

/**
 * Checks a venue quote against what the plan asked for and what policy
 * allows, before anything is built on it. An aggregator answer is untrusted
 * data: mints, amounts, slippage, freshness, price impact and every program
 * on the route are verified here; a failed check refuses the quote.
 */
export type QuoteIssueCode =
  | 'INPUT_MINT_MISMATCH'
  | 'OUTPUT_MINT_MISMATCH'
  | 'SWAP_MODE_UNSUPPORTED'
  | 'ZERO_INPUT'
  | 'INPUT_EXCEEDS_TARGET'
  | 'ZERO_OUTPUT'
  | 'MINIMUM_OUTPUT_INCONSISTENT'
  | 'SLIPPAGE_MISMATCH'
  | 'SLIPPAGE_ABOVE_LIMIT'
  | 'QUOTE_STALE'
  | 'QUOTE_EXPIRED'
  | 'PRICE_IMPACT_ABOVE_LIMIT'
  | 'ROUTE_PERCENT_TOTAL'
  | 'PROGRAM_NOT_REVIEWED'
  | 'PROGRAM_QUARANTINED'
  | 'PROGRAM_FIXTURE_ONLY';

export interface QuoteIssue {
  readonly code: QuoteIssueCode;
  readonly message: string;
}

export interface QuoteExpectation {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly targetInputRaw: bigint;
  readonly slippageBps: number;
  readonly maxSlippageBps: number;
  readonly maxQuoteAgeSeconds: number;
  readonly maxPriceImpactBps: number;
  readonly mode: PlanMode;
  readonly now: Date;
}

/** floor(out × (10,000 − slippage) / 10,000): the least output consistent with the quoted slippage. */
export function minimumOutputFor(outAmountRaw: bigint, slippageBps: number): bigint {
  return (outAmountRaw * (10_000n - BigInt(slippageBps))) / 10_000n;
}

export function checkQuote(quote: VenueQuote, expectation: QuoteExpectation): QuoteIssue[] {
  const issues: QuoteIssue[] = [];
  if (quote.inputMint !== expectation.inputMint) {
    issues.push({ code: 'INPUT_MINT_MISMATCH', message: 'the quote is for another input mint' });
  }
  if (quote.outputMint !== expectation.outputMint) {
    issues.push({ code: 'OUTPUT_MINT_MISMATCH', message: 'the quote is for another output mint' });
  }
  const inAmount = BigInt(quote.inAmountRaw);
  const outAmount = BigInt(quote.outAmountRaw);
  const threshold = BigInt(quote.otherAmountThresholdRaw);
  if (inAmount === 0n) {
    issues.push({ code: 'ZERO_INPUT', message: 'the quote consumes no input' });
  }
  if (inAmount > expectation.targetInputRaw) {
    issues.push({
      code: 'INPUT_EXCEEDS_TARGET',
      message: `the quote consumes ${inAmount} but the allocation target is ${expectation.targetInputRaw}`,
    });
  }
  if (outAmount === 0n) {
    issues.push({ code: 'ZERO_OUTPUT', message: 'the quote delivers nothing' });
  }
  if (quote.slippageBps !== expectation.slippageBps) {
    issues.push({
      code: 'SLIPPAGE_MISMATCH',
      message: `the quote was taken at ${quote.slippageBps} bps, not the requested ${expectation.slippageBps} bps`,
    });
  }
  if (quote.slippageBps > expectation.maxSlippageBps) {
    issues.push({
      code: 'SLIPPAGE_ABOVE_LIMIT',
      message: `slippage ${quote.slippageBps} bps is above the limit of ${expectation.maxSlippageBps} bps`,
    });
  }
  if (threshold > outAmount || threshold < minimumOutputFor(outAmount, quote.slippageBps)) {
    issues.push({
      code: 'MINIMUM_OUTPUT_INCONSISTENT',
      message: 'the minimum output is not consistent with the output and slippage the quote states',
    });
  }
  const observed = Date.parse(quote.observedAt);
  const expires = Date.parse(quote.expiresAt);
  const nowMs = expectation.now.getTime();
  if (Number.isNaN(observed) || nowMs - observed > expectation.maxQuoteAgeSeconds * 1000) {
    issues.push({
      code: 'QUOTE_STALE',
      message: `the quote is older than ${expectation.maxQuoteAgeSeconds} seconds`,
    });
  }
  if (Number.isNaN(expires) || expires <= nowMs) {
    issues.push({ code: 'QUOTE_EXPIRED', message: 'the quote has expired' });
  }
  if (quote.priceImpactBps !== null && quote.priceImpactBps > expectation.maxPriceImpactBps) {
    issues.push({
      code: 'PRICE_IMPACT_ABOVE_LIMIT',
      message: `price impact ${quote.priceImpactBps} bps is above the limit of ${expectation.maxPriceImpactBps} bps`,
    });
  }
  const percent = quote.routePlan.reduce((sum, step) => sum + step.percent, 0);
  if (percent !== 100) {
    issues.push({
      code: 'ROUTE_PERCENT_TOTAL',
      message: `the route steps sum to ${percent}%, not 100%`,
    });
  }
  for (const step of quote.routePlan) {
    const verdict = routeProgramVerdict(step.programId, expectation.mode);
    if (verdict === 'not_reviewed') {
      issues.push({
        code: 'PROGRAM_NOT_REVIEWED',
        message: `program ${step.programId} (${step.label}) is not in the reviewed route matrix`,
      });
    } else if (verdict === 'quarantined') {
      issues.push({
        code: 'PROGRAM_QUARANTINED',
        message: `program ${step.programId} (${step.label}) is quarantined`,
      });
    } else if (verdict === 'fixture_only') {
      issues.push({
        code: 'PROGRAM_FIXTURE_ONLY',
        message: `program ${step.programId} (${step.label}) exists only in fixture mode`,
      });
    }
  }
  return issues;
}
