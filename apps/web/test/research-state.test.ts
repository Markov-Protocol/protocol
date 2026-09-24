import type { SourceRecord } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkForm,
  EMPTY_FORM,
  equalWeightsWithCashRemainder,
  issuesFromApiDetails,
  revisionInputFromForm,
  safeExternalHref,
} from '../src/features/research/editor-state';

const SOURCE = '44444444-4444-4444-8444-444444444444';
const source = (overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  sourceId: SOURCE,
  thesisId: '55555555-5555-4555-8555-555555555555',
  role: 'issuer',
  url: 'https://issuer.example/terms',
  finalUrl: 'https://issuer.example/terms',
  title: 'Terms',
  status: 'fetched',
  blockedReason: null,
  contentType: 'text/html',
  byteLength: 1200,
  contentHash: 'a'.repeat(64),
  excerpt: 'Holders have no voting rights.',
  publishedAt: null,
  observedAt: null,
  retrievedAt: '2026-09-24T12:00:00.000Z',
  redirects: [],
  ...overrides,
});

describe('equal weights with the exact remainder as cash', () => {
  it('never rounds a weight away and always sums to exactly 10,000', () => {
    expect(equalWeightsWithCashRemainder(1)).toEqual({ weightBps: 10_000, cashWeightBps: 0 });
    expect(equalWeightsWithCashRemainder(3)).toEqual({ weightBps: 3333, cashWeightBps: 1 });
    expect(equalWeightsWithCashRemainder(7)).toEqual({ weightBps: 1428, cashWeightBps: 4 });
    for (let legs = 1; legs <= 20; legs += 1) {
      const plan = equalWeightsWithCashRemainder(legs);
      expect(plan.weightBps * legs + plan.cashWeightBps).toBe(10_000);
    }
    expect(() => equalWeightsWithCashRemainder(0)).toThrow(RangeError);
  });
});

describe('local editor checks', () => {
  it('flags what the API would certainly refuse, by field', () => {
    const issues = checkForm(
      {
        ...EMPTY_FORM,
        title: 'A <b>title</b>',
        statements: [
          {
            statementId: 's1',
            kind: 'fact',
            topic: 'general',
            text: 'Uncited claim.',
            sourceIds: [],
            runId: null,
          },
          {
            statementId: 's2',
            kind: 'issuer_assertion',
            topic: 'rights',
            text: 'Cites a refused source.',
            sourceIds: [SOURCE],
            runId: null,
          },
          {
            statementId: 's3',
            kind: 'model_inference',
            topic: 'general',
            text: 'No run.',
            sourceIds: [],
            runId: null,
          },
        ],
      },
      [source({ status: 'blocked', excerpt: null })],
    );
    expect(issues.map((issue) => issue.fieldId)).toEqual([
      'thesis-claim',
      'thesis-title',
      'statement-0-sources',
      'statement-1-sources',
      'statement-2-text',
    ]);
    expect(checkForm({ ...EMPTY_FORM, title: 't', claim: 'c' }, [])).toEqual([]);
  });

  it('maps API detail paths onto the fields that own them', () => {
    expect(
      issuesFromApiDetails([
        { path: 'statements/2', message: 'a fact must cite at least one source' },
        { path: 'subjects/0', message: 'already referenced through an admitted instrument' },
        { path: 'instruments/1', message: 'is not admitted' },
        { path: 'privateNotes', message: 'too long' },
        { path: 'weird', message: 'x' },
      ]).map((issue) => issue.fieldId),
    ).toEqual([
      'statement-2-text',
      'subject-0',
      'instrument-1',
      'thesis-private-notes',
      'thesis-title',
    ]);
  });

  it('turns the form into the revision input the contract accepts, trimming and dropping empties', () => {
    const input = revisionInputFromForm({
      ...EMPTY_FORM,
      title: '  Title ',
      claim: 'Claim',
      counterarguments: ['  ', 'Real one '],
      privateNotes: '   ',
    });
    expect(input).toMatchObject({
      title: 'Title',
      counterarguments: ['Real one'],
      privateNotes: null,
    });
    expect(() =>
      revisionInputFromForm({ ...EMPTY_FORM, title: 'x'.repeat(200), claim: 'c' }),
    ).toThrow();
  });
});

describe('safe outbound links', () => {
  it('links only https destinations; everything else stays text', () => {
    expect(safeExternalHref('https://issuer.example/terms')).toBe('https://issuer.example/terms');
    expect(safeExternalHref('http://issuer.example/terms')).toBeNull();
    expect(safeExternalHref(['javascript', 'alert(1)'].join(':'))).toBeNull();
    expect(safeExternalHref('data:text/html,hi')).toBeNull();
    expect(safeExternalHref('not a url')).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
  });
});
