import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  activeJurisdictionRuleSet,
  addBetaParticipant,
  applyIngestion,
  bindPlatformIdentity,
  budgetUsage,
  createDbClient,
  findInstrumentsByIds,
  findOwnerLimits,
  isBetaParticipant,
  latestEligibilityDecision,
  listActiveTermsDocuments,
  listEligibilityDecisions,
  listInstrumentsForPlanning,
  listJurisdictionRuleSets,
  listReservations,
  listTermsAcknowledgements,
  PolicyVersionConflictError,
  publishJurisdictionRuleSet,
  publishTermsDocument,
  recordEligibilityDecision,
  recordIssuerSnapshot,
  recordPolicyDecision,
  recordTermsAcknowledgement,
  releaseReservation,
  removeBetaParticipant,
  reserveSpend,
  revokeEligibilityDecision,
  runMigrations,
  upsertOwnerLimits,
  upsertUserBySubject,
  utcDayStart,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NOW = new Date('2026-09-24T12:00:00Z');
const LATER = new Date('2026-09-24T12:30:00Z');

async function withPolicyDb(
  fn: (
    db: ReturnType<typeof createDbClient>['db'],
    ids: { userId: string; instrumentId: string },
  ) => Promise<void>,
) {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 16,
      statementTimeoutMs: 10_000,
      applicationName: 'policy-store-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'test',
      );
      const user = await upsertUserBySubject(client.db, {
        issuer: 'https://issuer.test',
        subject: 'did:test:alice',
      });
      const snapshot = await recordIssuerSnapshot(client.db, {
        issuer: 'prestocks',
        source: 'fixture',
        sourceRef: 'fixture:default',
        fetchedAt: NOW,
        contentHash: 'a'.repeat(64),
        schemaVersion: '1',
        itemCount: 1,
        status: 'accepted',
        rejectionReason: null,
        createdBy: 'test',
      });
      await applyIngestion(client.db, {
        issuer: 'prestocks',
        genesisHash: GENESIS,
        snapshotId: snapshot.id,
        now: NOW,
        writes: [
          {
            kind: 'insert',
            product: {
              productId: 'p-1',
              symbol: 'EXA',
              name: 'Example',
              companyName: 'Example Inc',
              kind: 'pre_ipo_exposure',
              mint: 'So11111111111111111111111111111111111111112',
              decimals: 6,
              tokenProgram: 'unknown',
              website: null,
              description: null,
              referencePrice: null,
              underlying: null,
            },
            fingerprint: 'f1',
            status: 'quarantined',
            reasons: [],
          },
        ],
      });
      const instrument = (await listInstrumentsForPlanning(client.db, 'prestocks'))[0];
      if (!instrument) {
        throw new Error('fixture instrument missing');
      }
      await fn(client.db, { userId: user.id, instrumentId: instrument.id });
    } finally {
      await client.close();
    }
  });
}

describe.skipIf(adminUrl === null)('policy store', () => {
  it('publishes immutable rule sets and terms, one active at a time', async () => {
    await withPolicyDb(async (db, { userId }) => {
      const v1 = await publishJurisdictionRuleSet(db, {
        policyVersion: '2026-09-01',
        validityDays: 90,
        rules: [],
        evidence: {},
        publishedBy: 'op-1',
        now: NOW,
      });
      expect(v1.active).toBe(1);
      const v2 = await publishJurisdictionRuleSet(db, {
        policyVersion: '2026-09-24',
        validityDays: 180,
        rules: [
          {
            jurisdiction: 'ZZ',
            capability: 'trade_stocks',
            decision: 'allow',
            issuers: 'all',
            minimumEvidence: 'self_declared',
            reason: 'fixture',
          },
        ],
        evidence: { memo: 'm-1' },
        publishedBy: 'op-1',
        now: LATER,
      });
      expect((await activeJurisdictionRuleSet(db))?.policyVersion).toBe(v2.policyVersion);
      expect(
        (await listJurisdictionRuleSets(db)).map((row) => [row.policyVersion, row.active]),
      ).toEqual([
        ['2026-09-24', 1],
        ['2026-09-01', 0],
      ]);
      await expect(
        publishJurisdictionRuleSet(db, {
          policyVersion: '2026-09-24',
          validityDays: 1,
          rules: [],
          evidence: {},
          publishedBy: 'op-2',
          now: LATER,
        }),
      ).rejects.toBeInstanceOf(PolicyVersionConflictError);
      expect((await activeJurisdictionRuleSet(db))?.publishedBy).toBe('op-1');

      const terms1 = await publishTermsDocument(db, {
        termsVersion: '2026-09-01',
        title: 'T1',
        contentHash: 'a'.repeat(64),
        url: 'https://markov.pet/terms/1',
        requiredFor: ['trade_stocks'],
        publishedBy: 'op-1',
        now: NOW,
      });
      const ack = await recordTermsAcknowledgement(db, {
        userId,
        termsVersion: terms1.termsVersion,
        contentHash: terms1.contentHash,
        channel: 'app',
        now: NOW,
      });
      const again = await recordTermsAcknowledgement(db, {
        userId,
        termsVersion: terms1.termsVersion,
        contentHash: terms1.contentHash,
        channel: 'cli',
        now: LATER,
      });
      expect(again.id).toBe(ack.id);
      expect(again.channel).toBe('app');
      await publishTermsDocument(db, {
        termsVersion: '2026-09-24',
        title: 'T2',
        contentHash: 'b'.repeat(64),
        url: 'https://markov.pet/terms/2',
        requiredFor: ['trade_stocks'],
        publishedBy: 'op-1',
        now: LATER,
      });
      expect((await listActiveTermsDocuments(db)).map((doc) => doc.termsVersion)).toEqual([
        '2026-09-24',
      ]);
      expect((await listTermsAcknowledgements(db, userId)).map((row) => row.termsVersion)).toEqual([
        '2026-09-01',
      ]);
      await expect(
        publishTermsDocument(db, {
          termsVersion: '2026-09-24',
          title: 'dup',
          contentHash: 'c'.repeat(64),
          url: 'https://markov.pet/terms/3',
          requiredFor: ['trade_stocks'],
          publishedBy: 'op-1',
          now: LATER,
        }),
      ).rejects.toBeInstanceOf(PolicyVersionConflictError);
    });
  });

  it('records, lists and revokes eligibility decisions and owner limits', async () => {
    await withPolicyDb(async (db, { userId }) => {
      const first = await recordEligibilityDecision(db, {
        userId,
        capability: 'trade_stocks',
        policyVersion: null,
        jurisdiction: 'ZZ',
        evidenceKind: 'self_declared',
        outcome: 'unknown',
        reasons: ['no rules'],
        issuers: [],
        decidedAt: NOW,
        expiresAt: LATER,
        decidedBy: userId,
      });
      const second = await recordEligibilityDecision(db, {
        userId,
        capability: 'trade_stocks',
        policyVersion: '2026-09-24',
        jurisdiction: 'ZZ',
        evidenceKind: 'self_declared',
        outcome: 'eligible',
        reasons: ['fixture'],
        issuers: ['prestocks'],
        decidedAt: LATER,
        expiresAt: new Date('2027-03-01T00:00:00Z'),
        decidedBy: userId,
      });
      expect((await latestEligibilityDecision(db, userId, 'trade_stocks'))?.id).toBe(second.id);
      expect((await listEligibilityDecisions(db, userId)).map((row) => row.id)).toEqual([
        second.id,
        first.id,
      ]);
      const revoked = await revokeEligibilityDecision(db, {
        decisionId: second.id,
        reason: 'counsel update',
        now: LATER,
      });
      expect(revoked?.revokedReason).toBe('counsel update');
      expect(
        await revokeEligibilityDecision(db, { decisionId: second.id, reason: 'again', now: LATER }),
      ).toBeNull();
      expect(
        (await latestEligibilityDecision(db, userId, 'trade_stocks'))?.revokedAt?.toISOString(),
      ).toBe(LATER.toISOString());

      expect(await findOwnerLimits(db, userId)).toBeNull();
      await upsertOwnerLimits(db, {
        userId,
        limits: { maxOrderNotionalUsdcRaw: '500000000' },
        now: NOW,
      });
      const updated = await upsertOwnerLimits(db, {
        userId,
        limits: { maxOrderNotionalUsdcRaw: '250000000', maxSlippageBps: 25 },
        now: LATER,
      });
      expect(updated.limits).toEqual({ maxOrderNotionalUsdcRaw: '250000000', maxSlippageBps: 25 });
      expect((await findOwnerLimits(db, userId))?.updatedAt.toISOString()).toBe(
        LATER.toISOString(),
      );

      expect(await isBetaParticipant(db, userId)).toBe(false);
      await addBetaParticipant(db, { userId, note: 'pilot', addedBy: 'op-1', now: NOW });
      expect(await isBetaParticipant(db, userId)).toBe(true);
      expect(await removeBetaParticipant(db, userId)).toBe(true);
      expect(await removeBetaParticipant(db, userId)).toBe(false);
    });
  });

  it('serialises concurrent reservations so a shared budget is never overspent', async () => {
    await withPolicyDb(async (db, { userId, instrumentId }) => {
      const DAILY_CAP = 1_000_000_000n; // 1,000 USDC
      const each = '300000000'; // 300 USDC
      const decide = (usage: { dailyUsedUsdcRaw: string }) => ({
        allow: BigInt(usage.dailyUsedUsdcRaw) + BigInt(each) <= DAILY_CAP,
      });
      const attempts = Array.from({ length: 12 }, (_, index) =>
        reserveSpend(db, {
          userId,
          intentId: `intent-${index}`,
          instrumentId,
          side: 'buy',
          notionalUsdcRaw: each,
          now: NOW,
          expiresAt: LATER,
          decide,
        }),
      );
      const outcomes = await Promise.all(attempts);
      const created = outcomes.filter((outcome) => outcome.kind === 'created');
      expect(created).toHaveLength(3);
      expect(outcomes.filter((outcome) => outcome.kind === 'denied')).toHaveLength(9);
      const usage = await budgetUsage(db, userId, NOW);
      expect(usage).toEqual({ dailyUsedUsdcRaw: '900000000', reservedUsdcRaw: '900000000' });
      expect(BigInt(usage.dailyUsedUsdcRaw)).toBeLessThanOrEqual(DAILY_CAP);

      // Idempotent replay of a held intent returns the same hold without deciding again.
      const replay = await reserveSpend(db, {
        userId,
        intentId: 'intent-0',
        instrumentId,
        side: 'buy',
        notionalUsdcRaw: '1',
        now: NOW,
        expiresAt: LATER,
        decide: () => ({ allow: false }),
      });
      expect(replay.kind).toBe('existing');
      if (replay.kind === 'existing') {
        expect(replay.row.notionalUsdcRaw).toBe(each);
      }

      // Releasing frees the account budget but the day keeps only held and consumed holds.
      const released = await releaseReservation(db, { userId, intentId: 'intent-0', now: NOW });
      expect(released?.status).toBe('released');
      expect(await releaseReservation(db, { userId, intentId: 'intent-0', now: NOW })).toBeNull();
      expect(await budgetUsage(db, userId, NOW)).toEqual({
        dailyUsedUsdcRaw: '600000000',
        reservedUsdcRaw: '600000000',
      });

      // Expiry sweeps held reservations out of both budgets; sells never hold account budget.
      await reserveSpend(db, {
        userId,
        intentId: 'sell-1',
        instrumentId,
        side: 'sell',
        notionalUsdcRaw: '100000000',
        now: NOW,
        expiresAt: LATER,
        decide: () => ({ allow: true }),
      });
      expect(await budgetUsage(db, userId, NOW)).toEqual({
        dailyUsedUsdcRaw: '700000000',
        reservedUsdcRaw: '600000000',
      });
      const afterExpiry = await listReservations(db, userId, LATER);
      expect(afterExpiry.filter((row) => row.status === 'expired')).toHaveLength(3);
      expect(await budgetUsage(db, userId, LATER)).toEqual({
        dailyUsedUsdcRaw: '0',
        reservedUsdcRaw: '0',
      });
      expect(await releaseReservation(db, { userId, intentId: 'intent-1', now: LATER })).toBeNull();

      // A new UTC day starts the daily window again; yesterday's holds do not count.
      expect(utcDayStart(new Date('2026-09-24T23:59:59Z')).toISOString()).toBe(
        '2026-09-24T00:00:00.000Z',
      );
      const decisionRow = await recordPolicyDecision(db, {
        userId,
        instrumentId,
        side: 'buy',
        stage: 'quote',
        notionalUsdcRaw: each,
        outcome: 'deny',
        denials: [
          { code: 'DAILY_CAP_EXCEEDED', message: 'x', limit: '1', observed: '2', unit: 'USDC raw' },
        ],
        evidence: { policyVersion: null },
        limits: {
          maxOrderNotionalUsdcRaw: '1',
          maxDailyNotionalUsdcRaw: '1',
          maxAccountNotionalUsdcRaw: '1',
          maxIssuerConcentrationBps: 1,
          maxCompanyConcentrationBps: 1,
          maxSlippageBps: 1,
          maxQuoteAgeSeconds: 1,
          cashReserveBps: 0,
          allowedVenues: ['jupiter'],
        },
        budget: { dailyUsedUsdcRaw: '0' },
        reservationId: null,
        evaluatedAt: NOW,
        expiresAt: LATER,
      });
      expect(decisionRow.outcome).toBe('deny');
      expect(
        (
          await findInstrumentsByIds(db, [instrumentId, '00000000-0000-4000-8000-000000000000'])
        ).map((row) => row.symbol),
      ).toEqual(['EXA']);
      expect(await findInstrumentsByIds(db, [])).toEqual([]);
    });
  });
});
