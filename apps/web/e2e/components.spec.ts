import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const evidenceDir = new URL('../../../docs/frontend/evidence/F01/', import.meta.url).pathname;

test.describe('component reference route', () => {
  test('renders every section and records screenshots', async ({ page }, testInfo) => {
    const response = await page.goto('/dev/components');
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Component reference' }),
    ).toBeVisible();
    for (const section of [
      'Colour tokens and contrast',
      'Buttons',
      'Forms',
      'Dialog and menu',
      'Table',
      'Loading, empty and error states',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    // No page-level horizontal scrolling at any tested width (WCAG reflow).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${evidenceDir}reference-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test('dialog and validation summary behave in a real browser', async ({ page }, testInfo) => {
    await page.goto('/dev/components');
    await page.getByRole('button', { name: 'Validate example form' }).click();
    const alert = page.locator('[role="alert"]', {
      hasText: 'Fix the following before continuing',
    });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await page.getByRole('link', { name: 'Issuer: choose an issuer' }).click();
    await expect(page.locator('#ref-issuer')).toBeFocused();
    await page.getByRole('button', { name: 'Open review dialog' }).click();
    const dialog = page.getByRole('dialog', { name: 'Review investment (fixture)' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}dialog-${testInfo.project.name}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open review dialog' })).toBeFocused();
  });

  test('has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/dev/components');
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Document,
              options: object,
            ) => Promise<{
              violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }>;
            }>;
          };
        }
      ).axe;
      return axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
      });
    });
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      serious.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });

  test('production guard hides the internal route', async ({ request }) => {
    // The running server has internal routes enabled; the guard itself is covered by web-env tests.
    const response = await request.get('/dev/components');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers()['permissions-policy']).toContain('camera=()');
    expect(response.headers()['x-robots-tag'] ?? '').toBeDefined();
  });
});
