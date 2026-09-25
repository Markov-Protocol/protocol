import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F09/', import.meta.url).pathname;
const RPC_BASE = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}`;
const FUNDING_CONTROL = `${RPC_BASE}/fixture/funding`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'review journeys need the real API with the fixture venue, admitted fixture instruments and the fixture wallet (set MARKOV_TEST_DATABASE_URL)',
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

/** Connects and verifies the injected fixture wallet on the wallets page; answers its address. */
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

/** Declares the fixture jurisdiction and acknowledges the fixture terms so policy can allow a plan. */
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

/** Radix select: open the wallet list and pick the verified fixture wallet. */
async function chooseWallet(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Wallet' }).click();
  await page.getByRole('option', { name: /verified/ }).click();
}

test.describe('unified investment and trade review', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 140) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('reviews a staged basket investment end to end: refused while unfunded, quoted with every term, approved by hash, restored on reload, refreshed with a difference view, listed, cancelled; then a policy denial and an atomic single buy', async ({
    page,
    context,
  }, testInfo) => {
    // One journey through the whole review, including a real 30-second quote expiry.
    test.setTimeout(240_000);
    const width = testInfo.project.name.startsWith('phone') ? 320 : 1280;
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('r-alice', testInfo), '/settings/wallets');
    const address = await verifyWallet(page);
    await becomeEligible(page);
    const versionUrl = await freezeBasket(page, 'Reviewed aerospace');

    // From the version page into the review: the target is exactly this version.
    await page.getByTestId('review-investment').click();
    await expect(page).toHaveURL(
      /\/review\/new\?strategyId=[0-9a-f-]{36}&versionId=[0-9a-f-]{36}$/,
    );
    await expect(page.getByTestId('review-target')).toContainText('Reviewed aerospace · version 1');
    await expect(page.getByTestId('review-target')).toContainText('60.00%');
    await chooseWallet(page);
    await expect(page.getByTestId('funding-line')).toContainText('0 USDC', { timeout: 10_000 });
    await page.getByLabel(/^Budget \(USDC\)/).fill('1000');
    await expect(page.getByText(/within your limit of 1.00%/)).toBeVisible();
    await expect(page.getByTestId('slippage-line')).toContainText('0.50% slippage');
    await expect(page.getByTestId('eligibility-line')).toContainText('eligible');
    await page.screenshot({ path: `${evidenceDir}review-start-${width}.png`, fullPage: true });
    await page.getByTestId('create-intent').click();
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
    const reviewUrl = new URL(page.url()).pathname;

    // Unfunded: the API observed the wallet before quoting; the refusal names both assets and a next step.
    const refusal = page.getByTestId('plan-refusal');
    await expect(refusal).toContainText('The wallet cannot fund this plan', { timeout: 15_000 });
    await expect(refusal).toContainText('USDC');
    await expect(refusal).toContainText('lamports');
    await expect(refusal.getByRole('link', { name: 'Add funds' })).toHaveAttribute(
      'href',
      '/settings/wallets',
    );
    await expect(page.getByTestId('intent-state')).toHaveText('Not quoted yet');
    await page.screenshot({ path: `${evidenceDir}review-unfunded-${width}.png`, fullPage: true });

    // Funded on the fixture RPC: a staged plan with every term from the API.
    await setFunding(context, address, 50_000_000, '2500000000');
    await refusal.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('intent-state')).toHaveText('Quoted, awaiting your review');
    await expect(page.getByText('Fixture quotes').first()).toBeVisible();
    await expect(page.getByTestId('leg-row')).toHaveCount(2);
    const legs = page.getByTestId('leg-row');
    // The version fixes the constituent order; each leg names its own transaction.
    await expect(legs.filter({ hasText: 'FXAERO' })).toContainText('600 USDC');
    await expect(legs.filter({ hasText: 'FXAERO' })).toContainText(/Transaction [12] of 2/);
    await expect(legs.filter({ hasText: 'XSFXA' })).toContainText('300 USDC');
    await expect(legs.filter({ hasText: 'XSFXA' })).toContainText(/Transaction [12] of 2/);
    await expect(legs.filter({ hasText: 'Transaction 1 of 2' })).toHaveCount(1);
    await expect(legs.filter({ hasText: 'Transaction 2 of 2' })).toHaveCount(1);
    await expect(page.getByTestId('cash-remainder')).toContainText('100 USDC');
    await expect(page.getByTestId('total-spend')).toContainText('1,000 USDC');
    await expect(page.getByTestId('fees-table')).toContainText('SOL');
    await expect(page.getByTestId('fees-table')).toContainText('beta-0');
    await expect(page.getByTestId('fee-payer')).toContainText(address.slice(0, 4));
    await expect(page.getByTestId('transaction-count')).toContainText(
      '2 signatures across 2 transactions',
    );
    await expect(page.getByTestId('grouping-staged')).toContainText('land one by one');
    await expect(page.getByTestId('policy-evidence')).toContainText('FXAERO: allow');
    await expect(page.getByTestId('policy-evidence')).toContainText('XSFXA: allow');
    await expect(page.getByTestId('valid-until')).toContainText('left');
    await expect(page.getByTestId('funds-observed')).toContainText('2,500 USDC');
    await page.screenshot({ path: `${evidenceDir}review-staged-${width}.png`, fullPage: true });

    // Approval needs the staged acknowledgement and is bound to the hash; keyboard path.
    const approve = page.getByTestId('approve');
    await expect(approve).toHaveText('Approve staged plan');
    await expect(approve).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('staged-checkbox').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('staged-checkbox')).toBeChecked();
    await expect(approve).not.toHaveAttribute('aria-disabled', 'true');
    await approve.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('approved')).toContainText('staged execution acknowledged', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('intent-state')).toHaveText('Approved, awaiting your signature');
    // The execution panel (F10) takes over: the next step is to build transaction 1 of 2; nothing is signed here.
    const build = page.getByTestId('build-cta');
    await expect(build).toHaveText('Build transaction 1 of 2');
    await expect(build).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('sign-cta')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}review-approved-${width}.png`, fullPage: true });

    // Reload: the same approved plan comes back from the API, nothing is rebuilt.
    await page.reload();
    await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('intent-state')).toHaveText('Approved, awaiting your signature');
    await expect(page.getByTestId('build-cta')).toHaveText('Build transaction 1 of 2');

    // Fixture quotes live 30 seconds: the approved terms expire on screen, the execution step
    // disappears and refreshing builds a new plan whose difference is shown before any approval.
    await expect(page.getByTestId('terms-expired')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('valid-until')).toContainText('expired');
    await expect(page.getByTestId('build-cta')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}review-expired-${width}.png`, fullPage: true });
    await page.getByTestId('refresh-terms').first().click();
    await expect(page.getByTestId('plan-difference')).toContainText('Valid until', {
      timeout: 15_000,
    });
    await page.screenshot({ path: `${evidenceDir}review-difference-${width}.png`, fullPage: true });
    await expect(page.getByTestId('intent-state')).toHaveText('Quoted, awaiting your review');
    await expect(page.getByTestId('approve')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('accept-new-terms').click();
    await expect(page.getByTestId('plan-difference')).toHaveCount(0);
    await page.getByTestId('staged-checkbox').check();
    await expect(page.getByTestId('approve')).not.toHaveAttribute('aria-disabled', 'true');

    // The review index lists it; cancelling is explicit and final for this intent.
    await page.goto('/review');
    await expect(page.getByTestId('review-row')).toHaveCount(1);
    await expect(page.getByTestId('review-row')).toContainText('Reviewed aerospace · version 1');
    await expect(page.getByTestId('review-row')).toContainText('Quoted, awaiting your review');
    await page.goto(reviewUrl);
    await page.getByTestId('cancel-review').click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('intent-state')).toHaveText('Cancelled', { timeout: 15_000 });
    await expect(page.getByTestId('approve')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('state-reason')).toContainText('cancelled by the owner');

    // Policy: a budget whose largest leg exceeds the per-order cap is refused with the denial, not reshaped.
    await setFunding(context, address, 50_000_000, '5000000000');
    await page.goto(versionUrl);
    await page.getByTestId('review-investment').click();
    await chooseWallet(page);
    await page.getByLabel(/^Budget \(USDC\)/).fill('3000');
    await expect(
      page.getByText(
        /largest constituent \(60\.00% of the budget\) would exceed your per-order limit of 1,000 USDC/,
      ),
    ).toBeVisible();
    await page.getByTestId('create-intent').click();
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
    const denied = page.getByTestId('plan-refusal');
    await expect(denied).toContainText('Policy refused this plan', { timeout: 15_000 });
    await expect(denied).toContainText('ORDER_CAP_EXCEEDED');
    await expect(
      denied.getByRole('link', { name: 'Start over with another budget' }),
    ).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}review-denied-${width}.png`, fullPage: true });

    // A single buy from the instrument page: one atomic transaction, no staged acknowledgement.
    // Explore opens on Strategies since F12; the stock list is the instruments tab.
    await page.goto('/explore?tab=instruments&q=FXAERO');
    await page
      .getByRole('link', { name: /FXAERO/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/markets\/[0-9a-f-]{36}$/);
    await page.getByTestId('review-buy').click();
    await expect(page).toHaveURL(/\/review\/new\?instrumentId=[0-9a-f-]{36}$/);
    await expect(page.getByTestId('review-target')).toContainText('FXAERO');
    await chooseWallet(page);
    await page.getByLabel(/^Budget \(USDC\)/).fill('100');
    await page.getByTestId('create-intent').click();
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('plan-hash')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Buy FXAERO');
    await expect(page.getByTestId('grouping-atomic')).toContainText('all or nothing');
    await expect(page.getByTestId('transaction-count')).toContainText(
      '1 signature across 1 transaction',
    );
    await expect(page.getByTestId('leg-row')).toHaveCount(1);
    await expect(page.getByTestId('staged-checkbox')).toHaveCount(0);
    await expect(page.getByTestId('approve')).toHaveText('Approve plan');
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('approved')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('build-cta')).toHaveText('Build transaction 1 of 1');
    await page.screenshot({ path: `${evidenceDir}review-single-${width}.png`, fullPage: true });
  });
});
