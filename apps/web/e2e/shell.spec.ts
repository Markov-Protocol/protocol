import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const evidenceDir = new URL('../../../docs/frontend/evidence/F02/', import.meta.url).pathname;
const widths = [320, 390, 768, 1280, 1440] as const;

test.describe('Mark I shell', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  for (const width of widths) {
    test(`fills the viewport and navigates at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 640 ? 720 : 860 });
      await page.goto('/');
      const frame = page.locator('.markov-frame');
      const box = await frame.boundingBox();
      expect(box?.x).toBe(0);
      expect(box?.y).toBe(0);
      expect(Math.round(box?.width ?? 0)).toBe(width);
      expect(Math.round(box?.height ?? 0)).toBe(width < 640 ? 720 : 860);
      expect(await frame.getAttribute('data-mode')).toBe('companion');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(
        page.getByRole('heading', { level: 1, name: 'An idea for your next strategy?' }),
      ).toBeVisible();
      await page.screenshot({ path: `${evidenceDir}home-${width}.png` });

      await page
        .getByRole('navigation', { name: 'Primary' })
        .filter({ visible: true })
        .getByRole('link', { name: 'Explore' })
        .click();
      await expect(page).toHaveURL(/\/explore$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
      expect(await frame.getAttribute('data-mode')).toBe('workspace');
      await expect(
        page
          .getByRole('navigation', { name: 'Primary' })
          .filter({ visible: true })
          .getByRole('link', { name: 'Explore' }),
      ).toHaveAttribute('aria-current', 'page');
      await page.screenshot({ path: `${evidenceDir}explore-${width}.png` });
    });
  }

  test('long content scrolls inside the screen, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dev/components');
    const main = page.locator('#main-content');
    await main.evaluate((element) => {
      element.scrollTop = 2000;
    });
    expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
    const box = await page.locator('.markov-frame').boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(800);
  });

  test('deep links open directly in workspace mode without an intro', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
    expect(await page.locator('.markov-frame').getAttribute('data-mode')).toBe('workspace');
    await expect(page.getByText('Portfolio is not available in this build')).toBeVisible();
  });

  test('More menu reaches every secondary section and the focus preference persists', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'More' }).filter({ visible: true }).click();
    await page.getByRole('menuitem', { name: 'Rankings' }).click();
    await expect(page).toHaveURL(/\/rankings$/);
    await page.getByRole('button', { name: 'More' }).filter({ visible: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Focus mode' }).click();
    await expect(page.locator('.markov-frame')).toHaveAttribute('data-focus', 'true');
    await page.reload();
    await expect(page.locator('.markov-frame')).toHaveAttribute('data-focus', 'true');
    await page.screenshot({ path: `${evidenceDir}focus-1280.png` });
    await page.getByRole('button', { name: 'More' }).filter({ visible: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Leave focus mode' }).click();
    await expect(page.locator('.markov-frame')).toHaveAttribute('data-focus', 'false');
  });

  test('keyboard focus lands on content through the skip link', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/explore');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('records a lab performance baseline for the shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'load' });
    const metrics = await page.evaluate(async () => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const lcp = await new Promise<number | null>((resolve) => {
        let latest: number | null = null;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            latest = entry.startTime;
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(latest);
        }, 500);
      });
      return {
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
        largestContentfulPaintMs: lcp === null ? null : Math.round(lcp),
        transferBytes: Math.round(
          performance
            .getEntriesByType('resource')
            .reduce(
              (total, entry) => total + ((entry as PerformanceResourceTiming).transferSize || 0),
              0,
            ),
        ),
      };
    });
    writeFileSync(
      `${evidenceDir}perf-baseline.json`,
      `${JSON.stringify({ recordedAt: new Date().toISOString(), viewport: '390x844', note: 'Lab measurement on the build container over loopback; not field data.', ...metrics }, null, 2)}\n`,
    );
    expect(metrics.domContentLoadedMs).not.toBeNull();
  });
});
