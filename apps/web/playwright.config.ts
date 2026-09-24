import { defineConfig, devices } from '@playwright/test';

/**
 * Browser evidence for visual and journey checks. Uses the repository's
 * pinned Playwright version (its bundled Chromium build matches the
 * pre-installed browser in the build environment).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../.markov-tmp/playwright',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['MARKOV_WEB_BASE_URL'] ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 } },
    },
  ],
  ...(process.env['MARKOV_WEB_BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
          url: 'http://127.0.0.1:3100/',
          reuseExistingServer: true,
          timeout: 60_000,
          env: { MARKOV_ENV: 'test', MARKOV_WEB_INTERNAL_ROUTES: 'true' },
        },
      }),
});
