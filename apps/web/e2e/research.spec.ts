import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const evidenceDir = new URL('../../../docs/frontend/evidence/F06/', import.meta.url).pathname;

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'research journeys need the real API with admitted fixture instruments (set MARKOV_TEST_DATABASE_URL)',
);

let clientCounter = 0;

function subjectFor(
  name: string,
  testInfo: { readonly project: { readonly name: string } },
): string {
  return `did:test:${name}-${testInfo.project.name.startsWith('phone') ? 'p' : 'd'}`;
}

test.describe('instrument evidence and strategy theses', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 80) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('researches an admitted exposure: thesis from the instrument, sources with refusals, a bounded run, publication and a basket draft', async ({
    page,
    browser,
  }, testInfo) => {
    const width = page.viewportSize()?.width;
    // Sign in and open FXAERO by its canonical id.
    await page.goto('/explore?tab=instruments');
    const aeroRow = page.getByTestId('instrument-row').filter({ hasText: 'FXAERO' });
    await aeroRow.getByRole('link', { name: /Fixture Aerospace pre-IPO exposure/ }).click();
    await expect(page).toHaveURL(/\/markets\/[0-9a-f-]{36}$/);
    const instrumentUrl = new URL(page.url()).pathname;
    await page.getByRole('link', { name: 'Sign in to save FXAERO' }).click();
    await page.getByLabel('Subject', { exact: false }).fill(subjectFor('r-alice', testInfo));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${instrumentUrl}$`));

    // Rights and evidence on the overview; route information honestly unavailable.
    await expect(page.getByTestId('rights-evidence')).toContainText(
      'carries no shareholder rights of its own',
    );
    await page.getByRole('tab', { name: 'Liquidity' }).click();
    await expect(page.getByTestId('route-observations')).toContainText(
      'Route information unavailable',
    );
    await expect(page.getByTestId('route-observations').getByText('Not observed')).toHaveCount(5);
    await page.screenshot({ path: `${evidenceDir}market-liquidity-${width}.png`, fullPage: true });

    // Start a thesis with the instrument shortlisted.
    await page.getByRole('tab', { name: 'Research' }).click();
    await expect(page.getByText('Evidence rules for FXAERO')).toBeVisible();
    await page
      .getByLabel('Claim', { exact: false })
      .fill('Tokenised pre-IPO exposure to Fixture Aerospace Inc is worth a small position.');
    await page.getByRole('button', { name: 'Create private thesis' }).click();
    await expect(page).toHaveURL(/\/research\/[0-9a-f-]{36}$/);
    const thesisUrl = new URL(page.url()).pathname;
    await expect(page.getByLabel('Title', { exact: false })).toHaveValue(
      'Fixture Aerospace Inc through PreStocks',
    );
    await expect(page.getByTestId('shortlist-row')).toHaveCount(1);
    await expect(page.getByTestId('shortlist-row').first()).toContainText('FXAERO');
    await page.screenshot({ path: `${evidenceDir}thesis-new-${width}.png`, fullPage: true });

    // A fixture issuer source is fetched and sanitised; a metadata address is refused and recorded.
    await page.getByLabel('Source URL').fill('https://fixture.markov.invalid/issuer/terms');
    await page.getByRole('button', { name: 'Attach and fetch' }).click();
    const fetched = page.getByTestId('source-card').filter({ hasText: 'Fetched' });
    await expect(fetched).toHaveCount(1);
    await expect(fetched.getByTestId('source-excerpt')).toBeVisible();
    await page.getByLabel('Source URL').fill('https://169.254.169.254/latest/meta-data/');
    await page.getByRole('button', { name: 'Attach and fetch' }).click();
    await expect(page.getByTestId('source-card').filter({ hasText: 'Refused' })).toHaveCount(1);
    await expect(page.getByTestId('source-refusal')).toContainText(
      'address literals are not allowed',
    );
    await page.screenshot({ path: `${evidenceDir}thesis-sources-${width}.png`, fullPage: true });

    // An opinion, then a bounded run over the fetched source whose output is adopted as labelled interpretations.
    await page.getByRole('button', { name: 'Add a statement' }).click();
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('I think the launch cadence is underestimated.');
    await page
      .getByLabel('Question')
      .fill('Should I hold Fixture Aerospace Inc rather than Unknown Rocket Co?');
    await page
      .getByRole('checkbox', { name: /fixture\.markov\.invalid|Fixture|terms/i })
      .first()
      .check();
    await page.getByRole('button', { name: 'Start run' }).click();
    const active = page.getByTestId('active-run');
    await expect(active).toContainText('succeeded');
    await expect(active.getByText('Model interpretation, not an issuer fact')).toBeVisible();
    await expect(page.getByTestId('run-provenance')).toContainText('fixture / fixture-research');
    await active
      .getByRole('button', { name: 'Add these to the thesis as model interpretations' })
      .click();
    await expect(page.getByTestId('statement-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Save revision' }).click();
    await expect(page.getByTestId('save-state')).toContainText('Saved as revision 2');
    await page.screenshot({ path: `${evidenceDir}thesis-run-${width}.png`, fullPage: true });

    // Private notes stay private; publishing shows exactly what becomes public.
    await page.getByTestId('private-notes').fill('Budget: 5k. Never publish this.');
    await page.getByRole('button', { name: 'Save revision' }).click();
    await expect(page.getByTestId('save-state')).toContainText('Saved as revision 3');
    await page.getByRole('button', { name: 'Publish…' }).click();
    await expect(page.getByText('What becomes public')).toBeVisible();
    await expect(page.getByText('Not included: your private notes')).toBeVisible();
    await page.getByRole('button', { name: 'Publish this revision' }).click();
    await expect(page.getByText('Public', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}thesis-published-${width}.png`, fullPage: true });

    // Anyone can read the projection; the notes are not in it.
    const anonymous = await browser.newContext({ viewport: page.viewportSize() });
    const reader = await anonymous.newPage();
    await reader.goto(thesisUrl);
    await expect(reader.getByTestId('public-thesis')).toBeVisible();
    await expect(reader.getByText('Published projection')).toBeVisible();
    await expect(reader.getByText('Model interpretation').first()).toBeVisible();
    expect(await reader.textContent('body')).not.toContain('Budget: 5k');
    await reader.screenshot({ path: `${evidenceDir}thesis-public-${width}.png`, fullPage: true });
    await anonymous.close();

    // The saved shortlist becomes a basket draft the backend validated.
    await page.getByRole('button', { name: 'Start a basket draft' }).click();
    await expect(page.getByText('Basket draft saved')).toBeVisible();
    await expect(page.getByTestId('basket-validation')).toContainText('total 100.00%');
    await page.getByRole('link', { name: 'Open in Build' }).click();
    await expect(page).toHaveURL(/\/strategies\/[0-9a-f-]{36}\/edit/);
    await expect(page.getByTestId('draft-summary')).toBeVisible();
    await expect(page.getByTestId('leg-row')).toHaveCount(1);
    await page.screenshot({ path: `${evidenceDir}basket-editor-${width}.png`, fullPage: true });

    // The workspace lists it and the instrument page links back.
    await page.goto('/research');
    await expect(page.getByTestId('thesis-row')).toHaveCount(1);
    await expect(page.getByTestId('thesis-row').first()).toContainText('Public');
    await page.goto(instrumentUrl);
    await page.getByRole('tab', { name: 'Research' }).click();
    await expect(page.getByTestId('instrument-thesis-row')).toHaveCount(1);
  });

  test('a private thesis is not found for another person or anonymously', async ({
    page,
    browser,
  }, testInfo) => {
    await page.goto('/sign-in?next=%2Fresearch');
    await page.getByLabel('Subject', { exact: false }).fill(subjectFor('r-carol', testInfo));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/research$/);
    await page.getByLabel('Title', { exact: false }).fill('Carol private thesis');
    await page.getByLabel('Claim', { exact: false }).fill('A private claim.');
    await page.getByRole('button', { name: 'Create private thesis' }).click();
    await expect(page).toHaveURL(/\/research\/[0-9a-f-]{36}$/);
    const thesisUrl = new URL(page.url()).pathname;

    const other = await browser.newContext({ viewport: page.viewportSize() });
    const stranger = await other.newPage();
    await stranger.goto(thesisUrl);
    await expect(stranger.getByText('No thesis with that id, or it is private')).toBeVisible();
    await stranger.goto('/sign-in?next=%2Fresearch');
    await stranger.getByLabel('Subject', { exact: false }).fill(subjectFor('r-dave', testInfo));
    await stranger.getByRole('button', { name: 'Sign in', exact: true }).click();
    await stranger.goto(thesisUrl);
    await expect(stranger.getByText('No thesis with that id, or it is private')).toBeVisible();
    await other.close();
    await page.goto('/research/not-a-uuid');
    await expect(page.getByText(/not found|could not be found/i).first()).toBeVisible();
  });
});
