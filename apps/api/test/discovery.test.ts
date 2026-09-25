import type {
  CreatorProfile,
  DiscoveryResponse,
  ErrorResponse,
  FollowListResponse,
  ModerationDecision,
  ModerationHistoryResponse,
  PortfolioInstance,
  PublicStrategy,
  RankingResponse,
  RegistryRecord,
  StrategyDraftContent,
  StrategyVersion,
} from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, withHarness } from './support/harness.js';

const DAY = 86_400_000;
const BOGUS = '99999999-9999-4999-8999-999999999999';

function content(
  ids: Record<string, string>,
  overrides: Partial<StrategyDraftContent> = {},
): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 6000, note: null },
      { instrumentId: ids['bio'] as string, weightBps: 3000, note: null },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
    ...overrides,
  };
}

async function observe(
  h: Harness,
  operator: string,
  instrumentId: string,
  kind: string,
  value: string,
): Promise<void> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/operator/prices/observations',
    headers: bearer(operator),
    payload: {
      instrumentId,
      kind,
      value,
      unit: 'USD',
      observedAt: h.clock.current.toISOString(),
      source: 'api-test',
      evidence: { note: 'fixture' },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function explore(h: Harness, query = ''): Promise<DiscoveryResponse> {
  const response = await h.app.inject({ method: 'GET', url: `/v1/strategies${query}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DiscoveryResponse;
}

async function instance(h: Harness, token: string, instanceId: string): Promise<PortfolioInstance> {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/instances/${instanceId}`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as PortfolioInstance;
}

async function userId(h: Harness, token: string): Promise<string> {
  const response = await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
  return (response.json() as { user: { id: string } }).user.id;
}

describe.skipIf(adminUrl === null)('discovery API', () => {
  it('lists public strategies with honest ranking entries and creator provenance, moves follower pins only by acceptance, and moderates listings without touching the chain', async () => {
    await withHarness({ venue: 'fixture', registry: true }, async (h) => {
      const operator = await h.operator(['ops:catalog:read', 'ops:catalog:write']);
      const moderator = await h.operator(['ops:discovery:read', 'ops:discovery:write']);
      const ids = await h.seed(operator);
      const alice = await h.user();
      const bob = await h.user('did:test:bob');
      const carol = await h.user('did:test:carol');
      const aliceWallet = await h.linkWallet(alice);
      const bobWallet = await h.linkWallet(bob);
      const carolWallet = await h.linkWallet(carol);
      for (const wallet of [aliceWallet, bobWallet, carolWallet]) {
        h.fund(wallet.signer.publicKey, { lamports: 1_000_000_000, stablecoinRaw: 0n });
      }

      // Nothing is registered: the explorer lists nothing and says what would be listed.
      const empty = await explore(h);
      expect(empty).toMatchObject({
        strategies: [],
        matched: 0,
        nextCursor: null,
        period: '30d',
        sort: 'rank',
        methodologyVersion: 'stocks-v1',
        minHistoryDays: 30,
      });
      expect(empty.note).toContain('without a rank and without a return');
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/creators/${carolWallet.signer.publicKey}` }))
          .statusCode,
      ).toBe(404);

      // Carol registers a recipe and the platform records daily observations for 31 days: enough history to rank.
      const carolV1 = await h.freezeVersion(
        carol,
        content(ids, { title: 'Steady core', thesis: 'Two fixture names, held.' }),
      );
      await observe(h, operator, ids['aero'] as string, 'issuer_mark', '18.25');
      await observe(h, operator, ids['bio'] as string, 'issuer_mark', '40.00');
      const carolRegistration = await h.register(carol, carolV1, carolWallet);
      for (let day = 1; day <= 31; day += 1) {
        h.clock.advance(DAY);
        await observe(
          h,
          operator,
          ids['aero'] as string,
          'issuer_mark',
          (18.25 + day * 0.05).toFixed(2),
        );
        await observe(h, operator, ids['bio'] as string, 'issuer_mark', '40.00');
      }
      // Alice registers hers today: no history yet.
      const aliceV1 = await h.freezeVersion(alice, content(ids));
      expect((await explore(h)).strategies.map((row) => row.strategyId)).toEqual([
        carolV1.strategyId,
      ]);
      const aliceRegistration = await h.register(alice, aliceV1, aliceWallet);

      // Default order: the ranked recipe first with its return, the young one listed without a rank or a return.
      const listed = await explore(h);
      expect(listed.matched).toBe(2);
      expect(listed.strategies.map((row) => row.strategyId)).toEqual([
        carolV1.strategyId,
        aliceV1.strategyId,
      ]);
      const [carolRow, aliceRow] = listed.strategies as [
        DiscoveryResponse['strategies'][number],
        DiscoveryResponse['strategies'][number],
      ];
      expect(carolRow.performance).toMatchObject({
        period: '30d',
        methodologyVersion: 'stocks-v1',
        eligible: true,
        rank: 1,
        reasons: [],
      });
      expect(carolRow.performance.timeWeightedReturn).toMatch(/^0\.\d{8}$/);
      expect(carolRow.performance.historyDays).toBeGreaterThanOrEqual(30);
      expect(aliceRow.performance).toMatchObject({
        eligible: false,
        rank: null,
        timeWeightedReturn: null,
        maxDrawdown: null,
        historyDays: 0,
      });
      expect(aliceRow.performance.reasons).toContain('insufficient_history');
      expect(aliceRow).toMatchObject({
        title: 'Aerospace tilt',
        thesisExcerpt: 'Launch cadence is underestimated.',
        forkOf: null,
        creator: { publisherWallet: aliceWallet.signer.publicKey },
        issuers: ['prestocks'],
        versionCount: 1,
        followerCount: 0,
        latestVersion: {
          versionId: aliceV1.versionId,
          versionNumber: 1,
          manifestHash: aliceV1.manifestHash,
          recordAddress: aliceRegistration.recordAddress,
          status: 'active',
          publisher: aliceWallet.signer.publicKey,
          parentVersionId: null,
          legCount: 2,
          cashWeightBps: 1000,
        },
      });
      expect(aliceRow.latestVersion.constituents.map((leg) => leg.symbol).sort()).toEqual([
        'FXAERO',
        'FXBIO',
      ]);
      // The explorer's rank is the model ranking's rank: one leaderboard, one methodology version.
      const ranking = (
        await h.app.inject({ method: 'GET', url: '/v1/rankings/model?period=30d' })
      ).json() as RankingResponse;
      expect(ranking.entries.map((entry) => [entry.versionId, entry.rank])).toEqual([
        [carolV1.versionId, 1],
        [aliceV1.versionId, null],
      ]);
      expect(ranking.entries[0]?.timeWeightedReturn).toBe(carolRow.performance.timeWeightedReturn);

      // Filters and sorts.
      const byText = await explore(h, '?q=tilt');
      expect(byText.strategies.map((row) => row.strategyId)).toEqual([aliceV1.strategyId]);
      expect((await explore(h, '?q=FXBIO')).matched).toBe(2);
      expect((await explore(h, '?issuer=xstocks')).matched).toBe(0);
      expect((await explore(h, `?instrumentId=${ids['aero']}`)).matched).toBe(2);
      expect(
        (await explore(h, `?creator=${carolWallet.signer.publicKey}`)).strategies.map(
          (row) => row.strategyId,
        ),
      ).toEqual([carolV1.strategyId]);
      expect((await explore(h, '?sort=newest')).strategies.map((row) => row.strategyId)).toEqual([
        aliceV1.strategyId,
        carolV1.strategyId,
      ]);
      // Cursor pagination over the stable order; a cursor from another query is refused.
      const firstPage = await explore(h, '?limit=1');
      expect(firstPage.strategies.map((row) => row.strategyId)).toEqual([carolV1.strategyId]);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await explore(h, `?limit=1&cursor=${firstPage.nextCursor}`);
      expect(secondPage.strategies.map((row) => row.strategyId)).toEqual([aliceV1.strategyId]);
      expect(secondPage.nextCursor).toBeNull();
      const wrongSort = await h.app.inject({
        method: 'GET',
        url: `/v1/strategies?limit=1&sort=newest&cursor=${firstPage.nextCursor}`,
      });
      expect(wrongSort.statusCode).toBe(400);
      expect((wrongSort.json() as ErrorResponse).error.code).toBe('VALIDATION_FAILED');
      expect(
        (await h.app.inject({ method: 'GET', url: '/v1/strategies?cursor=not-a-cursor' }))
          .statusCode,
      ).toBe(400);

      // Creator provenance comes from chain records: the wallet that signed the registration.
      const creator = await h.app.inject({
        method: 'GET',
        url: `/v1/creators/${carolWallet.signer.publicKey}`,
      });
      expect(creator.statusCode, creator.body).toBe(200);
      expect(creator.json() as CreatorProfile).toMatchObject({
        publisherWallet: carolWallet.signer.publicKey,
        strategyCount: 1,
        versionCount: 1,
        followerCount: 0,
        firstRegisteredAt: carolRow.latestVersion.registeredAt,
        latestRegisteredAt: carolRow.latestVersion.registeredAt,
        strategies: [
          {
            strategyId: carolV1.strategyId,
            latestVersion: { recordAddress: carolRegistration.recordAddress },
          },
        ],
      });
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/creators/${bobWallet.signer.publicKey}` }))
          .statusCode,
      ).toBe(404);

      // Private data never reaches a public projection.
      const secrets = [
        await userId(h, alice),
        await userId(h, bob),
        await userId(h, carol),
        aliceWallet.walletId,
        bobWallet.walletId,
        carolWallet.walletId,
        'ownerUserId',
        'authorPrincipal',
        'instanceId',
      ];
      const dump = JSON.stringify(listed) + creator.body;
      for (const secret of secrets) {
        expect(dump).not.toContain(secret);
      }

      // Bob follows Alice's strategy (a count in public) and pins her public version in an instance of his own.
      const followed = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/follows/${aliceV1.strategyId}`,
        headers: bearer(bob),
      });
      expect(followed.statusCode, followed.body).toBe(201);
      expect(
        (await explore(h, '?sort=followers')).strategies.map((row) => row.followerCount),
      ).toEqual([1, 0]);
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/instances',
        headers: bearer(bob),
        payload: {
          strategyId: aliceV1.strategyId,
          versionId: aliceV1.versionId,
          walletId: bobWallet.walletId,
          label: 'following Alice',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const bobInstance = created.json() as PortfolioInstance;
      expect(bobInstance).toMatchObject({
        strategyId: aliceV1.strategyId,
        pinnedVersionId: aliceV1.versionId,
        pinnedVersionNumber: 1,
        proposedVersionId: null,
      });
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/instances',
            headers: bearer(bob),
            payload: {
              strategyId: BOGUS,
              versionId: aliceV1.versionId,
              walletId: bobWallet.walletId,
              label: null,
            },
          })
        ).statusCode,
      ).toBe(404);

      // Alice edits her draft and freezes v2 without registering it: nothing public changes and Bob is offered nothing.
      const saved = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/strategies/${aliceV1.strategyId}/draft`,
        headers: bearer(alice),
        payload: {
          content: content(ids, {
            title: 'Aerospace tilt, cash heavy',
            legs: [
              { instrumentId: ids['aero'] as string, weightBps: 5000, note: null },
              { instrumentId: ids['bio'] as string, weightBps: 3000, note: null },
            ],
            cashWeightBps: 2000,
          }),
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const frozen = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${aliceV1.strategyId}/versions`,
        headers: bearer(alice),
        payload: {},
      });
      expect(frozen.statusCode, frozen.body).toBe(201);
      const aliceV2 = frozen.json() as StrategyVersion;
      expect(aliceV2.versionNumber).toBe(2);
      expect(await instance(h, bob, bobInstance.instanceId)).toMatchObject({
        pinnedVersionNumber: 1,
        proposedVersionId: null,
      });
      const unpublishedRow = (await explore(h, '?q=tilt')).strategies[0];
      expect(unpublishedRow).toMatchObject({
        title: 'Aerospace tilt',
        versionCount: 1,
        latestVersion: { versionNumber: 1 },
      });
      expect(JSON.stringify(await explore(h))).not.toContain('cash heavy');
      for (const attempt of [
        h.app.inject({
          method: 'POST',
          url: '/v1/me/instances',
          headers: bearer(bob),
          payload: {
            strategyId: aliceV1.strategyId,
            versionId: aliceV2.versionId,
            walletId: bobWallet.walletId,
            label: null,
          },
        }),
        h.app.inject({
          method: 'POST',
          url: `/v1/me/instances/${bobInstance.instanceId}/pin`,
          headers: bearer(bob),
          payload: { versionId: aliceV2.versionId },
        }),
      ]) {
        expect((await attempt).statusCode).toBe(404);
      }

      // Registration of v2 offers it to Bob; his pin stays at v1 until he accepts explicitly.
      const v2Registration = await h.register(alice, aliceV2, aliceWallet);
      expect(await instance(h, bob, bobInstance.instanceId)).toMatchObject({
        pinnedVersionNumber: 1,
        proposedVersionId: aliceV2.versionId,
      });
      const publishedRow = (await explore(h, '?q=tilt')).strategies[0];
      expect(publishedRow).toMatchObject({
        title: 'Aerospace tilt, cash heavy',
        versionCount: 2,
        latestVersion: {
          versionNumber: 2,
          parentVersionId: aliceV1.versionId,
          cashWeightBps: 2000,
        },
      });
      const accepted = await h.app.inject({
        method: 'POST',
        url: `/v1/me/instances/${bobInstance.instanceId}/pin`,
        headers: bearer(bob),
        payload: { versionId: aliceV2.versionId },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json()).toMatchObject({ pinnedVersionNumber: 2, proposedVersionId: null });

      // Moderation: the right scope only; hiding v2 takes it out of every public listing, leaves the chain
      // record readable, leaves Bob's pin alone, and is recorded with its reason.
      const moderationUrl = `/v1/operator/strategies/${aliceV1.strategyId}/versions/${aliceV2.versionId}/moderation`;
      const decision = {
        status: 'hidden',
        reason: 'Withheld pending a review of the thesis sources.',
      };
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: moderationUrl,
            headers: bearer(operator),
            payload: decision,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: moderationUrl,
            headers: bearer(alice),
            payload: decision,
          })
        ).statusCode,
      ).toBe(403);
      const hidden = await h.app.inject({
        method: 'POST',
        url: moderationUrl,
        headers: bearer(moderator),
        payload: decision,
      });
      expect(hidden.statusCode, hidden.body).toBe(201);
      expect(hidden.json() as ModerationDecision).toMatchObject({
        strategyId: aliceV1.strategyId,
        versionId: aliceV2.versionId,
        versionNumber: 2,
        status: 'hidden',
        previousStatus: 'none',
        reason: decision.reason,
        reference: null,
      });
      expect((await explore(h, '?q=tilt')).strategies[0]).toMatchObject({
        title: 'Aerospace tilt',
        versionCount: 1,
        latestVersion: { versionNumber: 1 },
      });
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/strategies/${aliceV1.strategyId}/versions/${aliceV2.versionId}`,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: `/v1/strategies/${aliceV1.strategyId}` })
          ).json() as PublicStrategy
        ).versions.map((version) => version.versionNumber),
      ).toEqual([1]);
      const record = await h.app.inject({
        method: 'GET',
        url: `/v1/registry/records/${v2Registration.recordAddress}`,
      });
      expect(record.statusCode, record.body).toBe(200);
      expect(record.json() as RegistryRecord).toMatchObject({
        status: 'active',
        manifestHash: aliceV2.manifestHash,
        version: null,
      });
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/rankings/model?period=30d' })
          ).json() as RankingResponse
        ).entries.map((entry) => entry.versionId),
      ).not.toContain(aliceV2.versionId);
      expect(await instance(h, bob, bobInstance.instanceId)).toMatchObject({
        pinnedVersionNumber: 2,
        proposedVersionId: null,
      });
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/follows', headers: bearer(bob) })
          ).json() as FollowListResponse
        ).follows[0]?.latestVersion?.versionNumber,
      ).toBe(1);
      const own = await h.app.inject({
        method: 'GET',
        url: `/v1/me/strategies/${aliceV1.strategyId}/versions/${aliceV2.versionId}`,
        headers: bearer(alice),
      });
      expect((own.json() as StrategyVersion).moderation).toBe('hidden');
      const again = await h.app.inject({
        method: 'POST',
        url: moderationUrl,
        headers: bearer(moderator),
        payload: decision,
      });
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as ModerationDecision).decisionId).toBe(
        (hidden.json() as ModerationDecision).decisionId,
      );
      const historyUrl = `/v1/operator/strategies/${aliceV1.strategyId}/moderation`;
      expect(
        (await h.app.inject({ method: 'GET', url: historyUrl, headers: bearer(operator) }))
          .statusCode,
      ).toBe(403);
      const history = await h.app.inject({
        method: 'GET',
        url: historyUrl,
        headers: bearer(moderator),
      });
      expect(history.statusCode, history.body).toBe(200);
      expect(history.json() as ModerationHistoryResponse).toMatchObject({
        strategyId: aliceV1.strategyId,
        versions: [
          { versionNumber: 2, moderation: 'hidden', publication: 'registered' },
          { versionNumber: 1, moderation: 'none', publication: 'registered' },
        ],
        decisions: [{ versionNumber: 2, status: 'hidden' }],
      });
      const visible = await h.app.inject({
        method: 'POST',
        url: moderationUrl,
        headers: bearer(moderator),
        payload: { status: 'none', reason: 'Sources reviewed; nothing to withhold.' },
      });
      expect(visible.statusCode, visible.body).toBe(201);
      expect(visible.json() as ModerationDecision).toMatchObject({
        status: 'none',
        previousStatus: 'hidden',
      });
      expect((await explore(h, '?q=tilt')).strategies[0]?.latestVersion.versionNumber).toBe(2);
      expect(
        (await h.app.inject({ method: 'GET', url: historyUrl, headers: bearer(moderator) })).json()
          .decisions,
      ).toHaveLength(2);

      // Archiving hides the strategy from discovery and the ranking; its versions and Bob's instance stay readable.
      const archived = await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/strategies/${aliceV1.strategyId}`,
        headers: bearer(alice),
        payload: { status: 'archived' },
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect((await explore(h)).strategies.map((row) => row.strategyId)).toEqual([
        carolV1.strategyId,
      ]);
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/rankings/model?period=30d' })
          ).json() as RankingResponse
        ).entries.map((entry) => entry.strategyId),
      ).toEqual([carolV1.strategyId]);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/strategies/${aliceV1.strategyId}/versions/${aliceV2.versionId}`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/creators/${aliceWallet.signer.publicKey}` }))
          .statusCode,
      ).toBe(404);
      const onArchived = await h.app.inject({
        method: 'POST',
        url: '/v1/me/instances',
        headers: bearer(bob),
        payload: {
          strategyId: aliceV1.strategyId,
          versionId: aliceV2.versionId,
          walletId: bobWallet.walletId,
          label: null,
        },
      });
      expect(onArchived.statusCode).toBe(400);
      expect((onArchived.json() as ErrorResponse).error.code).toBe('VALIDATION_FAILED');
      expect(await instance(h, bob, bobInstance.instanceId)).toMatchObject({
        pinnedVersionNumber: 2,
      });
      await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/strategies/${aliceV1.strategyId}`,
        headers: bearer(alice),
        payload: { status: 'active' },
      });
      expect((await explore(h)).matched).toBe(2);
    });
  }, 120_000);
});
