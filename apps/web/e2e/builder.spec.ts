import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F07/', import.meta.url).pathname;
const RPC_CONTROL = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}/fixture/funding`;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'builder journeys need the real API with admitted fixture instruments (set MARKOV_TEST_DATABASE_URL)',
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

/** Waits until the last edit is on the server: the status shows Saved with no pending, offline or conflicting edits. */
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

test.describe('complete stock basket builder', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 100) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('builds, validates, resumes and reconciles a PreStocks/xStocks recipe against the real backend', async ({
    page,
    context,
  }, testInfo) => {
    const width = page.viewportSize()?.width;
    await signIn(page, subjectFor('b-alice', testInfo), '/strategies/new');
    await page.getByLabel('Title', { exact: false }).fill('Aerospace tilt');
    await page
      .getByLabel('Thesis in your words', { exact: false })
      .fill('Launch cadence is underestimated.');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit\?stage=assemble$/);
    const editUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('no-legs')).toBeVisible();
    await expect(page.getByTestId('validation-summary')).toContainText('No constituent');

    // Assemble: exact weights, cash, the backend's verdict after every save.
    await addConstituent(page, 'FXAERO');
    await addConstituent(page, 'XSFXA');
    await weightOf(page, 'FXAERO').fill('60');
    await weightOf(page, 'XSFXA').fill('30');
    await page.getByLabel('Cash held as stablecoin', { exact: false }).fill('10');
    await expect(page.getByTestId('summary-total')).toContainText('100.00%');
    await awaitSaved(page);
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe');
    await page.screenshot({ path: `${evidenceDir}builder-assemble-${width}.png`, fullPage: true });

    await weightOf(page, 'FXAERO').fill('59.99');
    await expect(page.getByTestId('summary-remaining')).toContainText('0.01% unallocated');
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: 1 rule broken', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('validation-summary')).toContainText('Total is not 100.00%');
    await page.screenshot({ path: `${evidenceDir}builder-invalid-${width}.png`, fullPage: true });
    await weightOf(page, 'FXAERO').fill('60.001');
    await expect(
      page.getByText('At most two decimals; weights are exact basis points.'),
    ).toBeVisible();
    await weightOf(page, 'FXAERO').fill('60');
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Increase XSFXA by 1%' }).click();
    await expect(weightOf(page, 'XSFXA')).toHaveValue('31.00');
    await page.getByRole('button', { name: 'Decrease XSFXA by 1%' }).click();
    await awaitSaved(page);
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
      timeout: 10_000,
    });

    // Resume: a reload shows exactly what the backend holds.
    await page.reload();
    await expect(weightOf(page, 'FXAERO')).toHaveValue('60.00');
    await expect(weightOf(page, 'XSFXA')).toHaveValue('30.00');
    await expect(page.getByTestId('summary-cash')).toContainText('10.00%');
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe');

    // Two tabs: the other tab saves first; this one is told, compares and keeps its edits.
    const other = await context.newPage();
    await other.goto(editUrl);
    await expect(weightOf(other, 'FXAERO')).toHaveValue('60.00');
    await weightOf(other, 'FXAERO').fill('55');
    await awaitSaved(other);
    await weightOf(page, 'XSFXA').fill('35');
    const conflict = page.getByTestId('conflict-panel');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    await expect(conflict).toContainText('FXAERO: 55.00% on the server, 60.00% here');
    await expect(conflict).toContainText('XSFXA: 30.00% on the server, 35.00% here');
    await page.screenshot({ path: `${evidenceDir}builder-conflict-${width}.png`, fullPage: true });
    await conflict.getByRole('button', { name: /Keep my edits/ }).click();
    await awaitSaved(page);
    await expect(page.getByTestId('conflict-panel')).toHaveCount(0);
    await other.reload();
    await expect(weightOf(other, 'XSFXA')).toHaveValue('35.00');
    await expect(weightOf(other, 'FXAERO')).toHaveValue('60.00');
    await other.close();
    await weightOf(page, 'XSFXA').fill('30');
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
      timeout: 10_000,
    });

    // Set Rules: title and maintenance suggestion; the person's effective limits are read from the policy.
    await page.getByRole('button', { name: /^03 Set Rules$/ }).click();
    await page.getByLabel('Title', { exact: false }).fill('Aerospace tilt, rules set');
    await expect(page.getByTestId('effective-limits')).toContainText('USDC');
    await expect(page.getByText('Approval preference', { exact: true })).toBeVisible();
    await awaitSaved(page);
    await page.screenshot({ path: `${evidenceDir}builder-rules-${width}.png`, fullPage: true });

    // Activate without a wallet: honest, with a way to verify one; the draft is untouched.
    await page.getByRole('button', { name: /^04 Activate$/ }).click();
    await expect(page.getByText('No verified wallet yet')).toBeVisible();
    await page.getByLabel(/^Budget \(/).fill('100');
    await expect(page.getByTestId('estimate-row')).toHaveCount(2);
    await expect(page.getByTestId('cash-estimate')).toContainText('10');
    await expect(page.getByRole('button', { name: 'Review investment' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.screenshot({ path: `${evidenceDir}builder-activate-${width}.png`, fullPage: true });

    // The Build page resumes it.
    await page.goto('/strategies/new');
    const row = page
      .getByTestId('basket-draft-row')
      .filter({ hasText: 'Aerospace tilt, rules set' });
    await expect(row).toHaveCount(1);
    await row.getByRole('link', { name: 'Resume' }).click();
    await expect(page).toHaveURL(new RegExp(`${editUrl}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Aerospace tilt, rules set',
    );
  });

  test('a verified wallet joins the plan without touching the recipe', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('b-carol', testInfo), '/settings/wallets');
    await page.getByRole('button', { name: 'Choose Fixture Wallet' }).click();
    const address = (await page.getByTestId('connected-address').textContent()) ?? '';
    await page.getByTestId('verify-ownership').click();
    await expect(page.getByText('Wallet verified')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await setFunding(context, address, 50_000_000, '1000000000');

    await page.goto('/strategies/new');
    await page.getByLabel('Title', { exact: false }).fill('Funded basket');
    await page.getByLabel('Thesis in your words', { exact: false }).fill('A funded test.');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit\?stage=assemble$/);
    await addConstituent(page, 'FXAERO');
    await page.getByRole('button', { name: 'Set equal weights' }).click();
    await expect(page.getByTestId('summary-total')).toContainText('100.00%');
    await expect(page.getByTestId('validation-summary')).toContainText('Backend: valid recipe', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /^04 Activate$/ }).click();
    await page.getByRole('combobox', { name: 'Wallet' }).click();
    await page
      .getByRole('option', { name: /verified/ })
      .first()
      .click();
    await expect(page.getByTestId('funding-line')).toContainText(/1,000 USDC|1000 USDC/, {
      timeout: 10_000,
    });
    await page.getByLabel(/^Budget \(/).fill('2000');
    await expect(page.getByTestId('readiness')).toContainText('Above your per-order limit');
    await page.getByLabel(/^Budget \(/).fill('100');
    await expect(page.getByTestId('estimate-row').first()).toContainText('100 USDC');
    await expect(page.getByTestId('readiness')).toContainText(
      'Within the limits that apply to you.',
    );
    await expect(page.getByRole('button', { name: 'Review investment' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

async function setFunding(
  context: BrowserContext,
  address: string,
  lamports: number,
  stablecoinRaw: string,
): Promise<void> {
  const response = await context.request.post(RPC_CONTROL, {
    data: { address, lamports, stablecoinRaw },
  });
  expect(response.ok()).toBe(true);
}
