import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F12/', import.meta.url).pathname;
const RPC_BASE = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}`;
const REGISTRY_CONTROL = `${RPC_BASE}/fixture/registry`;
const FUNDING_CONTROL = `${RPC_BASE}/fixture/funding`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'discovery journeys need the real API, the fixture ledger and admitted fixture instruments (set MARKOV_TEST_DATABASE_URL)',
);

let clientCounter = 0;

function subjectFor(
  name: string,
  testInfo: { readonly project: { readonly name: string } },
): string {
  return `did:test:${name}-${testInfo.project.name.startsWith('phone') ? 'p' : 'd'}`;
}

async function signIn(page: Page, subject: string, next: string): Promise<void> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Subject', { exact: false }).fill(subject);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (char) => `\\${char}`)}$`));
}

/** Connects and verifies the injected fixture wallet, then gives it lamports on the fixture ledger. */
async function verifyAndFundWallet(page: Page, context: BrowserContext): Promise<string> {
  await page.getByRole('button', { name: 'Choose Fixture Wallet' }).click();
  const address = (await page.getByTestId('connected-address').textContent()) ?? '';
  await page.getByTestId('verify-ownership').click();
  await expect(page.getByText('Wallet verified')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  const funded = await context.request.post(REGISTRY_CONTROL, {
    data: { action: 'fund', address, lamports: 40_000_000 },
  });
  expect(funded.ok()).toBe(true);
  await context.request.post(FUNDING_CONTROL, {
    data: { address, lamports: 40_000_000, stablecoinRaw: '0' },
  });
  return address;
}

async function ledger(context: BrowserContext, action: string): Promise<void> {
  const response = await context.request.post(REGISTRY_CONTROL, { data: { action } });
  expect(response.ok()).toBe(true);
}

async function awaitSaved(page: Page): Promise<void> {
  const status = page.getByTestId('save-status');
  await expect(status).not.toContainText(
    /Editing|Saving|unsaved edits|Offline|Conflict|Not saved/,
    {
      timeout: 10_000,
    },
  );
  await expect(status).toContainText('Saved as revision');
}

const weightOf = (page: Page, symbol: string) =>
  page.getByLabel(`Weight of ${symbol}`, { exact: false });

async function addConstituent(page: Page, symbol: string): Promise<void> {
  await page.getByLabel('Search admitted instruments to add').fill(symbol);
  await page.getByRole('button', { name: `Add ${symbol}` }).click();
  await expect(weightOf(page, symbol)).toBeVisible();
}

/** Builds a two-constituent basket (60/30/10) and freezes it; answers the strategy and version URLs. */
async function freezeBasket(
  page: Page,
  title: string,
): Promise<{ strategyUrl: string; versionUrl: string }> {
  await page.goto('/strategies/new');
  await page.getByLabel('Title', { exact: false }).fill(title);
  await page
    .getByLabel('Thesis in your words', { exact: false })
    .fill('Launch cadence is underestimated by the market.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit\?stage=assemble$/);
  await addConstituent(page, 'FXAERO');
  await addConstituent(page, 'FXBIO');
  await weightOf(page, 'FXAERO').fill('60');
  await weightOf(page, 'FXBIO').fill('30');
  await page.getByLabel('Cash held as stablecoin', { exact: false }).fill('10');
  await awaitSaved(page);
  await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
    timeout: 10_000,
  });
  await page.getByRole('link', { name: 'Versions and publishing' }).click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}$/);
  const strategyUrl = new URL(page.url()).pathname;
  await page.getByTestId('freeze-button').click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/);
  return { strategyUrl, versionUrl: new URL(page.url()).pathname };
}

/** Registers the version open on the page with the connected fixture wallet and waits for finality. */
async function registerOpenVersion(page: Page, context: BrowserContext): Promise<void> {
  await expect(page.getByTestId('prepare-button')).not.toHaveAttribute('aria-disabled', 'true', {
    timeout: 10_000,
  });
  await page.getByTestId('prepare-button').click();
  await expect(page.getByTestId('publish-preview')).toBeVisible();
  await page.getByTestId('permanence-checkbox').check();
  await page.getByTestId('sign-button').click();
  await expect(page.getByTestId('submitted-block')).toBeVisible({ timeout: 15_000 });
  await ledger(context, 'finalize');
  await page.getByTestId('recheck-button').click();
  await expect(page.getByTestId('publication-state')).toHaveText('Registered on-chain', {
    timeout: 15_000,
  });
}

test.describe('strategy explorer, following, rankings and creator updates', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 140) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('lists a registered recipe without a rank, shows its creator, lets a follower pin it and accept the creator’s next version explicitly', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    // Both projects share one API and one explorer: the title names the project so the rows stay apart.
    const title = `Explorer aerospace ${width === 320 ? 'phone' : 'desktop'}`;

    // The creator registers version 1 with the fixture wallet.
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('x-alice', testInfo), '/settings/wallets');
    const creatorAddress = await verifyAndFundWallet(page, context);
    const { strategyUrl, versionUrl } = await freezeBasket(page, title);
    await registerOpenVersion(page, context);
    const strategyId = strategyUrl.split('/').at(-1) as string;
    const v1Id = versionUrl.split('/').at(-1) as string;

    // Anyone can explore: the young recipe is listed with the reason and no return, and its creator is a wallet.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto('/explore');
    await expect(visitor.getByRole('tab', { name: 'Strategies' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const row = visitor.getByTestId('strategy-row').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('strategy-performance')).toContainText('Unranked');
    await expect(row.getByTestId('strategy-performance')).toContainText(
      'less than 30 days of complete history',
    );
    await expect(row.getByTestId('strategy-performance')).not.toContainText('%');
    await expect(row.getByTestId('strategy-followers')).toHaveText('0 followers');
    await expect(row.locator(`a[href="/creators/${creatorAddress}"]`)).toBeVisible();
    await expect(visitor.getByTestId('strategies-source')).toContainText('stocks-v1');
    await expect(visitor.getByTestId('build-your-own')).toBeVisible();
    await visitor.screenshot({
      path: `${evidenceDir}explore-strategies-${width}.png`,
      fullPage: true,
    });
    // Search narrows by title and lives in the URL.
    await visitor.getByRole('searchbox', { name: 'Search' }).fill('Explorer');
    await expect(visitor).toHaveURL(/\/explore\?q=Explorer$/);
    await expect(row).toHaveCount(1);
    await visitor.getByRole('searchbox', { name: 'Search' }).fill('nothing-like-this');
    await expect(visitor.getByText('No public strategy matches')).toBeVisible();

    // Rankings: the same entry, unranked for the same reason, next to the methodology.
    await visitor.goto('/rankings');
    const rankingRow = visitor.getByTestId('ranking-row').filter({ hasText: title });
    await expect(rankingRow).toHaveCount(1);
    await expect(rankingRow.getByTestId('ranking-unranked')).toContainText(
      'less than 30 days of complete history',
    );
    await expect(visitor.getByTestId('methodology-panel')).toContainText('stocks-v1');
    await expect(visitor.getByTestId('rankings-summary')).toContainText('listed without a rank');
    await visitor.screenshot({ path: `${evidenceDir}rankings-${width}.png`, fullPage: true });

    // Creator page: provenance from the chain record only.
    await visitor.goto(`/creators/${creatorAddress}`);
    await expect(visitor.getByTestId('creator-facts')).toContainText('Listed strategies');
    await expect(visitor.getByTestId('strategy-row').filter({ hasText: title })).toHaveCount(1);
    await expect(visitor.getByTestId('creator-note')).toContainText('no name');
    await visitor.screenshot({ path: `${evidenceDir}creator-${width}.png`, fullPage: true });

    // The public strategy page carries the creator and the honest ranking line; the version page its model series.
    await visitor.goto(strategyUrl);
    await expect(visitor.getByTestId('creator-link')).toHaveAttribute(
      'href',
      `/creators/${creatorAddress}`,
    );
    await expect(visitor.getByTestId('strategy-ranking')).toContainText('Unranked');
    await visitor.goto(versionUrl);
    await expect(visitor.getByTestId('version-creator-link')).toHaveAttribute(
      'href',
      `/creators/${creatorAddress}`,
    );
    await expect(visitor.getByTestId('model-performance-label')).toBeVisible();
    await anonymous.close();

    // A second person follows and pins version 1 in an instance of their own (the call the review start makes).
    const followerContext = await browser.newContext();
    await followerContext.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 150) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
    await installFixtureWallet(followerContext, { keys: generateFixtureKeys() });
    const follower = await followerContext.newPage();
    await signIn(follower, subjectFor('x-bob', testInfo), '/settings/wallets');
    await follower.getByRole('button', { name: 'Choose Fixture Wallet' }).click();
    await follower.getByTestId('verify-ownership').click();
    await expect(follower.getByText('Wallet verified')).toBeVisible();
    await follower.getByRole('button', { name: 'Done' }).click();
    await follower.goto(strategyUrl);
    await follower.getByTestId('follow-button').click();
    await expect(follower.getByTestId('follow-button')).toHaveText('Following');
    await expect(follower.getByTestId('follower-count')).toHaveText('1 follower');
    await follower.goto('/explore');
    await expect(
      follower
        .getByTestId('strategy-row')
        .filter({ hasText: title })
        .getByTestId('strategy-following'),
    ).toBeVisible();
    await expect(follower.getByTestId('following-section')).toContainText(title);
    const walletId = await follower.evaluate(async () => {
      const response = await fetch('/api/markov/v1/me/wallets');
      const body = (await response.json()) as { wallets: { walletId: string }[] };
      return body.wallets[0]?.walletId ?? '';
    });
    const instanceId = await follower.evaluate(
      async (input) => {
        const response = await fetch('/api/markov/v1/me/instances', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, label: 'following' }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return ((await response.json()) as { instanceId: string }).instanceId;
      },
      { strategyId, versionId: v1Id, walletId },
    );
    await follower.goto(`/portfolio/${instanceId}`);
    await expect(follower.getByText('Pinned to version 1')).toBeVisible();
    await expect(follower.getByTestId('proposal-panel')).toHaveCount(0);

    // The creator registers version 2 (cash heavier): the follower is offered it, with the exact difference.
    await page.goto(`${strategyUrl}/edit?stage=assemble`);
    await weightOf(page, 'FXAERO').fill('50');
    await page.getByLabel('Cash held as stablecoin', { exact: false }).fill('20');
    await awaitSaved(page);
    await page.goto(strategyUrl);
    await page.getByTestId('freeze-button').click();
    await expect(page).toHaveURL(/\/versions\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('version-state')).toHaveText('Saved privately');
    await registerOpenVersion(page, context);

    await follower.goto(`/portfolio/${instanceId}`);
    const proposal = follower.getByTestId('proposal-panel');
    await expect(proposal).toBeVisible();
    await expect(follower.getByText('Pinned to version 1')).toBeVisible();
    await expect(proposal.getByTestId('version-diff')).toContainText('FXAERO: 60.00% → 50.00%');
    await expect(proposal.getByTestId('version-diff')).toContainText('Cash: 10.00% → 20.00%');
    await expect(proposal.getByTestId('version-diff')).toContainText('10.00% of the portfolio');
    await follower.screenshot({ path: `${evidenceDir}proposal-${width}.png`, fullPage: true });
    await follower.getByTestId('accept-version').click();
    await expect(follower.getByText('Pinned to version 2')).toBeVisible({ timeout: 10_000 });
    await expect(follower.getByTestId('proposal-panel')).toHaveCount(0);
    await follower.reload();
    await expect(follower.getByText('Pinned to version 2')).toBeVisible();
    await followerContext.close();
  });
});
