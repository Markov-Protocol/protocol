import type { FrozenLeg, StrategyDraftContent } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  canonicalContent,
  canonicalManifest,
  contentDigestOf,
  contentDomain,
  diffVersions,
  disclosuresOf,
  freezeLegs,
  type KnownInstrument,
  manifestDomain,
  manifestHashOf,
  validateDraft,
} from '../src/index.js';

const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';
const XAERO = '33333333-3333-4333-8333-333333333333';
const GRID = '44444444-4444-4444-8444-444444444444';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const instruments = new Map<string, KnownInstrument>([
  [
    AERO,
    {
      instrumentId: AERO,
      status: 'admitted',
      issuer: 'prestocks',
      mint: 'M1',
      tokenProgram: 'spl-token',
      companyName: 'Fixture Aerospace Inc',
      symbol: 'FXAERO',
    },
  ],
  [
    BIO,
    {
      instrumentId: BIO,
      status: 'admitted',
      issuer: 'prestocks',
      mint: 'M2',
      tokenProgram: 'token-2022',
      companyName: 'Fixture Biotech Ltd',
      symbol: 'FXBIO',
    },
  ],
  [
    XAERO,
    {
      instrumentId: XAERO,
      status: 'admitted',
      issuer: 'xstocks',
      mint: 'M3',
      tokenProgram: 'token-2022',
      companyName: 'Fixture Aerospace, Inc.',
      symbol: 'AEROX',
    },
  ],
  [
    GRID,
    {
      instrumentId: GRID,
      status: 'quarantined',
      issuer: 'prestocks',
      mint: 'M4',
      tokenProgram: 'spl-token',
      companyName: 'Fixture Grid Energy SA',
      symbol: 'FXGRID',
    },
  ],
]);
const limits = { maxLegs: 10, maxIssuerConcentrationBps: 5000, maxCompanyConcentrationBps: 3000 };

function draft(overrides: Partial<StrategyDraftContent> = {}): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: AERO, weightBps: 3000, note: null },
      { instrumentId: BIO, weightBps: 2000, note: null },
      { instrumentId: XAERO, weightBps: 3000, note: null },
    ],
    cashWeightBps: 2000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
    ...overrides,
  };
}

const codes = (content: StrategyDraftContent) =>
  validateDraft(content, { instruments, limits }).issues.map(
    (issue) => `${issue.severity}:${issue.code}`,
  );

describe('draft validation', () => {
  it('accepts an exact 10,000 basis-point recipe and reports its totals', () => {
    const result = validateDraft(draft(), { instruments, limits });
    expect(result.valid).toBe(true);
    expect(result.totals).toEqual({ legsBps: 8000, cashBps: 2000, totalBps: 10000 });
    // 5,000 bps on PreStocks is within the 5,000 ceiling; two issuers' tokens for one company add up to 6,000 bps, above the 3,000 ceiling.
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'COMPANY_CONCENTRATION',
        severity: 'warning',
        limit: 3000,
        observed: 6000,
      }),
    ]);
  });

  it('refuses 9,999 and 10,001 totals with the observed value and never renormalises', () => {
    for (const cash of [1999, 2001]) {
      const result = validateDraft(draft({ cashWeightBps: cash }), { instruments, limits });
      expect(result.valid).toBe(false);
      const total = result.issues.find((issue) => issue.code === 'WEIGHTS_TOTAL');
      expect(total).toMatchObject({
        severity: 'error',
        limit: 10000,
        observed: 8000 + cash,
        path: 'cashWeightBps',
      });
    }
  });

  it('refuses duplicates, unknown, unadmitted, shared mints, cash-only and too many legs', () => {
    expect(
      codes(
        draft({
          legs: [
            { instrumentId: AERO, weightBps: 5000, note: null },
            { instrumentId: AERO, weightBps: 3000, note: null },
          ],
        }),
      ),
    ).toContain('error:DUPLICATE_INSTRUMENT');
    expect(
      codes(draft({ legs: [{ instrumentId: UNKNOWN, weightBps: 8000, note: null }] })),
    ).toContain('error:UNKNOWN_INSTRUMENT');
    expect(codes(draft({ legs: [{ instrumentId: GRID, weightBps: 8000, note: null }] }))).toContain(
      'error:INSTRUMENT_NOT_ADMITTED',
    );
    const twin = new Map(instruments);
    twin.set(UNKNOWN, {
      ...(instruments.get(AERO) as KnownInstrument),
      instrumentId: UNKNOWN,
      symbol: 'DUP',
    });
    expect(
      validateDraft(
        draft({
          legs: [
            { instrumentId: AERO, weightBps: 4000, note: null },
            { instrumentId: UNKNOWN, weightBps: 4000, note: null },
          ],
        }),
        { instruments: twin, limits },
      ).issues.map((i) => i.code),
    ).toContain('DUPLICATE_MINT');
    expect(codes(draft({ legs: [], cashWeightBps: 10000 }))).toEqual(['error:NO_LEGS']);
    const many = Array.from({ length: 11 }, (_, i) => ({
      instrumentId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      weightBps: 700,
      note: null,
    }));
    const result = validateDraft(draft({ legs: many, cashWeightBps: 2300 }), {
      instruments,
      limits: { ...limits, maxLegs: 10 },
    });
    expect(result.issues.find((issue) => issue.code === 'TOO_MANY_LEGS')).toMatchObject({
      limit: 10,
      observed: 11,
    });
    expect(result.valid).toBe(false);
    expect(validateDraft(draft(), { instruments, limits: { ...limits, maxLegs: 2 } }).valid).toBe(
      false,
    );
  });

  it('keeps concentration advisory: a single-issuer recipe is valid with a warning', () => {
    const result = validateDraft(
      draft({ legs: [{ instrumentId: AERO, weightBps: 6000, note: null }], cashWeightBps: 4000 }),
      { instruments, limits },
    );
    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => `${issue.severity}:${issue.code}`)).toEqual([
      'warning:ISSUER_CONCENTRATION',
      'warning:COMPANY_CONCENTRATION',
    ]);
  });
});

describe('manifest', () => {
  const evidence = new Map([
    [
      AERO,
      {
        admittedAt: '2026-09-23T00:00:00.000Z',
        verificationId: 1,
        verifiedAt: '2026-09-23T00:00:00.000Z',
        decimals: 6,
        genesisHash: GENESIS,
      },
    ],
    [
      BIO,
      {
        admittedAt: '2026-09-23T00:00:00.000Z',
        verificationId: 2,
        verifiedAt: '2026-09-23T00:00:00.000Z',
        decimals: 6,
        genesisHash: GENESIS,
      },
    ],
    [
      XAERO,
      {
        admittedAt: '2026-09-23T00:00:00.000Z',
        verificationId: 3,
        verifiedAt: '2026-09-23T00:00:00.000Z',
        decimals: 8,
        genesisHash: GENESIS,
      },
    ],
  ]);
  const legs = freezeLegs(draft(), instruments, evidence);
  const input = {
    schemaVersion: '1' as const,
    kind: 'stock_spot_basket' as const,
    genesisHash: GENESIS,
    strategyId: '55555555-5555-4555-8555-555555555555',
    versionNumber: 1,
    parentVersionId: null,
    forkOf: null,
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    legs: legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      mint: leg.admission.mint,
      tokenProgram: leg.admission.tokenProgram,
      weightBps: leg.weightBps,
    })),
    cashWeightBps: 2000,
    maintenance: { suggestion: 'hold' as const, driftThresholdBps: null, reviewEveryDays: null },
    references: ['https://b.example.com/x', 'https://a.example.com/y'],
  };

  it('is canonical: sorted keys, sorted legs and references, and a domain-separated hash (test vector)', () => {
    const canonical = canonicalManifest(input);
    expect(canonical).toBe(
      '{"cashWeightBps":2000,"forkOf":null,"kind":"stock_spot_basket","legs":[{"instrumentId":"11111111-1111-4111-8111-111111111111","mint":"M1","tokenProgram":"spl-token","weightBps":3000},{"instrumentId":"22222222-2222-4222-8222-222222222222","mint":"M2","tokenProgram":"token-2022","weightBps":2000},{"instrumentId":"33333333-3333-4333-8333-333333333333","mint":"M3","tokenProgram":"token-2022","weightBps":3000}],"maintenance":{"driftThresholdBps":null,"reviewEveryDays":null,"suggestion":"hold"},"network":{"chain":"solana","genesisHash":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"},"parentVersionId":null,"references":["https://a.example.com/y","https://b.example.com/x"],"schemaVersion":"1","strategyId":"55555555-5555-4555-8555-555555555555","thesis":"Launch cadence is underestimated.","thesisId":null,"title":"Aerospace tilt","versionNumber":1}',
    );
    const shuffled = canonicalManifest({
      ...input,
      legs: [...input.legs].reverse(),
      references: [...input.references].reverse(),
    });
    expect(shuffled).toBe(canonical);
    expect(manifestDomain('1', GENESIS)).toBe(`markov-strategy-manifest/v1/${GENESIS}`);
    const hash = manifestHashOf(canonical, '1', GENESIS);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Recorded test vector for the B08 program and any other implementation.
    expect(hash).toBe('d324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a');
    expect(manifestHashOf(canonical, '1', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).not.toBe(
      hash,
    );
    expect(manifestHashOf(canonical, '2', GENESIS)).not.toBe(hash);
  });

  it('digests the economic content without lineage, so unchanged recipes share one digest', () => {
    const {
      strategyId: _s,
      versionNumber: _v,
      parentVersionId: _p,
      forkOf: _f,
      ...economic
    } = input;
    const content = canonicalContent(economic);
    expect(content).not.toContain('versionNumber');
    expect(content).not.toContain('strategyId');
    const digest = contentDigestOf(content, '1', GENESIS);
    // Recorded test vector.
    expect(digest).toBe('910207cf06da18bcbf497381e9ac8f209e8c0ab895c1ae011bf36390102e0819');
    expect(contentDomain('1', GENESIS)).toBe(`markov-strategy-content/v1/${GENESIS}`);
    expect(digest).toBe(
      contentDigestOf(
        canonicalContent({ ...economic, references: [...economic.references].reverse() }),
        '1',
        GENESIS,
      ),
    );
    expect(digest).not.toBe(manifestHashOf(content, '1', GENESIS));
    expect(
      contentDigestOf(canonicalContent({ ...economic, cashWeightBps: 2001 }), '1', GENESIS),
    ).not.toBe(digest);
    expect(
      contentDigestOf(canonicalContent({ ...economic, title: 'Aerospace tilt!' }), '1', GENESIS),
    ).not.toBe(digest);
    // Two versions of the same recipe: same digest, different manifests and manifest hashes.
    const second = canonicalManifest({
      ...input,
      versionNumber: 2,
      parentVersionId: '66666666-6666-4666-8666-666666666666',
    });
    const first = canonicalManifest(input);
    expect(second).not.toBe(first);
    expect(manifestHashOf(second, '1', GENESIS)).not.toBe(manifestHashOf(first, '1', GENESIS));
  });

  it('freezes legs in a stable order with admission snapshots and discloses issuer and company exposure', () => {
    expect(legs.map((leg) => leg.symbol)).toEqual(['FXAERO', 'FXBIO', 'AEROX']);
    expect(legs[0]?.admission).toMatchObject({
      status: 'admitted',
      verificationId: 1,
      mint: 'M1',
      decimals: 6,
      genesisHash: GENESIS,
    });
    const disclosures = disclosuresOf(legs);
    expect(disclosures.issuers).toEqual([
      { issuer: 'prestocks', weightBps: 5000 },
      { issuer: 'xstocks', weightBps: 3000 },
    ]);
    expect(disclosures.companies[0]).toEqual({
      companyKey: 'fixture aerospace',
      companyName: 'Fixture Aerospace Inc',
      weightBps: 6000,
      instrumentIds: [AERO, XAERO],
    });
    expect(() =>
      freezeLegs(
        draft({ legs: [{ instrumentId: UNKNOWN, weightBps: 8000, note: null }] }),
        instruments,
        evidence,
      ),
    ).toThrow(/unknown/);
  });
});

describe('diff', () => {
  const version = (
    id: string,
    legs: FrozenLeg[] | { instrumentId: string; symbol: string; weightBps: number }[],
    cash: number,
    extra: Partial<{ title: string; references: string[] }> = {},
  ) => ({
    versionId: id,
    title: extra.title ?? 't',
    thesis: 'th',
    legs,
    cashWeightBps: cash,
    maintenance: { suggestion: 'hold' as const, driftThresholdBps: null, reviewEveryDays: null },
    references: extra.references ?? [],
  });

  it('reports added, removed and changed legs, cash moves and one-sided turnover', () => {
    const a = version(
      'a',
      [
        { instrumentId: AERO, symbol: 'FXAERO', weightBps: 5000 },
        { instrumentId: BIO, symbol: 'FXBIO', weightBps: 3000 },
      ],
      2000,
    );
    const b = version(
      'b',
      [
        { instrumentId: AERO, symbol: 'FXAERO', weightBps: 4000 },
        { instrumentId: XAERO, symbol: 'AEROX', weightBps: 4000 },
      ],
      2000,
      { title: 'new', references: ['https://x.example.com/'] },
    );
    const diff = diffVersions(a, b);
    expect(diff.legs.added).toEqual([{ instrumentId: XAERO, symbol: 'AEROX', weightBps: 4000 }]);
    expect(diff.legs.removed).toEqual([{ instrumentId: BIO, symbol: 'FXBIO', weightBps: 3000 }]);
    expect(diff.legs.changed).toEqual([
      { instrumentId: AERO, symbol: 'FXAERO', fromBps: 5000, toBps: 4000 },
    ]);
    expect(diff.cashWeightBps).toEqual({ from: 2000, to: 2000 });
    expect(diff.titleChanged).toBe(true);
    expect(diff.referencesChanged).toBe(true);
    expect(diff.thesisChanged).toBe(false);
    expect(diff.turnoverBps).toBe(4000);
    expect(diffVersions(a, a).turnoverBps).toBe(0);
  });
});
