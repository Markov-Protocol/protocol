import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const evidenceDir = new URL('../../../docs/frontend/evidence/F05/', import.meta.url).pathname;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'discovery journeys need the real API with admitted fixture instruments (set MARKOV_TEST_DATABASE_URL)',
);

let clientCounter = 0;

function subjectFor(
  name: string,
  testInfo: { readonly project: { readonly name: string } },
): string {
  return `did:test:${name}-${testInfo.project.name.startsWith('phone') ? 'p' : 'd'}`;
}

test.describe('issuer-aware discovery and watchlists', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 60) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('finds an admitted instrument by issuer, opens its exact page, saves it and removes it', async ({
    page,
  }, testInfo) => {
    const width = page.viewportSize()?.width;
    await page.goto('/explore');
    await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
    const rows = page.getByTestId('instrument-row');
    await expect(rows.filter({ hasText: 'FXAERO' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'XSFXA' })).toHaveCount(1);
    // Unadmitted fixtures never reach the public list.
    await expect(rows.filter({ hasText: 'FXGRID' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'XSFXB' })).toHaveCount(0);
    const aeroRow = rows.filter({ hasText: 'FXAERO' });
    await expect(aeroRow.getByText('Fixture Aerospace Inc')).toBeVisible();
    await expect(aeroRow.getByText('PreStocks', { exact: true })).toBeVisible();
    await expect(aeroRow.getByText('Solana devnet')).toBeVisible();
    await expect(aeroRow.getByText('18.25 USD')).toBeVisible();
    await expect(aeroRow.getByRole('link', { name: 'Sign in to save FXAERO' })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}explore-anonymous-${width}.png`, fullPage: true });

    // Search narrows by company name and lands in the URL.
    await page.getByRole('searchbox', { name: 'Search' }).fill('Aerospace');
    await expect(page).toHaveURL(/q=Aerospace/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('FXAERO');
    await page.screenshot({ path: `${evidenceDir}explore-search-${width}.png`, fullPage: true });

    // The xStocks filter shows only that issuer's instruments.
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByRole('button', { name: 'xStocks', exact: true }).click();
    await expect(page).toHaveURL(/issuer=xstocks/);
    await expect(rows.filter({ hasText: 'XSFXA' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'FXAERO' })).toHaveCount(0);
    await expect(rows.first().getByText('Listed stock · FXA on FIXTURE')).toBeVisible();
    await page.getByRole('button', { name: 'All issuers' }).click();
    await expect(page).not.toHaveURL(/issuer=/);

    // The detail page is reached by the canonical id, never a ticker.
    await rows
      .filter({ hasText: 'FXAERO' })
      .getByRole('link', { name: /Fixture Aerospace pre-IPO exposure/ })
      .click();
    await expect(page).toHaveURL(
      /\/markets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const instrumentUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Fixture Aerospace pre-IPO exposure',
    );
    await expect(page.getByText('Admitted').first()).toBeVisible();
    await expect(page.getByTestId('price-history')).toContainText('History unavailable');
    await expect(page.getByText('What you can do now')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}market-overview-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Instrument' }).click();
    await expect(page.getByTestId('mint-address')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View on Solana Explorer' })).toHaveAttribute(
      'href',
      /cluster=devnet/,
    );
    await expect(page.getByText('verified', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}market-instrument-${width}.png`, fullPage: true });

    // Saving needs an account; the sign-in link returns to this exact page.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.getByRole('link', { name: 'Sign in to save FXAERO' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/sign-in\\?next=${encodeURIComponent(instrumentUrl).replace(/%/g, '%')}`),
    );
    await page.getByLabel('Subject', { exact: false }).fill(subjectFor('m-alice', testInfo));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${instrumentUrl}$`));
    await page.getByRole('button', { name: 'Save FXAERO to your watchlist' }).click();
    await expect(
      page.getByRole('button', { name: 'Remove FXAERO from your watchlist' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Evaluated for you/)).toBeVisible();

    await page.goto('/explore?tab=watchlist');
    const saved = page.getByTestId('watchlist-row');
    await expect(saved).toHaveCount(1);
    await expect(saved.first()).toContainText('FXAERO');
    await expect(saved.first().getByText('Admitted')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}watchlist-${width}.png`, fullPage: true });
    await page.reload();
    await expect(page.getByTestId('watchlist-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove FXAERO from your watchlist' }).click();
    await expect(page.getByText('Nothing saved yet')).toBeVisible();
  });

  test('a bogus id and an unadmitted instrument answer honestly', async ({ page }) => {
    await page.goto('/markets/not-a-uuid');
    await expect(
      page.getByText(/not found|could not be found|This page could not be found/i).first(),
    ).toBeVisible();
    await page.goto('/markets/99999999-9999-4999-8999-999999999999');
    await expect(page.getByText('No admitted instrument with that id')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Explore' })).toBeVisible();
  });
});
