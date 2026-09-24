import { createHash } from 'node:crypto';
import {
  FIXTURE_JURISDICTIONS,
  type InstrumentLifecycle,
  type JurisdictionRuleSet,
  jurisdictionRuleSetSchema,
  type OwnerLimits,
  termsPublishRequestSchema,
} from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  capabilityStatesFor,
  ceilingLimits,
  companyKeyOf,
  decisionInForce,
  effectiveLimits,
  eligibilityStanding,
  evaluateEligibility,
  evaluatePolicy,
  FIXTURE_JURISDICTION_RULE_SET,
  FIXTURE_TERMS_DOCUMENT,
  FIXTURE_TERMS_TEXT,
  POLICY_DEFAULT_LIMITS,
  type PolicyEligibility,
  type PolicyInput,
  validateOwnerLimits,
} from '../src/index.js';

const NOW = new Date('2026-09-24T12:00:00Z');
const RULES: JurisdictionRuleSet = {
  policyVersion: '2026-09-24',
  validityDays: 180,
  evidence: { memo: 'fixture' },
  rules: [
    {
      jurisdiction: 'ZZ',
      capability: 'trade_stocks',
      decision: 'allow',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture jurisdiction',
    },
    {
      jurisdiction: 'XX',
      capability: 'trade_stocks',
      decision: 'deny',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture denial',
    },
    {
      jurisdiction: 'XY',
      capability: 'trade_stocks',
      decision: 'allow',
      issuers: ['prestocks'],
      minimumEvidence: 'operator_attested',
      reason: 'fixture attested only',
    },
    {
      jurisdiction: 'AA',
      capability: 'trade_stocks',
      decision: 'review',
      issuers: 'all',
      minimumEvidence: 'self_declared',
      reason: 'fixture review queue',
    },
  ],
};

describe('eligibility', () => {
  it('answers unknown without rules, denies before allowing, and honours evidence strength', () => {
    expect(
      evaluateEligibility({
        ruleSet: null,
        jurisdiction: 'ZZ',
        evidenceKind: 'self_declared',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'unknown', policyVersion: null });
    expect(
      evaluateEligibility({
        ruleSet: RULES,
        jurisdiction: 'QQ',
        evidenceKind: 'provider_verified',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({
      outcome: 'unknown',
      reasons: [expect.stringContaining('no rule in policy 2026-09-24 covers jurisdiction QQ')],
    });
    const eligible = evaluateEligibility({
      ruleSet: RULES,
      jurisdiction: 'ZZ',
      evidenceKind: 'self_declared',
      capability: 'trade_stocks',
      now: NOW,
    });
    expect(eligible).toMatchObject({
      outcome: 'eligible',
      issuers: ['prestocks', 'xstocks', 'tessera'],
      policyVersion: '2026-09-24',
    });
    expect(eligible.expiresAt.toISOString()).toBe('2027-03-23T12:00:00.000Z');
    expect(
      evaluateEligibility({
        ruleSet: RULES,
        jurisdiction: 'XX',
        evidenceKind: 'provider_verified',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'ineligible', reasons: ['fixture denial'] });
    expect(
      evaluateEligibility({
        ruleSet: RULES,
        jurisdiction: 'XY',
        evidenceKind: 'self_declared',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({
      outcome: 'unknown',
      reasons: ['operator_attested evidence is required; self_declared was presented'],
    });
    expect(
      evaluateEligibility({
        ruleSet: RULES,
        jurisdiction: 'XY',
        evidenceKind: 'operator_attested',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'eligible', issuers: ['prestocks'] });
    expect(
      evaluateEligibility({
        ruleSet: RULES,
        jurisdiction: 'AA',
        evidenceKind: 'self_declared',
        capability: 'trade_stocks',
        now: NOW,
      }),
    ).toMatchObject({
      outcome: 'unknown',
      reasons: ['awaiting operator review: fixture review queue'],
    });
    expect(decisionInForce({ expiresAt: '2026-09-25T00:00:00Z', revokedAt: null }, NOW)).toBe(true);
    expect(decisionInForce({ expiresAt: '2026-09-23T00:00:00Z', revokedAt: null }, NOW)).toBe(
      false,
    );
    expect(
      decisionInForce(
        { expiresAt: '2026-09-25T00:00:00Z', revokedAt: '2026-09-24T00:00:00Z' },
        NOW,
      ),
    ).toBe(false);
    expect(eligibilityStanding(null, '2026-09-24', NOW)).toBe('missing');
    expect(
      eligibilityStanding(
        { expiresAt: '2026-09-25T00:00:00Z', revokedAt: null, policyVersion: '2026-09-24' },
        '2026-09-24',
        NOW,
      ),
    ).toBe('in_force');
    expect(
      eligibilityStanding(
        { expiresAt: '2026-09-25T00:00:00Z', revokedAt: null, policyVersion: '2026-09-01' },
        '2026-09-24',
        NOW,
      ),
    ).toBe('superseded');
    expect(
      eligibilityStanding(
        {
          expiresAt: '2026-09-25T00:00:00Z',
          revokedAt: '2026-09-24T00:00:00Z',
          policyVersion: '2026-09-24',
        },
        '2026-09-24',
        NOW,
      ),
    ).toBe('revoked');
    expect(
      eligibilityStanding(
        { expiresAt: '2026-09-23T00:00:00Z', revokedAt: null, policyVersion: '2026-09-24' },
        '2026-09-24',
        NOW,
      ),
    ).toBe('expired');
  });

  it('ships fixtures that satisfy the contracts, use only user-assigned codes and hash their own text', () => {
    expect(jurisdictionRuleSetSchema.parse(FIXTURE_JURISDICTION_RULE_SET)).toEqual(
      FIXTURE_JURISDICTION_RULE_SET,
    );
    for (const rule of FIXTURE_JURISDICTION_RULE_SET.rules) {
      expect(FIXTURE_JURISDICTIONS).toContain(rule.jurisdiction);
    }
    expect(termsPublishRequestSchema.parse(FIXTURE_TERMS_DOCUMENT)).toEqual(FIXTURE_TERMS_DOCUMENT);
    expect(createHash('sha256').update(FIXTURE_TERMS_TEXT).digest('hex')).toBe(
      FIXTURE_TERMS_DOCUMENT.contentHash,
    );
  });
});

describe('limits', () => {
  it('lets beta caps and owners only tighten', () => {
    const { ceiling, source } = ceilingLimits({
      maxOrderNotionalUsdcRaw: '500000000',
      maxDailyNotionalUsdcRaw: '9000000000',
      maxAccountNotionalUsdcRaw: '2000000000',
    });
    expect(source).toBe('beta_caps');
    expect(ceiling).toMatchObject({
      maxOrderNotionalUsdcRaw: '500000000',
      maxDailyNotionalUsdcRaw: '5000000000',
      maxAccountNotionalUsdcRaw: '2000000000',
    });
    const effective = effectiveLimits(ceiling, {
      maxOrderNotionalUsdcRaw: '900000000',
      maxSlippageBps: 30,
      cashReserveBps: 500,
      allowedVenues: ['jupiter'],
    });
    expect(effective).toMatchObject({
      maxOrderNotionalUsdcRaw: '500000000',
      maxSlippageBps: 30,
      cashReserveBps: 500,
    });
    expect(
      validateOwnerLimits(ceiling, {
        maxOrderNotionalUsdcRaw: '900000000',
        maxIssuerConcentrationBps: 9000,
        cashReserveBps: 0,
        maxOrderNotionalUsdcRawZero: '0',
      } as Partial<OwnerLimits>),
    ).toEqual([
      { path: 'maxOrderNotionalUsdcRaw', message: 'cannot exceed the ceiling 500000000' },
      { path: 'maxIssuerConcentrationBps', message: 'cannot exceed the ceiling 5000 bps' },
    ]);
    expect(validateOwnerLimits(ceiling, { maxOrderNotionalUsdcRaw: '0' })).toEqual([
      { path: 'maxOrderNotionalUsdcRaw', message: 'must be greater than zero' },
    ]);
    expect(ceilingLimits(null)).toEqual({
      ceiling: POLICY_DEFAULT_LIMITS,
      source: 'policy_defaults',
    });
  });
});

const lifecycle: InstrumentLifecycle = {
  halted: false,
  haltedReason: null,
  pendingActions: [],
  migration: null,
  sunsetAt: null,
  currentMultiplier: '1',
  multiplierEffectiveAt: '2026-09-24T00:00:00.000Z',
};

function baseInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    now: NOW,
    stage: 'quote',
    side: 'buy',
    instrument: {
      instrumentId: 'inst-a',
      issuer: 'prestocks',
      companyKey: companyKeyOf('Fixture Aerospace Inc'),
      status: 'admitted',
      lifecycle,
      referencePriceStale: false,
    },
    notionalUsdcRaw: '100000000',
    venue: 'jupiter',
    slippageBps: 50,
    quoteObservedAt: null,
    exposure: {
      source: 'caller_declared',
      observedAt: NOW.toISOString(),
      positions: [],
      cashUsdcRaw: '1000000000',
    },
    positions: [],
    limits: POLICY_DEFAULT_LIMITS,
    eligibility: {
      decisionId: 'dec-1',
      outcome: 'eligible',
      issuers: ['prestocks', 'xstocks'],
      expiresAt: '2027-01-01T00:00:00Z',
      revokedAt: null,
      policyVersion: '2026-09-24',
    },
    activePolicyVersion: '2026-09-24',
    termsComplete: true,
    executionWritesEnabled: false,
    venueEnabled: false,
    participantAllowlisted: true,
    dailyUsedUsdcRaw: '0',
    reservedUsdcRaw: '0',
    ...overrides,
  };
}

const codes = (input: PolicyInput) => evaluatePolicy(input).denials.map((item) => item.code);

describe('policy evaluation', () => {
  it('allows a valid quote-stage request and blocks submission while execution is disabled', () => {
    const allowed = evaluatePolicy(baseInput());
    expect(allowed.outcome).toBe('allow');
    expect(allowed.budget).toEqual({
      dailyUsedUsdcRaw: '100000000',
      dailyRemainingUsdcRaw: '4900000000',
      accountUsedUsdcRaw: '100000000',
      accountRemainingUsdcRaw: '24900000000',
    });
    expect(allowed.expiresAt.toISOString()).toBe('2026-09-24T12:01:00.000Z');
    expect(codes(baseInput({ stage: 'submit' }))).toEqual(['EXECUTION_DISABLED', 'VENUE_DISABLED']);
    expect(
      codes(
        baseInput({
          stage: 'submit',
          executionWritesEnabled: true,
          venueEnabled: true,
          exposure: { source: 'none', observedAt: null, positions: [], cashUsdcRaw: null },
        }),
      ),
    ).toEqual(['EXPOSURE_UNKNOWN']);
    expect(
      codes(
        baseInput({
          exposure: { source: 'none', observedAt: null, positions: [], cashUsdcRaw: null },
        }),
      ),
    ).toEqual([]);
    expect(evaluatePolicy(baseInput())).toEqual(evaluatePolicy(baseInput()));
  });

  it('reports every failing check with limit and observed value', () => {
    const denied = evaluatePolicy(
      baseInput({
        notionalUsdcRaw: '2000000000',
        slippageBps: 300,
        venue: 'unknown-venue',
        quoteObservedAt: new Date('2026-09-24T11:58:00Z'),
        eligibility: null,
        termsComplete: false,
        participantAllowlisted: false,
        dailyUsedUsdcRaw: '4500000000',
      }),
    );
    expect(denied.outcome).toBe('deny');
    expect(denied.denials.map((item) => item.code)).toEqual([
      'PARTICIPANT_NOT_ALLOWLISTED',
      'ELIGIBILITY_UNKNOWN',
      'TERMS_NOT_ACKNOWLEDGED',
      'VENUE_NOT_ALLOWED',
      'SLIPPAGE_LIMIT_EXCEEDED',
      'QUOTE_STALE',
      'ORDER_CAP_EXCEEDED',
      'DAILY_CAP_EXCEEDED',
      'ISSUER_CONCENTRATION_EXCEEDED',
      'COMPANY_CONCENTRATION_EXCEEDED',
      'CASH_RESERVE_BREACHED',
    ]);
    expect(
      denied.denials.find((item) => item.code === 'COMPANY_CONCENTRATION_EXCEEDED'),
    ).toMatchObject({ limit: '3000', observed: '6666', unit: 'bps' });
    expect(denied.denials.find((item) => item.code === 'ORDER_CAP_EXCEEDED')).toEqual({
      code: 'ORDER_CAP_EXCEEDED',
      message: 'the order exceeds the per-order cap',
      limit: '1000000000',
      observed: '2000000000',
      unit: 'USDC raw',
    });
    expect(denied.denials.find((item) => item.code === 'QUOTE_STALE')).toMatchObject({
      limit: '60',
      observed: '120',
      unit: 'seconds',
    });
    expect(denied.budget.dailyUsedUsdcRaw).toBe('4500000000');
  });

  it('counts company exposure across issuers and issuer exposure separately', () => {
    const company = companyKeyOf('Fixture Alpha Holdings');
    expect(companyKeyOf('FIXTURE ALPHA HOLDINGS INC.')).toBe(company);
    const positions = [
      {
        instrumentId: 'inst-x',
        issuer: 'xstocks' as const,
        companyKey: company,
        notionalUsdcRaw: '250000000',
      },
      {
        instrumentId: 'inst-o',
        issuer: 'prestocks' as const,
        companyKey: companyKeyOf('Other Co'),
        notionalUsdcRaw: '250000000',
      },
    ];
    const buyMoreOfSameCompany = baseInput({
      instrument: {
        instrumentId: 'inst-p',
        issuer: 'prestocks',
        companyKey: company,
        status: 'admitted',
        lifecycle,
        referencePriceStale: false,
      },
      positions,
      notionalUsdcRaw: '200000000',
      exposure: {
        source: 'caller_declared',
        observedAt: NOW.toISOString(),
        positions: [],
        cashUsdcRaw: '300000000',
      },
    });
    // company: 250 + 200 = 450 of 1000 total → 4500 bps > 3000; issuer prestocks: 250 + 200 = 450 → 4500 bps < 5000
    expect(codes(buyMoreOfSameCompany)).toEqual(['COMPANY_CONCENTRATION_EXCEEDED']);
    const issuerHeavy = baseInput({
      positions: [
        {
          instrumentId: 'inst-o',
          issuer: 'prestocks',
          companyKey: companyKeyOf('Other Co'),
          notionalUsdcRaw: '500000000',
        },
      ],
      notionalUsdcRaw: '100000000',
      exposure: {
        source: 'caller_declared',
        observedAt: NOW.toISOString(),
        positions: [],
        cashUsdcRaw: '100000000',
      },
    });
    expect(codes(issuerHeavy)).toEqual(['ISSUER_CONCENTRATION_EXCEEDED']);
    expect(codes(baseInput({ side: 'sell', positions, notionalUsdcRaw: '900000000' }))).toEqual([]);
  });

  it('blocks on lifecycle, eligibility expiry and revocation, issuer coverage and pending reservations', () => {
    expect(
      codes(
        baseInput({
          instrument: {
            ...baseInput().instrument,
            status: 'paused',
            lifecycle: { ...lifecycle, halted: true, haltedReason: 'issuer notice' },
          },
        }),
      ),
    ).toEqual(['INSTRUMENT_NOT_ADMITTED', 'ISSUER_HALTED']);
    expect(
      codes(
        baseInput({
          instrument: {
            ...baseInput().instrument,
            lifecycle: {
              ...lifecycle,
              currentMultiplier: null,
              pendingActions: [
                { actionId: 'a', type: 'split', effectiveAt: '2026-09-20T00:00:00Z' },
              ],
            },
          },
        }),
      ),
    ).toEqual(['CORPORATE_ACTION_PENDING', 'MULTIPLIER_UNKNOWN']);
    const eligible: PolicyEligibility = {
      decisionId: 'dec-1',
      outcome: 'eligible',
      issuers: ['prestocks', 'xstocks'],
      expiresAt: '2027-01-01T00:00:00Z',
      revokedAt: null,
      policyVersion: '2026-09-24',
    };
    expect(
      codes(baseInput({ eligibility: { ...eligible, expiresAt: '2026-09-01T00:00:00Z' } })),
    ).toEqual(['ELIGIBILITY_EXPIRED']);
    expect(
      codes(baseInput({ eligibility: { ...eligible, revokedAt: '2026-09-24T00:00:00Z' } })),
    ).toEqual(['ELIGIBILITY_EXPIRED']);
    expect(codes(baseInput({ eligibility: { ...eligible, policyVersion: '2026-09-01' } }))).toEqual(
      ['ELIGIBILITY_SUPERSEDED'],
    );
    expect(
      codes(baseInput({ eligibility: { ...eligible, outcome: 'unknown', issuers: [] } })),
    ).toEqual(['ELIGIBILITY_UNKNOWN']);
    expect(codes(baseInput({ eligibility: { ...eligible, issuers: ['xstocks'] } }))).toEqual([
      'ISSUER_NOT_COVERED',
    ]);
    expect(
      codes(baseInput({ eligibility: { ...eligible, outcome: 'ineligible', issuers: [] } })),
    ).toEqual(['ELIGIBILITY_DENIED']);
    expect(codes(baseInput({ reservedUsdcRaw: '24950000000' }))).toEqual(['ACCOUNT_CAP_EXCEEDED']);
    expect(codes(baseInput({ notionalUsdcRaw: '0' }))).toEqual(['NOTIONAL_ZERO']);
    const staleQuoteExpiry = evaluatePolicy(
      baseInput({ quoteObservedAt: new Date('2026-09-24T11:59:30Z') }),
    );
    expect(staleQuoteExpiry.expiresAt.toISOString()).toBe('2026-09-24T12:00:30.000Z');
  });
});

describe('capability states', () => {
  it('separates discoverable, quoteable and tradable facts', () => {
    const instrument = {
      instrumentId: 'inst-a',
      issuer: 'prestocks' as const,
      status: 'admitted' as const,
      availability: {
        research: true,
        strategy: true,
        trade: false as const,
        reasons: ['EXECUTION_NOT_ENABLED'],
      },
      lifecycle,
      referencePrice: null,
      nonTransferable: false,
    };
    const anonymous = capabilityStatesFor({
      instrument,
      eligibility: null,
      termsComplete: false,
      executionWritesEnabled: false,
      venueEnabled: true,
      policyVersion: '2026-09-24',
      now: NOW,
    });
    expect(anonymous.capabilities).toEqual({
      discoverable: true,
      researchable: true,
      quoteable: true,
      buyable: false,
      sellable: false,
      redeemable: false,
      transferable: true,
    });
    expect(anonymous.conditions).toEqual([
      'eligibility_unknown',
      'terms_not_acknowledged',
      'execution_disabled',
    ]);
    const halted = capabilityStatesFor({
      instrument: {
        ...instrument,
        lifecycle: { ...lifecycle, halted: true, haltedReason: 'issuer notice' },
        nonTransferable: true,
      },
      eligibility: { outcome: 'eligible', issuers: ['prestocks'], standing: 'in_force' },
      termsComplete: true,
      executionWritesEnabled: true,
      venueEnabled: true,
      policyVersion: '2026-09-24',
      now: NOW,
    });
    expect(halted.capabilities).toMatchObject({
      quoteable: false,
      buyable: false,
      transferable: false,
    });
    const superseded = capabilityStatesFor({
      instrument,
      eligibility: { outcome: 'eligible', issuers: ['prestocks'], standing: 'superseded' },
      termsComplete: true,
      executionWritesEnabled: true,
      venueEnabled: true,
      policyVersion: '2026-09-24',
      now: NOW,
    });
    expect(superseded.conditions).toEqual(['eligibility_unknown']);
    expect(superseded.reasons).toEqual([
      'the eligibility decision predates the active policy version',
    ]);
    expect(halted.conditions).toEqual(['issuer_halted']);
    const ready = capabilityStatesFor({
      instrument,
      eligibility: { outcome: 'eligible', issuers: ['prestocks'], standing: 'in_force' },
      termsComplete: true,
      executionWritesEnabled: true,
      venueEnabled: true,
      policyVersion: '2026-09-24',
      now: NOW,
    });
    expect(ready.capabilities.buyable).toBe(true);
    expect(ready.conditions).toEqual([]);
  });
});
