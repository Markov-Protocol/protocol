import type { CorporateActionFeedEvent } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import { encodeExtensionData } from '../src/extension-fixtures.js';
import {
  assessExtensions,
  encodeMintAccount,
  multiplierAfterAction,
  multiplierAsOf,
  normalizeCorporateAction,
  parseCorporateActionFeed,
  parseMintAccount,
  planCorporateActions,
  TOKEN_2022_PROGRAM_ID,
} from '../src/index.js';

const KEY = new Uint8Array(32).fill(9);

describe('extension policy', () => {
  it('supports descriptive and scaled extensions, requires review for issuer powers and refuses fees, hooks and double rebasing', () => {
    const supported = assessExtensions([
      {
        type: 18,
        data: encodeExtensionData({
          name: 'MetadataPointer',
          authority: KEY,
          metadataAddress: KEY,
        }),
      },
      {
        type: 25,
        data: encodeExtensionData({
          name: 'ScaledUiAmount',
          authority: KEY,
          multiplier: 1.5,
          newMultiplier: 3,
          newMultiplierEffectiveAt: 1_800_000_000,
        }),
      },
      { type: 26, data: encodeExtensionData({ name: 'Pausable', authority: KEY, paused: false }) },
    ]);
    expect(supported.compatibility).toBe('supported');
    expect(supported.scaledUiAmount).toEqual({
      authority: expect.any(String),
      multiplier: '1.5',
      multiplierExact: '1.5',
      newMultiplier: '3',
      newMultiplierExact: '3',
      newMultiplierEffectiveAt: '2027-01-15T08:00:00.000Z',
    });
    expect(supported.paused).toBe(false);

    const review = assessExtensions([
      { type: 12, data: encodeExtensionData({ name: 'PermanentDelegate', delegate: KEY }) },
      { type: 6, data: encodeExtensionData({ name: 'DefaultAccountState', frozen: true }) },
      {
        type: 1,
        data: encodeExtensionData({ name: 'TransferFeeConfig', basisPoints: 0, maximumFee: 0n }),
      },
    ]);
    expect(review.compatibility).toBe('review_required');
    expect(review.permanentDelegate).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(review.defaultAccountState).toBe('frozen');
    expect(review.transferFee).toMatchObject({ basisPoints: 0, maximumFee: '0' });

    const fee = assessExtensions([
      {
        type: 1,
        data: encodeExtensionData({
          name: 'TransferFeeConfig',
          basisPoints: 25,
          maximumFee: 1_000_000n,
        }),
      },
    ]);
    expect(fee.compatibility).toBe('unsupported');
    expect(fee.transferFee).toMatchObject({ basisPoints: 25, maximumFee: '1000000' });

    const hook = assessExtensions([
      {
        type: 14,
        data: encodeExtensionData({ name: 'TransferHook', authority: KEY, programId: KEY }),
      },
    ]);
    expect(hook.compatibility).toBe('unsupported');
    expect(hook.transferHookProgram).not.toBeNull();
    expect(
      assessExtensions([
        {
          type: 14,
          data: encodeExtensionData({ name: 'TransferHook', authority: KEY, programId: null }),
        },
      ]).compatibility,
    ).toBe('supported');

    const doubleRebasing = assessExtensions([
      {
        type: 25,
        data: encodeExtensionData({
          name: 'ScaledUiAmount',
          authority: null,
          multiplier: 2,
          newMultiplier: 2,
          newMultiplierEffectiveAt: 0,
        }),
      },
      {
        type: 10,
        data: encodeExtensionData({ name: 'InterestBearingConfig', rateBasisPoints: 100 }),
      },
    ]);
    expect(doubleRebasing.compatibility).toBe('unsupported');
    expect(doubleRebasing.findings.map((finding) => finding.extension)).toContain(
      'ScaledUiAmount+InterestBearingConfig',
    );
    expect(assessExtensions([{ type: 9, data: new Uint8Array(0) }]).compatibility).toBe(
      'unsupported',
    );
    expect(assessExtensions([{ type: 999, data: new Uint8Array(0) }]).compatibility).toBe(
      'unsupported',
    );
    expect(assessExtensions([{ type: 25, data: new Uint8Array(10) }]).compatibility).toBe(
      'unsupported',
    );
  });

  it('feeds parsed mint entries straight into the assessment', () => {
    const mint = encodeMintAccount({
      decimals: 8,
      supply: 10n,
      mintAuthority: KEY,
      freezeAuthority: null,
      extensions: [
        { type: 26, data: encodeExtensionData({ name: 'Pausable', authority: KEY, paused: true }) },
        {
          type: 25,
          data: encodeExtensionData({
            name: 'ScaledUiAmount',
            authority: KEY,
            multiplier: 0.1,
            newMultiplier: 0.1,
            newMultiplierEffectiveAt: 0,
          }),
        },
      ],
    });
    const parsed = parseMintAccount(TOKEN_2022_PROGRAM_ID, mint);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const assessment = assessExtensions(parsed.entries);
    expect(assessment.paused).toBe(true);
    expect(assessment.scaledUiAmount?.multiplier).toBe('0.1');
    expect(assessment.scaledUiAmount?.multiplierExact).toBe(
      '0.1000000000000000055511151231257827021181583404541015625',
    );
    expect(assessment.scaledUiAmount?.newMultiplierEffectiveAt).toBeNull();
  });
});

function event(overrides: Partial<CorporateActionFeedEvent> = {}): CorporateActionFeedEvent {
  return {
    eventId: 'ev-1',
    productId: 'xs-alpha',
    type: 'split',
    announcedAt: '2026-09-01T00:00:00Z',
    effectiveAt: '2026-09-20T00:00:00Z',
    summary: 'Two for one split',
    ratio: { numerator: 2, denominator: 1 },
    ...overrides,
  };
}

describe('corporate actions', () => {
  it('validates each type, rejects inconsistent events and refuses drifted feeds', () => {
    expect(normalizeCorporateAction(event()).ok).toBe(true);
    expect(
      normalizeCorporateAction(event({ ratio: { numerator: 1, denominator: 2 } })),
    ).toMatchObject({
      ok: false,
      reasons: ['a split must increase the unit count (numerator greater than denominator)'],
    });
    expect(
      normalizeCorporateAction(
        event({ type: 'reverse_split', ratio: { numerator: 1, denominator: 10 } }),
      ).ok,
    ).toBe(true);
    expect(
      normalizeCorporateAction(event({ type: 'multiplier_change', newMultiplier: '0' })),
    ).toMatchObject({ ok: false });
    expect(
      normalizeCorporateAction(event({ type: 'multiplier_change', newMultiplier: '2.50' })).ok,
    ).toBe(true);
    expect(
      normalizeCorporateAction(
        event({
          type: 'migration',
          migration: { targetProductId: 'xs-beta', deadlineAt: '2026-01-01T00:00:00Z' },
        }),
      ),
    ).toMatchObject({ ok: false, reasons: ['migration deadline is before effectiveAt'] });
    expect(normalizeCorporateAction(event({ type: 'sunset' }))).toMatchObject({
      ok: false,
      reasons: ['sunset needs a sunsetAt'],
    });
    expect(
      normalizeCorporateAction(event({ type: 'halt', effectiveAt: '2026-08-01T00:00:00Z' })),
    ).toMatchObject({ ok: false, reasons: ['effectiveAt is before announcedAt'] });
    const distribution = normalizeCorporateAction(
      event({
        type: 'distribution',
        distribution: { amountPerToken: '0.25', unit: 'usdc' },
        reference: 'http://insecure.example',
      }),
    );
    expect(distribution.ok && distribution.event.details).toMatchObject({
      distribution: { amountPerToken: '0.25', unit: 'USDC' },
      reference: null,
    });
    expect(
      parseCorporateActionFeed(
        {
          schemaVersion: '1',
          issuer: 'xstocks',
          generatedAt: '2026-09-24T00:00:00Z',
          events: [event()],
        },
        'xstocks',
      ).ok,
    ).toBe(true);
    expect(
      parseCorporateActionFeed(
        { schemaVersion: '1', issuer: 'xstocks', generatedAt: '2026-09-24T00:00:00Z', items: [] },
        'xstocks',
      ).ok,
    ).toBe(false);
  });

  it('plans inserts, updates, unmatched and duplicate events without inventing instruments', () => {
    const instruments = new Map([['xs-alpha', 'inst-a']]);
    const first = planCorporateActions([], instruments, [
      event(),
      event({ eventId: 'ev-2', productId: 'unknown' }),
      event({ eventId: 'ev-1' }),
      event({ eventId: 'ev-3', ratio: { numerator: 1, denominator: 1 } }),
    ]);
    expect(first.events.map((item) => [item.externalId, item.outcome])).toEqual([
      ['ev-1', 'inserted'],
      ['ev-2', 'unmatched'],
      ['ev-1', 'rejected'],
      ['ev-3', 'rejected'],
    ]);
    const normalized = normalizeCorporateAction(event());
    const fingerprint = normalized.ok ? normalized.event.fingerprint : '';
    const second = planCorporateActions(
      [
        { actionId: 'act-1', externalId: 'ev-1', status: 'pending', fingerprint },
        { actionId: 'act-4', externalId: 'ev-4', status: 'applied', fingerprint: 'old' },
      ],
      instruments,
      [event(), event({ eventId: 'ev-4', summary: 'changed' })],
    );
    expect(second.events.map((item) => [item.externalId, item.outcome])).toEqual([
      ['ev-1', 'unchanged'],
      ['ev-4', 'unchanged'],
    ]);
    const third = planCorporateActions(
      [{ actionId: 'act-1', externalId: 'ev-1', status: 'pending', fingerprint }],
      instruments,
      [
        event({
          summary: 'Two for one split, corrected date',
          effectiveAt: '2026-09-21T00:00:00Z',
        }),
      ],
    );
    expect(third.writes).toEqual([expect.objectContaining({ kind: 'update', actionId: 'act-1' })]);
  });

  it('derives multipliers from splits and explicit changes and resolves history as of a time', () => {
    const split = normalizeCorporateAction(event());
    expect(split.ok && multiplierAfterAction(split.event, '1')).toBe('2');
    const reverse = normalizeCorporateAction(
      event({ type: 'reverse_split', ratio: { numerator: 1, denominator: 3 } }),
    );
    expect(reverse.ok && multiplierAfterAction(reverse.event, '2')).toBe('0.666666666666666667');
    const change = normalizeCorporateAction(
      event({ type: 'multiplier_change', newMultiplier: '2.5' }),
    );
    expect(change.ok && multiplierAfterAction(change.event, '1')).toBe('2.5');
    const halt = normalizeCorporateAction(event({ type: 'halt' }));
    expect(halt.ok && multiplierAfterAction(halt.event, '1')).toBeNull();

    const history = [
      {
        effectiveAt: '2026-09-20T00:00:00.000Z',
        multiplier: '2',
        source: 'corporate_action' as const,
      },
      { effectiveAt: '2026-09-01T00:00:00.000Z', multiplier: '1', source: 'on_chain' as const },
    ];
    expect(multiplierAsOf(history, new Date('2026-09-10T00:00:00Z'))).toMatchObject({
      multiplier: '1',
      complete: true,
      source: 'on_chain',
    });
    expect(multiplierAsOf(history, new Date('2026-09-25T00:00:00Z'))).toMatchObject({
      multiplier: '2',
      complete: true,
    });
    expect(multiplierAsOf(history, new Date('2026-08-01T00:00:00Z'))).toMatchObject({
      multiplier: null,
      complete: false,
    });
    expect(multiplierAsOf([], new Date())).toMatchObject({
      complete: false,
      detail: 'no multiplier evidence recorded for this instrument',
    });
  });
});
