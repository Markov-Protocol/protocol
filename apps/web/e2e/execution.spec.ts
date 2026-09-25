import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F10/', import.meta.url).pathname;
const RPC_BASE = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}`;
const FUNDING_CONTROL = `${RPC_BASE}/fixture/funding`;
const CHAIN_CONTROL = `${RPC_BASE}/fixture/chain`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'execution journeys need the real API with the fixture venue, the fixture chain and the fixture wallet (set MARKOV_TEST_DATABASE_URL)',
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

async function verifyWallet(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Choose Fixture Wallet' }).click();
  const address = (await page.getByTestId('connected-address').textContent()) ?? '';
  await page.getByTestId('verify-ownership').click();
  await expect(page.getByText('Wallet verified')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  return address;
}

async function setFunding(
  context: BrowserContext,
  address: string,
  lamports: number,
  stablecoinRaw: string,
): Promise<void> {
  const response = await context.request.post(FUNDING_CONTROL, {
    data: { address, lamports, stablecoinRaw },
  });
  expect(response.ok()).toBe(true);
}

/** Fixture chain controls: finality, lost answers, landed errors and slot advances, exactly like the API tests use them. */
async function chain(
  context: BrowserContext,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const response = await context.request.post(CHAIN_CONTROL, { data: { action, ...extra } });
  expect(response.ok(), `fixture chain action ${action}`).toBe(true);
}

async function becomeEligible(page: Page): Promise<void> {
  await page.goto('/settings/eligibility');
  const form = page.getByRole('form', { name: 'Declare your jurisdiction' });
  await form.getByLabel('Country of residence', { exact: false }).fill('ZZ');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Record declaration' }).click();
  await expect(page.getByTestId('eligibility-outcome')).toHaveText('Eligible');
  await page.getByRole('button', { name: 'I have read and acknowledge this version' }).click();
  await expect(page.getByText('Terms acknowledged')).toBeVisible();
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

/** A two-issuer basket (FXAERO 60 %, XSFXA 30 %, cash 10 %) frozen as version 1; answers the version page path. */
async function freezeBasket(page: Page, title: string): Promise<string> {
  await page.goto('/strategies/new');
  await page.getByLabel('Title', { exact: false }).fill(title);
  await page
    .getByLabel('Thesis in your words', { exact: false })
    .fill('Launch cadence is underestimated by the market.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit\?stage=assemble$/);
  await addConstituent(page, 'FXAERO');
  await addConstituent(page, 'XSFXA');
  await weightOf(page, 'FXAERO').fill('60');
  await weightOf(page, 'XSFXA').fill('30');
  await page.getByLabel('Cash held as stablecoin', { exact: false }).fill('10');
  await awaitSaved(page);
  await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
    timeout: 10_000,
  });
  await page.getByRole('link', { name: 'Versions and publishing' }).click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}$/);
  await page.getByTestId('freeze-button').click();
  await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

async function chooseWallet(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Wallet' }).click();
  await page.getByRole('option', { name: /verified/ }).click();
}

/** Starts a single buy of FXAERO from the instrument page and approves its plan; answers the intent id. */
async function approvedSingleBuy(page: Page, budget: string): Promise<string> {
  await page.goto('/explore?q=FXAERO');
  await page
    .getByRole('link', { name: /FXAERO/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/markets\/[0-9a-f-]{36}$/);
  await page.getByTestId('review-buy').click();
  await expect(page).toHaveURL(/\/review\/new\?instrumentId=[0-9a-f-]{36}$/);
  await chooseWallet(page);
  await page.getByLabel(/^Budget \(USDC\)/).fill(budget);
  await page.getByTestId('create-intent').click();
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
  return new URL(page.url()).pathname.split('/').pop() as string;
}

/** Builds the next transaction and signs it with the fixture wallet; the submission answer opens the timeline. */
async function buildAndSign(page: Page, label: string): Promise<void> {
  const build = page.getByTestId('build-cta');
  await expect(build).toHaveText(`Build ${label}`);
  await build.click();
  await expect(page.getByTestId('transaction-preview')).toBeVisible({ timeout: 15_000 });
  const sign = page.getByTestId('sign-cta');
  await expect(sign).toHaveText(`Sign ${label}`);
  await expect(sign).not.toHaveAttribute('aria-disabled', 'true');
  await sign.click();
}

test.describe('signing, execution timeline and recovery', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 160) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('signs a single buy through the wallet, follows it to finality in two tabs and after a reload, issues a receipt and reads it publicly; then recovers a lost answer and an expired transaction', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(300_000);
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('x-alice', testInfo), '/settings/wallets');
    const address = await verifyWallet(page);
    await becomeEligible(page);
    await setFunding(context, address, 50_000_000, '5000000000');

    // Approved plan → the panel builds the exact transaction and shows it before the wallet opens.
    const intentId = await approvedSingleBuy(page, '100');
    await expect(page.getByTestId('build-cta')).toHaveText('Build transaction 1 of 1');
    await page.getByTestId('build-cta').click();
    await expect(page.getByTestId('transaction-preview')).toContainText('Buy FXAERO', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('transaction-preview')).toContainText('simulation ok');
    await expect(page.getByTestId('transaction-preview')).toContainText(address.slice(0, 4));
    await page.screenshot({ path: `${evidenceDir}execution-built-${width}.png`, fullPage: true });

    // One wallet signature, one submission; the review hands off to the persistent timeline.
    const sign = page.getByTestId('sign-cta');
    await expect(sign).toHaveText('Sign transaction 1 of 1');
    await expect(sign).not.toHaveAttribute('aria-disabled', 'true');
    await sign.click();
    await expect(page).toHaveURL(new RegExp(`/activity/${intentId}$`), { timeout: 20_000 });
    await expect(page.getByTestId('execution-state')).toHaveText(
      'Broadcast; waiting for the network',
    );
    await expect(page.getByTestId('timeline-batch')).toHaveAttribute(
      'data-batch-state',
      'submitted',
    );
    await expect(page.getByTestId('batch-signature')).toBeVisible();
    await expect(page.getByTestId('next-step')).toHaveAttribute('data-kind', 'wait');
    const signatureCalls = await page.evaluate(
      () =>
        (window as unknown as { __fixtureWalletCalls: { signTransaction: number } })
          .__fixtureWalletCalls.signTransaction,
    );
    expect(signatureCalls).toBe(1);
    await page.screenshot({
      path: `${evidenceDir}execution-submitted-${width}.png`,
      fullPage: true,
    });

    // A second tab reads the same server state; nothing is local to the first tab.
    const other = await context.newPage();
    await other.goto(`/activity/${intentId}`);
    await expect(other.getByTestId('execution-state')).toHaveText(
      'Broadcast; waiting for the network',
      {
        timeout: 15_000,
      },
    );

    // Confirmed but not yet finalized: the timeline says so, never "complete".
    await chain(context, 'advance', { slots: 2 });
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText(/Confirmed|Broadcast/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('fill-row')).toHaveCount(0);
    await expect(page.getByTestId('issue-receipt')).toHaveCount(0);

    // Finality on the fixture chain, then evidence: the fill, the fee actually paid, the signature.
    await chain(context, 'finalize');
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText('Finalized', { timeout: 15_000 });
    await expect(page.getByTestId('fill-row')).toHaveCount(1);
    await expect(page.getByTestId('fill-row')).toContainText('within bounds');
    await expect(page.getByTestId('batch-fee')).toContainText('SOL');
    await expect(page.getByTestId('timeline-batch')).toHaveAttribute(
      'data-batch-state',
      'finalized',
    );
    // The other tab settles on its own polling schedule, without any action there.
    await expect(other.getByTestId('execution-state')).toHaveText('Finalized', { timeout: 20_000 });
    await other.close();
    await page.screenshot({
      path: `${evidenceDir}execution-finalized-${width}.png`,
      fullPage: true,
    });

    // Reload returns to server state; the receipt is issued once and opens inside the shell.
    await page.reload();
    await expect(page.getByTestId('execution-state')).toHaveText('Finalized', { timeout: 15_000 });
    await page.getByTestId('issue-receipt').click();
    await expect(page.getByTestId('receipt-issued')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('open-receipt').click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
    const receiptUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Execution receipt');
    await expect(page.getByTestId('key-status')).toHaveText('published, active', {
      timeout: 15_000,
    });
    await expect(page.getByText(/settlement is the chain evidence/)).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}receipt-${width}.png`, fullPage: true });

    // Private until opted in: an anonymous reader sees nothing, then the redacted record.
    const anonymous = await context.browser()?.newContext();
    if (anonymous) {
      const reader = await anonymous.newPage();
      await reader.goto(receiptUrl);
      await expect(reader.getByText('Not found')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('toggle-public').click();
      await expect(page.getByTestId('toggle-public')).toHaveText('Make private', {
        timeout: 15_000,
      });
      await reader.reload();
      await expect(reader.getByRole('heading', { level: 1 })).toContainText('Execution receipt', {
        timeout: 15_000,
      });
      await expect(reader.getByText('Public receipt')).toBeVisible();
      await expect(reader.getByTestId('toggle-public')).toHaveCount(0);
      await anonymous.close();
    }

    // The activity list: a stable deep link per order and URL filters.
    await page.goto('/activity');
    await expect(page.getByTestId('activity-row').first()).toContainText('Finalized');
    await page.getByTestId('filter-settled').click();
    await expect(page).toHaveURL(/\/activity\?filter=settled$/);
    await expect(page.getByTestId('activity-row')).toHaveCount(1);
    await page.screenshot({ path: `${evidenceDir}activity-${width}.png`, fullPage: true });

    // Lost answer after the broadcast: the node executed the buy but its answer never arrived.
    // The intent is unknown until reconciled from chain evidence; nothing is signed again.
    await approvedSingleBuy(page, '100');
    await page.getByTestId('build-cta').click();
    await expect(page.getByTestId('sign-cta')).toBeVisible({ timeout: 15_000 });
    await chain(context, 'lose-next-response');
    await page.getByTestId('sign-cta').click();
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByTestId('execution-state')).toHaveText('Result unknown; reconciling');
    await expect(page.getByTestId('next-step')).toHaveAttribute('data-kind', 'reconcile');
    await expect(page.getByTestId('sign-cta')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}execution-unknown-${width}.png`, fullPage: true });
    await chain(context, 'finalize');
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText('Finalized', { timeout: 15_000 });
    await expect(page.getByTestId('fill-row')).toHaveCount(1);

    // Expired blockhash: the built transaction can no longer land, Markov refuses the submission
    // and the person builds again; no funds moved for the refused bytes.
    await approvedSingleBuy(page, '100');
    await page.getByTestId('build-cta').click();
    await expect(page.getByTestId('sign-cta')).toBeVisible({ timeout: 15_000 });
    await chain(context, 'advance', { slots: 400 });
    await page.getByTestId('sign-cta').click();
    await expect(page.getByTestId('execution-failure')).toContainText('can no longer land', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('build-cta')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${evidenceDir}execution-expired-${width}.png`, fullPage: true });
  });

  test('runs a staged basket leg by leg, stops as partially completed when the second leg lands with an error, and completes the unfilled leg under review', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(300_000);
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('x-basket', testInfo), '/settings/wallets');
    const address = await verifyWallet(page);
    await becomeEligible(page);
    await setFunding(context, address, 50_000_000, '5000000000');
    await freezeBasket(page, 'Executed aerospace');

    await page.getByTestId('review-investment').click();
    await expect(page).toHaveURL(
      /\/review\/new\?strategyId=[0-9a-f-]{36}&versionId=[0-9a-f-]{36}$/,
    );
    await chooseWallet(page);
    await page.getByLabel(/^Budget \(USDC\)/).fill('1000');
    await page.getByTestId('create-intent').click();
    await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('transaction-count')).toContainText(
      '2 signatures across 2 transactions',
    );
    await page.getByTestId('staged-checkbox').check();
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
    const intentId = new URL(page.url()).pathname.split('/').pop() as string;

    // Leg 1: built, signed, broadcast, finalized; the intent returns for the next signature.
    await buildAndSign(page, 'transaction 1 of 2');
    await expect(page).toHaveURL(new RegExp(`/activity/${intentId}$`), { timeout: 20_000 });
    await expect(page.getByTestId('timeline-batch')).toHaveCount(2);
    await chain(context, 'finalize');
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText(
      'Approved; waiting for a signature',
      {
        timeout: 15_000,
      },
    );
    await expect(page.getByTestId('timeline-batch').nth(0)).toHaveAttribute(
      'data-batch-state',
      'finalized',
    );
    await expect(page.getByTestId('fill-row')).toHaveCount(1);
    // Frozen legs are ordered by instrument id, so which constituent went first depends on the ids.
    const filledSymbol = (await page.getByTestId('fill-row').textContent())?.includes('XSFXA')
      ? 'XSFXA'
      : 'FXAERO';
    const unfilledSymbol = filledSymbol === 'XSFXA' ? 'FXAERO' : 'XSFXA';
    await page.screenshot({ path: `${evidenceDir}basket-leg1-${width}.png`, fullPage: true });

    // Leg 2 lands with an error on the fixture chain: the run stops as partially completed,
    // what filled stays, and the unfilled leg can be completed under a new review.
    await chain(context, 'land-error', { code: 1 });
    await buildAndSign(page, 'transaction 2 of 2');
    await expect(page.getByTestId('execution-state')).toHaveText(
      /Broadcast|Partially completed|Failed/,
      {
        timeout: 20_000,
      },
    );
    await chain(context, 'finalize');
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText('Partially completed', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('execution-summary')).toContainText('1 leg filled');
    await expect(page.getByTestId('timeline-batch').nth(1)).toHaveAttribute(
      'data-batch-state',
      'failed',
    );
    await expect(page.getByTestId('fill-row')).toHaveCount(1);
    await expect(page.getByTestId('sign-cta')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}basket-partial-${width}.png`, fullPage: true });

    await page.getByTestId('review-continuation').click();
    await expect(page).toHaveURL(/\/review\/new\?.*continueIntentId=[0-9a-f-]{36}/);
    await expect(page.getByTestId('continuation-notice')).toBeVisible();
    await chooseWallet(page);
    await page.getByTestId('create-intent').click();
    await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('leg-row')).toHaveCount(1);
    await expect(page.getByTestId('leg-row')).toContainText(unfilledSymbol);
    await expect(page.getByTestId('leg-row')).not.toContainText(filledSymbol);
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
    await buildAndSign(page, 'transaction 1 of 1');
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await chain(context, 'finalize');
    await page.getByTestId('reconcile-cta').click();
    await expect(page.getByTestId('execution-state')).toHaveText('Finalized', { timeout: 15_000 });
    await expect(page.getByTestId('fill-row')).toHaveCount(1);
    await page.screenshot({ path: `${evidenceDir}basket-completed-${width}.png`, fullPage: true });
  });
});
