import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F11/', import.meta.url).pathname;
const RPC_BASE = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}`;
const FUNDING_CONTROL = `${RPC_BASE}/fixture/funding`;
const CHAIN_CONTROL = `${RPC_BASE}/fixture/chain`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'portfolio journeys need the real API with the fixture venue, the fixture chain and the fixture wallet (set MARKOV_TEST_DATABASE_URL)',
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

/** FXAERO 60 %, XSFXA 30 %, cash 10 %, frozen as version 1. */
async function freezeBasket(page: Page, title: string): Promise<void> {
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
}

async function chooseWallet(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Wallet' }).click();
  await page.getByRole('option', { name: /verified/ }).click();
}

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

/** Finalizes the broadcast leg on the fixture chain and waits until the timeline reflects it. */
async function finalizeLeg(page: Page, context: BrowserContext, expected: RegExp): Promise<void> {
  await chain(context, 'finalize');
  await page.getByTestId('reconcile-cta').click();
  await expect(page.getByTestId('execution-state')).toHaveText(expected, { timeout: 20_000 });
}

test.describe('portfolio, holdings, performance and receipts', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 170) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('accounts for a basket investment: holdings against the chain, the instance with its allocation and lots, personal against model performance, a deposit explained, the receipt, and another person seeing nothing', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(360_000);
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('pf-alice', testInfo), '/settings/wallets');
    const address = await verifyWallet(page);
    await becomeEligible(page);
    await setFunding(context, address, 50_000_000, '5000000000');

    // Before anything is bought: a verified wallet, nothing recorded, no instance.
    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-view')).toBeVisible();
    await expect(page.getByTestId('no-holdings')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('no-instances')).toBeVisible();
    await expect(page.getByTestId('summary-checkpoint')).toContainText('Never observed');

    // Invest 200 USDC in a two-constituent basket: the review creates the instance, then two staged legs.
    await freezeBasket(page, 'Accounted aerospace');
    await page.getByTestId('review-investment').click();
    await expect(page).toHaveURL(
      /\/review\/new\?strategyId=[0-9a-f-]{36}&versionId=[0-9a-f-]{36}$/,
    );
    await chooseWallet(page);
    await page.getByLabel(/^Budget \(USDC\)/).fill('200');
    await page.getByTestId('create-intent').click();
    await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('staged-checkbox').check();
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
    const intentId = new URL(page.url()).pathname.split('/').pop() as string;
    await buildAndSign(page, 'transaction 1 of 2');
    await expect(page).toHaveURL(new RegExp(`/activity/${intentId}$`), { timeout: 20_000 });
    await finalizeLeg(page, context, /Approved; waiting for a signature/);
    await buildAndSign(page, 'transaction 2 of 2');
    await expect(page.getByTestId('execution-state')).toHaveText(/Broadcast|Confirmed|Finalized/, {
      timeout: 20_000,
    });
    await finalizeLeg(page, context, /^Finalized$/);
    await expect(page.getByTestId('fill-row')).toHaveCount(2);

    // The receipt explains requested against filled, the fees against the cap, and downloads as JSON.
    await page.getByTestId('issue-receipt').click();
    await expect(page.getByTestId('receipt-issued')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('open-receipt').click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('receipt-leg')).toHaveCount(2);
    await expect(page.getByTestId('receipt-leg').first()).toHaveAttribute('data-status', 'filled');
    await expect(page.getByTestId('receipt-leg').first()).toContainText('filled within bounds');
    await expect(page.getByTestId('receipt-fee-cap')).toContainText('within the cap');
    await expect(page.getByTestId('receipt-fee-cap')).toContainText('finality finalized');
    const receiptDownload = page.waitForEvent('download');
    await page.getByTestId('download-receipt').click();
    expect((await receiptDownload).suggestedFilename()).toMatch(/^receipt-[0-9a-f]{8}\.json$/);
    await page.screenshot({ path: `${evidenceDir}receipt-explained-${width}.png`, fullPage: true });

    // The portfolio: the journal projected from the fills, the instance the fills were attributed to,
    // and one reconciliation with the chain that matches.
    await page.getByRole('link', { name: 'Holdings in the portfolio' }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('holding-row')).toHaveCount(4, { timeout: 15_000 });
    const symbols = await page
      .getByTestId('holding-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset')));
    expect(symbols.sort()).toEqual(['FXAERO', 'SOL', 'USDC', 'XSFXA']);
    await expect(page.getByTestId('instance-card')).toHaveCount(1);
    // The first reconciliation finds the initial funding (SOL for fees, the stablecoin) that no order
    // explains: two inflows the owner explains as deposits; nothing is attributed to the strategy.
    await page.getByTestId('reconcile').click();
    await expect(page.getByTestId('summary-checkpoint')).toContainText('Needs review', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('summary-flows')).toContainText('2 external flows');
    await page.screenshot({
      path: `${evidenceDir}portfolio-unexplained-${width}.png`,
      fullPage: true,
    });
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const form = page.getByTestId('acknowledge-form').first();
      await expect(form).toContainText('Inflow from outside Markov');
      await form.getByLabel('A deposit I made').check();
      await form.getByTestId('acknowledge').click();
      await expect(page.getByTestId('acknowledge-form')).toHaveCount(remaining - 1, {
        timeout: 15_000,
      });
    }
    await expect(page.getByTestId('summary-flows')).toContainText('Nothing pending');
    // Reconciled again with everything explained: the checkpoint matches and every asset does.
    await page.getByTestId('reconcile').click();
    await expect(page.getByTestId('summary-checkpoint')).toContainText('Matched', {
      timeout: 15_000,
    });
    await expect(
      page.locator(
        '[data-testid="holding-row"][data-asset="FXAERO"] [data-testid="holding-status"]',
      ),
    ).toHaveText('Matched');
    await expect(
      page.locator(
        '[data-testid="holding-row"][data-asset="XSFXA"] [data-testid="holding-quantity"]',
      ),
    ).not.toContainText('base units');
    // Every asset is priced (feeds at ingestion, one SOL observation), so the total is a figure and
    // the wallet series is labelled personal with its methodology.
    await expect(page.getByTestId('summary-value')).toContainText(/\$[\d,]+\.\d{2}/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('wallet-performance-label')).toContainText(
      'Personal (actual) · stocks-v1 · USD',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('wallet-performance-chart-summary')).toBeVisible();
    await expect(page.getByTestId('journal-row').first()).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}portfolio-wallet-${width}.png`, fullPage: true });

    // The instance: target against actual with drift, the lots with their cost, fees, personal against
    // the model series over one window, the exact figures, and the complete record as a download.
    await page.getByTestId('instance-card').click();
    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}$/);
    const instanceUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Accounted aerospace', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('allocation-row')).toHaveCount(3);
    await expect(
      page.locator(
        '[data-testid="allocation-row"][data-symbol="FXAERO"] [data-testid="allocation-actual"]',
      ),
    ).toContainText('%', { timeout: 15_000 });
    await expect(page.locator('[data-testid="allocation-row"][data-symbol="cash"]')).toContainText(
      'held in the wallet, not attributed',
    );
    await expect(page.getByTestId('lot-row')).toHaveCount(2);
    await expect(page.getByTestId('cost-basis')).toContainText('base units');
    await expect(page.getByTestId('fees')).toContainText('SOL');
    await expect(page.getByTestId('personal-performance-label')).toContainText(
      'Personal (actual)',
      {
        timeout: 15_000,
      },
    );
    await expect(page.getByTestId('model-performance-label')).toContainText(
      'Model (buy and hold)',
      {
        timeout: 15_000,
      },
    );
    await page.getByTestId('instance-period-30d').click();
    await expect(page).toHaveURL(/\?period=30d$/);
    await expect(page.getByTestId('personal-performance-label')).toContainText('window 30 days');
    await page
      .getByTestId('personal-performance')
      .getByText(/Exact figures behind the latest point/)
      .click();
    await expect(page.getByTestId('personal-performance-position').first()).toBeVisible();
    const exportDownload = page.waitForEvent('download');
    await page.getByTestId('personal-performance-export').click();
    expect((await exportDownload).suggestedFilename()).toBe('instance-performance-30d.json');
    await page.screenshot({
      path: `${evidenceDir}portfolio-instance-${width}.png`,
      fullPage: true,
    });

    // A deposit from outside Markov: the chain shows more stablecoin than the record; reconciliation
    // flags it, the owner explains it, and it stays at the wallet level as a flow, never a return.
    await setFunding(context, address, 50_000_000, '9000000000');
    await page.goto('/portfolio');
    await page.getByTestId('reconcile').click();
    // The stablecoin deposit, and the lamports the reset topped back up: each is an inflow to explain.
    await expect(page.getByTestId('summary-flows')).toContainText(/[12] external flow/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('acknowledge-form').first()).toContainText(
      'Inflow from outside Markov',
    );
    while ((await page.getByTestId('acknowledge-form').count()) > 0) {
      const remaining = await page.getByTestId('acknowledge-form').count();
      const form = page.getByTestId('acknowledge-form').first();
      await form.getByLabel('A deposit I made').check();
      await form.getByLabel('Note (optional)').fill('from my bank');
      await form.getByTestId('acknowledge').click();
      await expect(page.getByTestId('acknowledge-form')).toHaveCount(remaining - 1, {
        timeout: 15_000,
      });
    }
    await expect(page.getByTestId('summary-flows')).toContainText('Nothing pending');
    await expect(page.getByTestId('journal-row').first()).toContainText(
      'explained as a deposit (from my bank)',
    );
    await page.screenshot({ path: `${evidenceDir}portfolio-deposit-${width}.png`, fullPage: true });

    // Another person sees nothing of it: the instance is "not found", never "forbidden".
    const other = await context.browser()?.newContext();
    if (other) {
      const reader = await other.newPage();
      await signIn(reader, subjectFor('pf-bob', testInfo), '/portfolio');
      await reader.goto(instanceUrl);
      await expect(reader.getByText('Not found')).toBeVisible({ timeout: 15_000 });
      await other.close();
    }
  });
});
