import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F08/', import.meta.url).pathname;
const RPC_BASE = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}`;
const REGISTRY_CONTROL = `${RPC_BASE}/fixture/registry`;
const FUNDING_CONTROL = `${RPC_BASE}/fixture/funding`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'publishing journeys need the real API, the fixture ledger and admitted fixture instruments (set MARKOV_TEST_DATABASE_URL)',
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
    data: { action: 'fund', address, lamports: 20_000_000 },
  });
  expect(funded.ok()).toBe(true);
  // The funding panel reads balances through the fixture RPC as well; keep both views consistent.
  await context.request.post(FUNDING_CONTROL, {
    data: { address, lamports: 20_000_000, stablecoinRaw: '0' },
  });
  return address;
}

async function ledger(context: BrowserContext, action: string, extra: object = {}): Promise<void> {
  const response = await context.request.post(REGISTRY_CONTROL, { data: { action, ...extra } });
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

/** Builds a valid two-constituent basket and freezes it; answers the version page URL. */
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
  await expect(page.getByText('No frozen version yet')).toBeVisible();
  await page.getByTestId('freeze-button').click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/);
  return { strategyUrl, versionUrl: new URL(page.url()).pathname };
}

test.describe('public publishing, versions and forks', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 120) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('registers a frozen version with the fixture wallet, restores the state on reload, deprecates it, and serves the public page to strangers who follow and fork', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('p-alice', testInfo), '/settings/wallets');
    const address = await verifyAndFundWallet(page, context);

    const { strategyUrl, versionUrl } = await freezeBasket(page, 'Registered aerospace');
    await expect(page.getByTestId('publication-state')).toHaveText('Saved privately');
    await expect(page.getByTestId('version-state')).toHaveText('Saved privately');
    await expect(page.getByTestId('recipe-leg')).toHaveCount(2);

    // Prepare: the connected verified wallet is the publisher; the API answers what becomes public and the cost.
    await expect(page.getByTestId('prepare-button')).not.toHaveAttribute('aria-disabled', 'true', {
      timeout: 10_000,
    });
    await page.getByTestId('prepare-button').click();
    const preview = page.getByTestId('publish-preview');
    await expect(preview).toBeVisible();
    await expect(page.getByTestId('publication-state')).toHaveText('Publishing');
    await expect(preview.getByTestId('preview-leg')).toHaveCount(2);
    await expect(preview).toContainText(address);
    await expect(page.getByTestId('permanence')).toContainText('never be edited or deleted');
    await expect(page.getByTestId('estimated-cost')).toContainText('SOL');
    await expect(page.getByTestId('estimated-cost')).toContainText('lamports');
    await page.screenshot({ path: `${evidenceDir}publish-review-${width}.png`, fullPage: true });

    // Sign with the injected wallet and submit; the state shown is what the API derives from the chain.
    await expect(page.getByTestId('sign-button')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('permanence-checkbox').check();
    await expect(page.getByTestId('sign-button')).toHaveText('Sign with Fixture Wallet');
    await page.getByTestId('sign-button').click();
    await expect(page.getByTestId('submitted-block')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('publication-state')).toHaveText('Publishing');
    await expect(page.getByTestId('submitted-signature')).toBeVisible();

    // Finality on the fixture ledger, then read back: evidence and verification come from the API.
    await ledger(context, 'finalize');
    await page.getByTestId('recheck-button').click();
    await expect(page.getByTestId('publication-state')).toHaveText('Registered on-chain', {
      timeout: 15_000,
    });
    const evidence = page.getByTestId('registration-evidence');
    await expect(evidence).toBeVisible();
    await expect(evidence.getByRole('link', { name: 'Record on Solana Explorer' })).toHaveAttribute(
      'href',
      /^https:\/\/explorer\.solana\.com\/address\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/,
    );
    await expect(
      evidence.getByRole('link', { name: 'Transaction on Solana Explorer' }),
    ).toHaveAttribute(
      'href',
      /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/,
    );
    await expect(evidence.getByTestId('verification')).toContainText('Verified against the chain');
    await expect(evidence).toContainText(address);
    await page.screenshot({
      path: `${evidenceDir}publish-registered-${width}.png`,
      fullPage: true,
    });

    // A reload restores the registration from the API, not from anything kept in the browser.
    await page.reload();
    await expect(page.getByTestId('publication-state')).toHaveText('Registered on-chain');
    await expect(page.getByTestId('version-state')).toHaveText('Registered on-chain');
    await expect(page.getByTestId('registration-evidence')).toBeVisible();

    // Deprecation: only the status byte moves, signed by the publisher wallet.
    await expect(page.getByTestId('status-change-button')).toHaveText('Deprecate this version');
    await page.getByTestId('status-change-button').click();
    await expect(page.getByTestId('status-change-state')).toHaveText('Deprecation prepared');
    await page.getByTestId('permanence-checkbox').check();
    await page.getByTestId('sign-button').click();
    await expect(page.getByTestId('status-change-state')).toHaveText('Deprecation sent', {
      timeout: 15_000,
    });
    await ledger(context, 'finalize');
    await page.getByTestId('recheck-button').click();
    await expect(page.getByTestId('status-change-state')).toHaveText('Deprecation registered', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('status-change-button')).toHaveText('Reactivate this version');

    // The strategy page lists the version as registered and counts followers.
    await page.goto(strategyUrl);
    await expect(page.getByTestId('version-row')).toHaveCount(1);
    await expect(page.getByTestId('version-row').first()).toContainText('Registered on-chain');
    await expect(page.getByTestId('public-summary')).toContainText(
      '1 registered version and 0 followers',
    );

    // Anonymous readers get the public projection with evidence and never the owner's controls.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto(versionUrl);
    await expect(visitor.getByTestId('version-state')).toHaveText('Registered on-chain');
    await expect(visitor.getByText('Deprecated', { exact: true }).first()).toBeVisible();
    await expect(visitor.getByTestId('registration-evidence')).toContainText('Deprecated');
    await expect(visitor.getByTestId('verification')).toContainText('Verified against the chain');
    await expect(visitor.getByTestId('registry-record')).toContainText('deprecated');
    await expect(visitor.getByTestId('publish-panel')).toHaveCount(0);
    await visitor.getByText('Show the canonical bytes').click();
    await expect(visitor.getByTestId('canonical-manifest')).toContainText('"schemaVersion"');
    await expect(visitor.getByRole('link', { name: 'Review investment' })).toHaveAttribute(
      'href',
      /\/sign-in\?next=%2Freview%2Fnew/,
    );
    await visitor.screenshot({ path: `${evidenceDir}version-public-${width}.png`, fullPage: true });
    await visitor.goto(strategyUrl);
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Registered aerospace');
    await expect(visitor.getByTestId('follower-count')).toHaveText('0 followers');
    await expect(visitor.getByRole('link', { name: 'Sign in to follow' })).toBeVisible();
    await expect(visitor.getByTestId('public-version-row')).toHaveCount(1);
    await visitor.screenshot({
      path: `${evidenceDir}strategy-public-${width}.png`,
      fullPage: true,
    });
    await anonymous.close();

    // Another person follows and forks; neither touches the original or trades.
    const other = await browser.newContext();
    await other.setExtraHTTPHeaders({ 'x-forwarded-for': `10.90.${clientCounter & 255}.7` });
    const bob = await other.newPage();
    await signIn(bob, subjectFor('p-bob', testInfo), strategyUrl);
    await expect(bob.getByTestId('follower-count')).toHaveText('0 followers');
    await expect(bob.getByTestId('follow-button')).toHaveText('Follow');
    await bob.getByTestId('follow-button').click();
    await expect(bob.getByTestId('follow-button')).toHaveText('Following');
    await expect(bob.getByTestId('follower-count')).toHaveText('1 follower');
    await bob.reload();
    await expect(bob.getByTestId('follow-button')).toHaveText('Following');
    await bob.getByTestId('fork-button').click();
    await expect(bob).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit\?stage=assemble$/);
    await expect(bob.getByRole('heading', { level: 1 })).toContainText(
      'Registered aerospace (fork)',
    );
    await expect(weightOf(bob, 'FXAERO')).toHaveValue('60.00');
    await other.close();

    // The owner's page now counts the follower; the draft is untouched.
    await page.reload();
    await expect(page.getByTestId('public-summary')).toContainText(
      '1 registered version and 1 follower',
    );
  });

  test('reports a registration the network rejected as failed and lets the owner try again', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('p-carol', testInfo), '/settings/wallets');
    const address = await verifyAndFundWallet(page, context);
    await freezeBasket(page, 'Rejected aerospace');
    await expect(page.getByTestId('prepare-button')).not.toHaveAttribute('aria-disabled', 'true', {
      timeout: 10_000,
    });
    await page.getByTestId('prepare-button').click();
    await expect(page.getByTestId('publish-preview')).toBeVisible();
    // This wallet's next submission lands with a program error on the fixture ledger (WeightTotal,
    // 6008); the page learns it from the API's next chain check, on its own poll or on a re-check.
    // The fault is scoped to the fee payer so a test running in parallel never receives it.
    await ledger(context, 'land-error', { code: 6008, payer: address });
    await page.getByTestId('permanence-checkbox').check();
    await page.getByTestId('sign-button').click();
    await expect(page.getByTestId('publication-state')).toHaveText(/Publishing|Failed/, {
      timeout: 15_000,
    });
    await ledger(context, 'finalize');
    await expect(page.getByTestId('publication-state')).toHaveText('Failed', { timeout: 20_000 });
    await expect(page.getByTestId('publication-detail')).toContainText('WeightTotal');
    await expect(page.getByText('Try again')).toBeVisible();
    await expect(page.getByTestId('prepare-button')).toBeVisible();
    await expect(page.getByTestId('registration-evidence')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('publication-state')).toHaveText('Failed');
  });
});
