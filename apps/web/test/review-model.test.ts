import { describe, expect, it } from 'vitest';
import {
  contextWarnings,
  ctaLabel,
  describeRefusal,
  diffPlans,
  feeRows,
  formatCountdown,
  formatSol,
  intentOpen,
  isAcknowledged,
  legRows,
  minimumBudgetFromDetails,
  planValidity,
  transactionCount,
} from '../src/features/review/plan-model';
import { HASH, intent, OTHER, OWNER, plan, singlePlan } from './review-fixtures';

const at = (iso: string) => new Date(iso);

describe('plan validity and the final action', () => {
  it('counts down to the plan expiry and disables approval at zero or when the API says so', () => {
    expect(planValidity(plan(), at('2026-09-25T10:00:00.000Z'))).toEqual({
      phase: 'valid',
      secondsLeft: 30,
      approvable: true,
    });
    expect(planValidity(plan(), at('2026-09-25T10:00:20.000Z')).phase).toBe('expiring');
    expect(planValidity(plan(), at('2026-09-25T10:00:30.000Z'))).toEqual({
      phase: 'expired',
      secondsLeft: 0,
      approvable: false,
    });
    expect(planValidity(plan({ status: 'expired' }), at('2026-09-25T09:00:00.000Z')).phase).toBe(
      'expired',
    );
    expect(planValidity(plan({ status: 'superseded' }), at('2026-09-25T09:00:00.000Z'))).toEqual({
      phase: 'superseded',
      secondsLeft: 0,
      approvable: false,
    });
    expect(formatCountdown(65)).toBe('1 min 05 s');
    expect(formatCountdown(9)).toBe('9 s');
  });

  it('names the next action without ever claiming completion', () => {
    const now = at('2026-09-25T10:00:00.000Z');
    expect(ctaLabel(plan(), planValidity(plan(), now))).toBe('Approve staged plan');
    expect(ctaLabel(singlePlan(), planValidity(singlePlan(), now))).toBe('Approve plan');
    expect(ctaLabel(plan(), planValidity(plan(), at('2026-09-25T11:00:00.000Z')))).toBe(
      'Refresh terms',
    );
    const approved = plan({
      review: {
        acknowledgedAt: now.toISOString(),
        acknowledgedHash: HASH,
        stagedAcknowledged: true,
      },
    });
    expect(isAcknowledged(approved)).toBe(true);
    expect(ctaLabel(approved, planValidity(approved, now))).toBe('Sign transaction 1 of 2');
    expect(transactionCount(plan())).toEqual({ batches: 2, signaturesPerBatch: 1, signatures: 2 });
    expect(transactionCount(singlePlan()).signatures).toBe(1);
    expect(intentOpen(intent())).toBe(true);
    expect(intentOpen(intent({ state: 'CANCELLED' }))).toBe(false);
  });
});

describe('what the plan says', () => {
  it('formats legs, fees and SOL exactly, in the right units, without double counting', () => {
    const rows = legRows(plan());
    expect(rows.map((row) => row.symbol)).toEqual(['FXAERO', 'XSFXA']);
    expect(rows[0]).toMatchObject({
      weight: '60.00%',
      maxInput: '600 USDC',
      expectedOutput: '32.77726 FXAERO',
      minimumOutput: '32.613373 FXAERO',
      priceImpact: '0.00%',
      slippage: '0.50%',
      batchLabel: 'Transaction 1 of 2',
      decision: 'allow (2026-09-24)',
    });
    expect(rows[1]?.expectedOutput).toBe('2.95566574 XSFXA');
    expect(legRows(singlePlan())[0]?.batchLabel).toBe('One transaction');
    const fees = feeRows(plan());
    expect(fees.map((row) => row.label)).toEqual([
      'Base network fee',
      'Priority fee, at most',
      'Token account rent, at most',
      'Total SOL needed, at most',
      'Markov fee',
    ]);
    expect(fees[0]?.value).toBe('0.00001 SOL');
    expect(fees[2]?.value).toBe('0.00407856 SOL');
    expect(fees[3]?.value).toBe('0.00428856 SOL');
    expect(fees[4]?.value).toBe('0 USDC');
    expect(fees[4]?.note).toContain('beta-0');
    expect(formatSol('1000000000')).toBe('1 SOL');
  });

  it('reports only binding differences between a reviewed plan and a refreshed one', () => {
    const same = diffPlans(plan(), plan({ planId: 'x', planHash: 'y', warnings: [] }));
    expect(same.changed).toBe(false);
    const refreshed = plan({
      planHash: 'z'.padEnd(64, 'z'),
      legs: plan().legs.map((leg, index) =>
        index === 0
          ? {
              ...leg,
              expectedOutputRaw: '32000000',
              minimumOutputRaw: '31840000',
              priceImpactBps: 120,
            }
          : leg,
      ),
      fees: {
        ...plan().fees,
        network: { ...plan().fees.network, totalLamportsMax: '4388560' },
      },
      validity: { ...plan().validity, expiresAt: '2026-09-25T10:05:30.000Z' },
    });
    const difference = diffPlans(plan(), refreshed);
    expect(difference.changed).toBe(true);
    expect(difference.constituentsDiffer).toBe(false);
    expect(difference.fields.map((field) => field.label)).toEqual([
      'Total SOL needed, at most',
      'Valid until',
    ]);
    expect(difference.fields[0]).toEqual({
      label: 'Total SOL needed, at most',
      before: '0.00428856 SOL',
      after: '0.00438856 SOL',
    });
    expect(difference.legs).toEqual([
      {
        symbol: 'FXAERO',
        changes: [
          { label: 'Expected output', before: '32.77726 FXAERO', after: '32 FXAERO' },
          { label: 'Minimum output', before: '32.613373 FXAERO', after: '31.84 FXAERO' },
          { label: 'Price impact', before: '0.00%', after: '1.20%' },
        ],
      },
    ]);
    const otherWallet = diffPlans(
      plan(),
      plan({
        wallet: { walletId: 'w', address: OTHER },
        fees: { ...plan().fees, feePayer: OTHER },
      }),
    );
    expect(otherWallet.fields.map((field) => field.label)).toEqual(['Fee payer', 'Wallet']);
    const fewerLegs = diffPlans(plan(), singlePlan());
    expect(fewerLegs.constituentsDiffer).toBe(true);
    expect(fewerLegs.fields.map((field) => field.label)).toContain('Strategy version');
  });

  it('warns about the person’s context without changing what the plan is bound to', () => {
    expect(
      contextWarnings(plan(), {
        connectedAddress: OWNER,
        chainMatches: true,
        newestVersionNumber: 1,
      }),
    ).toEqual([]);
    expect(
      contextWarnings(plan(), {
        connectedAddress: null,
        chainMatches: null,
        newestVersionNumber: null,
      }).map((warning) => warning.code),
    ).toEqual(['not_connected']);
    expect(
      contextWarnings(plan(), {
        connectedAddress: OTHER,
        chainMatches: true,
        newestVersionNumber: 2,
      }).map((warning) => warning.code),
    ).toEqual(['wallet_differs', 'newer_version']);
    expect(
      contextWarnings(plan(), {
        connectedAddress: OWNER,
        chainMatches: false,
        newestVersionNumber: 1,
      })[0]?.code,
    ).toBe('wallet_network');
    expect(
      contextWarnings(singlePlan(), {
        connectedAddress: OWNER,
        chainMatches: true,
        newestVersionNumber: 9,
      }),
    ).toEqual([]);
  });
});

describe('refusals become actions, never bypasses', () => {
  const href = '/review/new?strategyId=s&versionId=v';
  it('maps each API refusal to a title, the API details and one honest next step', () => {
    const funds = describeRefusal(
      {
        status: 409,
        code: 'INSUFFICIENT_FUNDS',
        message: 'the wallet cannot fund this plan',
        details: [
          {
            path: 'funds.stablecoin',
            message: 'the plan spends up to 1000000000 raw USDC; the wallet holds 0',
          },
          {
            path: 'funds.sol',
            message: 'network fees and rent need up to 4288560 lamports; the wallet holds 0',
          },
        ],
      },
      { newReviewHref: href },
    );
    expect(funds.title).toBe('The wallet cannot fund this plan');
    expect(funds.items).toHaveLength(2);
    expect(funds.action).toEqual({ kind: 'fund', label: 'Add funds', href: '/settings/wallets' });

    const capped = describeRefusal(
      {
        status: 403,
        code: 'POLICY_DENIED',
        message: 'policy denied the FXAERO leg',
        details: [
          {
            path: 'legs[0]',
            message: 'ORDER_CAP_EXCEEDED: the order would exceed the per-order cap',
          },
        ],
      },
      { newReviewHref: href },
    );
    expect(capped.action.kind).toBe('budget');
    expect(capped.action.href).toBe(href);
    const terms = describeRefusal(
      {
        status: 403,
        code: 'POLICY_DENIED',
        message: 'policy denied the FXAERO leg',
        details: [
          { path: 'legs[0]', message: 'TERMS_NOT_ACKNOWLEDGED: acknowledge the current terms' },
        ],
      },
      { newReviewHref: href },
    );
    expect(terms.action).toEqual({
      kind: 'eligibility',
      label: 'Open eligibility and terms',
      href: '/settings/eligibility',
    });
    const stale = describeRefusal(
      {
        status: 403,
        code: 'POLICY_DENIED',
        message: 'policy denied the FXBIO leg',
        details: [{ path: 'legs[0]', message: 'REFERENCE_STALE: the reference price is stale' }],
      },
      { newReviewHref: href },
    );
    expect(stale.action.kind).toBe('none');

    const zero = describeRefusal(
      {
        status: 503,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'the venue quote for FXAERO failed 1 check and was refused',
        details: [{ path: 'legs[0]', message: 'ZERO_OUTPUT: the quote delivers nothing' }],
      },
      { newReviewHref: href },
    );
    expect(zero.title).toBe('Quotes are unavailable right now');
    expect(zero.items[0]).toContain('ZERO_OUTPUT');
    expect(zero.action.kind).toBe('retry');

    const tiny = describeRefusal(
      {
        status: 400,
        code: 'VALIDATION_FAILED',
        message:
          'the budget is below the route minimum of 1 constituent; the weights were not changed',
        details: [
          { path: 'budget.rawAmount', message: 'the smallest workable budget is 2222223 raw USDC' },
        ],
      },
      { newReviewHref: href },
    );
    expect(tiny.title).toBe('The budget is too small for the route');
    expect(tiny.minimumBudgetRaw).toBe('2222223');
    expect(tiny.action.kind).toBe('budget');
    expect(minimumBudgetFromDetails([{ message: 'nothing here' }])).toBeNull();

    expect(
      describeRefusal(
        { status: 409, code: 'PLAN_CHANGED', message: 'a newer plan exists', details: [] },
        { newReviewHref: null },
      ).action.kind,
    ).toBe('reload');
    expect(
      describeRefusal(
        { status: 409, code: 'QUOTE_EXPIRED', message: 'expired', details: [] },
        { newReviewHref: null },
      ).action,
    ).toEqual({ kind: 'retry', label: 'Refresh terms', href: null });
    expect(
      describeRefusal(
        { status: 0, code: 'NETWORK', message: 'unreachable', details: [] },
        { newReviewHref: null },
      ).title,
    ).toBe('Markov could not be reached');
  });
});
