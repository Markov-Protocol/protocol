import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The built site served at /docs/ the way markov.pet serves it: the Mark I
 * frame (cream perimeter, dark screen by default, light screen on request),
 * navigation, the generated references, the edit links and the search, at
 * desktop and phone widths, with screenshots as evidence.
 */
const CREAM = 'rgb(230, 220, 209)';
const SCREEN = 'rgb(7, 9, 9)';
const FRAME_LIGHT = 'rgb(243, 236, 228)';
const evidenceDir = join(process.cwd(), '..', '..', 'docs', 'frontend', 'evidence', 'D01');
mkdirSync(evidenceDir, { recursive: true });

test.describe('markov.pet/docs', () => {
  test('home shows the Mark I frame, the four steps and the entry points', async ({
    page,
  }, info) => {
    const width = info.project.use.viewport?.width ?? 0;
    await page.goto('/docs/');
    await expect(page).toHaveTitle(/Markov documentation/);
    await expect(page.locator('svg.markov-eyes').first()).toBeVisible();
    for (const label of ['Research', 'Assemble', 'Set Rules', 'Activate']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Start here' })).toHaveAttribute(
      'href',
      '/docs/intro',
    );
    // The frame: the navbar is cream in every mode; the screen is dark by default.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.navbar')).toHaveCSS('background-color', CREAM);
    await expect(page.locator('.main-wrapper')).toHaveCSS('background-color', SCREEN);
    await page.screenshot({
      path: join(evidenceDir, `docs-home-dark-${width}.png`),
      fullPage: true,
    });
    // The toggle switches to the light screen; the perimeter stays cream. On a phone the
    // toggle lives in the navigation drawer.
    if (width < 997) {
      await page.getByRole('button', { name: /toggle navigation bar/i }).click();
      await page
        .locator('.navbar-sidebar')
        .getByRole('button', { name: /switch between dark and light mode/i })
        .click();
      await page.getByRole('button', { name: /close navigation bar/i }).click();
    } else {
      await page.getByRole('button', { name: /switch between dark and light mode/i }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.navbar')).toHaveCSS('background-color', CREAM);
    await expect(page.locator('.main-wrapper')).toHaveCSS('background-color', FRAME_LIGHT);
    await page.screenshot({
      path: join(evidenceDir, `docs-home-light-${width}.png`),
      fullPage: true,
    });
  });

  test('the sidebar, the generated references and the methodology are reachable', async ({
    page,
  }, info) => {
    const width = info.project.use.viewport?.width ?? 0;
    await page.goto('/docs/intro');
    await expect(page.getByRole('heading', { level: 1, name: 'What Markov is' })).toBeVisible();
    if (width < 997) {
      // Phone: the navbar collapses into the hamburger; the drawer carries the items.
      await page.getByRole('button', { name: /toggle navigation bar/i }).click();
      const drawer = page.locator('.navbar-sidebar');
      await expect(drawer).toBeVisible();
      // On a docs page the drawer opens on the docs sidebar; the navbar items are one level up.
      await drawer.getByRole('button', { name: /back to main menu/i }).click();
      await drawer
        .locator('.navbar-sidebar__item.menu a.menu__link[href="/docs/api"]')
        .first()
        .click();
    } else {
      // Desktop: the docs sidebar with its categories and the navbar items are both visible.
      await expect(
        page.locator('.theme-doc-sidebar-menu').getByText('Getting started'),
      ).toBeVisible();
      await page.locator('.navbar__items').getByRole('link', { name: 'API', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/docs\/api$/);
    await expect(page.getByRole('heading', { level: 1, name: 'API reference' })).toBeVisible();
    await expect(page.getByText('/v1/rankings/model').first()).toBeVisible();
    await page.screenshot({ path: join(evidenceDir, `docs-api-${width}.png`), fullPage: false });

    await page.goto('/docs/api/analytics');
    await expect(page.getByRole('heading', { name: /GET \/v1\/rankings\/model/ })).toBeVisible();
    await expect(page.getByText('minHistoryDays').first()).toBeVisible();

    await page.goto('/docs/cli/performance');
    await expect(page.getByRole('heading', { name: /markov performance rankings/ })).toBeVisible();
    await page.screenshot({ path: join(evidenceDir, `docs-cli-${width}.png`), fullPage: false });

    await page.goto('/docs/reference/markov/accounting-methodology');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accounting methodology' }),
    ).toBeVisible();
    await expect(page.getByText('Valuation and performance (B13)').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Edit this page/i })).toHaveAttribute(
      'href',
      /github\.com\/Markov-Protocol\/protocol\/edit\/main\/docs\/markov\/accounting-methodology\.md$/,
    );
    await page.screenshot({
      path: join(evidenceDir, `docs-methodology-${width}.png`),
      fullPage: false,
    });

    await page.goto('/docs/reference/sessions/b13');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('B13');
    await expect(page.getByRole('link', { name: /Edit this page/i })).toHaveAttribute(
      'href',
      /github\.com\/Markov-Protocol\/protocol\/edit\/main\/docs\/sessions\/B13\.md$/,
    );
  });

  test('search finds pages by a word in them', async ({ page }) => {
    await page.goto('/docs/intro');
    const input = page.locator('input.navbar__search-input').first();
    await input.click();
    await input.fill('rankings');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await expect(listbox).toContainText(/rankings/i, { timeout: 15_000 });
  });
});
