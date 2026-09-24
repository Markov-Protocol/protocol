import type { ThesisRevisionInput } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  canonicalRevision,
  contentHashOf,
  createFixtureModelAdapter,
  excerptOf,
  extractTitle,
  FIXTURE_SOURCES,
  htmlToText,
  mapCompanies,
  plainText,
  promptHashOf,
  type RevisionContext,
  validateModelOutput,
  validateRevision,
} from '../src/index.js';

const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';
const SOURCE_ISSUER = '33333333-3333-4333-8333-333333333333';
const SOURCE_NEWS = '44444444-4444-4444-8444-444444444444';
const SOURCE_BLOCKED = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';

const context: RevisionContext = {
  instruments: new Map([
    [AERO, { instrumentId: AERO, companyName: 'Fixture Aerospace Inc', status: 'admitted' }],
    [BIO, { instrumentId: BIO, companyName: 'Fixture Biotech Ltd', status: 'quarantined' }],
  ]),
  sources: new Map([
    [SOURCE_ISSUER, { sourceId: SOURCE_ISSUER, role: 'issuer', status: 'fetched' }],
    [SOURCE_NEWS, { sourceId: SOURCE_NEWS, role: 'news', status: 'fetched' }],
    [SOURCE_BLOCKED, { sourceId: SOURCE_BLOCKED, role: 'issuer', status: 'blocked' }],
  ]),
  runIds: new Set([RUN]),
};

function revision(overrides: Partial<ThesisRevisionInput> = {}): ThesisRevisionInput {
  return {
    title: 'Fixture Aerospace exposure',
    claim: 'Exposure to Fixture Aerospace through the admitted token is worth a small allocation.',
    statements: [],
    counterarguments: [],
    instruments: [],
    subjects: [],
    privateNotes: null,
    ...overrides,
  };
}

describe('sanitisation', () => {
  it('turns hostile HTML into bounded plain text without scripts, handlers or comments', () => {
    const text = htmlToText(FIXTURE_SOURCES['issuer-terms']?.body ?? '');
    expect(text).toContain('Each FXAERO token represents a contractual claim');
    expect(text).toContain("issuer's economic exposure");
    expect(text).not.toMatch(
      /evil\.example|alert|onload|onerror|ignore previous instructions|display:none|javascript:/,
    );
    expect(text).not.toMatch(/[<>]/);
    expect(extractTitle(FIXTURE_SOURCES['issuer-terms']?.body ?? '')).toBe(
      'Fixture Aerospace Inc — token terms',
    );
    expect(excerptOf('word '.repeat(400), 50).length).toBeLessThanOrEqual(50);
    expect(excerptOf('word '.repeat(400), 50).endsWith('…')).toBe(true);
    expect(plainText('<b>bold</b> & <script>x</script> text\u0000here', 100)).toBe(
      'bold & x text here',
    );
  });
});

describe('thesis rules', () => {
  it('requires citations for facts and evidence roles for issuer claims', () => {
    const issues = validateRevision(
      revision({
        statements: [
          {
            statementId: 'f1',
            kind: 'fact',
            topic: 'general',
            text: 'Round announced.',
            sourceIds: [],
            runId: null,
          },
          {
            statementId: 'a1',
            kind: 'issuer_assertion',
            topic: 'rights',
            text: 'No voting rights.',
            sourceIds: [SOURCE_NEWS],
            runId: null,
          },
          {
            statementId: 'a2',
            kind: 'issuer_assertion',
            topic: 'backing',
            text: 'Backed by shares.',
            sourceIds: [SOURCE_BLOCKED],
            runId: null,
          },
          {
            statementId: 'o1',
            kind: 'user_opinion',
            topic: 'general',
            text: 'I like it.',
            sourceIds: [],
            runId: RUN,
          },
          {
            statementId: 'm1',
            kind: 'model_inference',
            topic: 'general',
            text: 'Model says.',
            sourceIds: [],
            runId: null,
          },
          {
            statementId: 'm1',
            kind: 'model_inference',
            topic: 'general',
            text: 'Dup id.',
            sourceIds: ['77777777-7777-4777-8777-777777777777'],
            runId: RUN,
          },
        ],
        instruments: [
          { instrumentId: AERO, note: null },
          { instrumentId: AERO, note: null },
          { instrumentId: BIO, note: null },
          { instrumentId: '88888888-8888-4888-8888-888888888888', note: null },
        ],
        subjects: [
          { name: 'Fixture Aerospace, Inc.', note: null },
          { name: 'Unknown Rocket Co', note: null },
          { name: 'unknown rocket co', note: null },
        ],
      }),
      context,
    );
    expect(issues.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([
      'statements/0: a fact must cite at least one source',
      'statements/1: a claim about rights must cite an issuer, legal or filing source',
      'statements/2/sourceIds/0: source 55555555-5555-4555-8555-555555555555 was blocked; cite a fetched source',
      'statements/2: a claim about backing must cite an issuer, legal or filing source',
      'statements/3/runId: only model inferences carry a run id',
      'statements/4: a model inference must name the research run that produced it',
      'statements/5: duplicate statement id m1',
      'statements/5/sourceIds/0: unknown source 77777777-7777-4777-8777-777777777777',
      'instruments/1: instrument 11111111-1111-4111-8111-111111111111 is referenced twice',
      'instruments/2: instrument 22222222-2222-4222-8222-222222222222 is quarantined; only admitted or paused instruments can be referenced',
      'instruments/3: instrument 88888888-8888-4888-8888-888888888888 is not in the admitted catalog',
      'subjects/0: Fixture Aerospace, Inc. is already referenced through an admitted instrument',
      'subjects/2: subject unknown rocket co is listed twice',
    ]);
    const valid = validateRevision(
      revision({
        statements: [
          {
            statementId: 'a1',
            kind: 'issuer_assertion',
            topic: 'rights',
            text: 'No voting rights.',
            sourceIds: [SOURCE_ISSUER],
            runId: null,
          },
          {
            statementId: 'm1',
            kind: 'model_inference',
            topic: 'general',
            text: 'Model says.',
            sourceIds: [SOURCE_NEWS],
            runId: RUN,
          },
        ],
        instruments: [{ instrumentId: AERO, note: 'core' }],
        subjects: [{ name: 'Unknown Rocket Co', note: null }],
      }),
      context,
    );
    expect(valid).toEqual([]);
  });

  it('hashes the public content deterministically and leaves private notes out', () => {
    const a = revision({
      privateNotes: 'secret budget 5000',
      instruments: [
        { instrumentId: AERO, note: null },
        { instrumentId: BIO, note: null },
      ],
    });
    const b = revision({
      privateNotes: null,
      instruments: [
        { instrumentId: BIO, note: null },
        { instrumentId: AERO, note: null },
      ],
    });
    expect(canonicalRevision(a)).toBe(canonicalRevision(b));
    expect(canonicalRevision(a)).not.toContain('secret budget');
    expect(contentHashOf(canonicalRevision(a))).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHashOf(canonicalRevision(revision({ title: 'Other' })))).not.toBe(
      contentHashOf(canonicalRevision(a)),
    );
  });
});

describe('deterministic company mapping', () => {
  const instruments = [
    {
      instrumentId: AERO,
      issuer: 'prestocks' as const,
      symbol: 'FXAERO',
      companyName: 'Fixture Aerospace Inc',
      status: 'admitted',
    },
    {
      instrumentId: BIO,
      issuer: 'xstocks' as const,
      symbol: 'XAERO',
      companyName: 'FIXTURE AEROSPACE, INC.',
      status: 'paused',
    },
    {
      instrumentId: '99999999-9999-4999-8999-999999999999',
      issuer: 'prestocks' as const,
      symbol: 'FXGRID',
      companyName: 'Fixture Grid Energy SA',
      status: 'quarantined',
    },
  ];
  it('matches only admitted or paused instruments by normalised name and leaves the rest unmatched', () => {
    const { results } = mapCompanies(
      ['fixture aerospace inc.', 'Fixture Grid Energy', 'Unknown Rocket Co', '!!!'],
      instruments,
    );
    expect(results[0]).toMatchObject({ companyKey: 'fixture aerospace', unmatched: false });
    expect(
      results[0]?.matches.map((match) => `${match.issuer}:${match.symbol}:${match.status}`),
    ).toEqual(['prestocks:FXAERO:admitted', 'xstocks:XAERO:paused']);
    expect(results[1]).toMatchObject({ unmatched: true, matches: [] });
    expect(results[2]).toMatchObject({ unmatched: true });
    expect(results[3]).toMatchObject({ companyKey: '', unmatched: true });
    expect(mapCompanies(['Fixture Aerospace'], instruments)).toEqual(
      mapCompanies(['Fixture Aerospace'], [...instruments].reverse()),
    );
  });
});

describe('bounded model adapter', () => {
  it('produces deterministic, labelled inferences whose identifiers are validated', async () => {
    const adapter = createFixtureModelAdapter();
    const input = {
      question: 'Is Fixture Aerospace Inc a better exposure than Unknown Rocket Co?',
      thesis: { title: 'Aero', claim: 'Aerospace exposure' },
      sources: [
        {
          sourceId: SOURCE_ISSUER,
          role: 'issuer' as const,
          excerpt: 'Holders have no shareholder voting rights. <b>x</b>',
        },
      ],
      candidates: [
        {
          instrumentId: AERO,
          symbol: 'FXAERO',
          companyName: 'Fixture Aerospace Inc',
          issuer: 'prestocks',
        },
      ],
      budget: { maxOutputChars: 4000, maxStatements: 8 },
    };
    const first = await adapter.generate(input);
    expect(first).toEqual(await adapter.generate(input));
    expect(first.instrumentIds).toEqual([AERO]);
    expect(first.companies).toEqual(['Fixture Aerospace Inc', 'Unknown Rocket Co']);
    expect(promptHashOf(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHashOf(input)).toBe(promptHashOf({ ...input }));

    const validated = validateModelOutput(
      {
        ...first,
        instrumentIds: [...first.instrumentIds, 'not-an-instrument', BIO],
        statements: [...first.statements, { text: '<script>x</script>', sourceIds: ['nope'] }],
      },
      {
        runId: RUN,
        candidates: input.candidates,
        sourceIds: new Set([SOURCE_ISSUER]),
        budget: { maxOutputChars: 4000, maxStatements: 1 },
      },
    );
    expect(validated.draft).toHaveLength(1);
    expect(validated.draft[0]).toMatchObject({
      kind: 'model_inference',
      runId: RUN,
      sourceIds: [SOURCE_ISSUER],
    });
    expect(validated.draft[0]?.text).not.toMatch(/[<>]/);
    expect(validated.suggestedInstrumentIds).toEqual([AERO]);
    expect(validated.unmatchedCompanies).toEqual(['Unknown Rocket Co']);
    expect(validated.rejected).toEqual([
      'instrument not-an-instrument',
      `instrument ${BIO}`,
      'statement 1: over the statement budget',
    ]);
  });
});
