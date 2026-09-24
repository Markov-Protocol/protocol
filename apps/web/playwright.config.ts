import { defineConfig, devices } from '@playwright/test';

/**
 * Browser evidence for visual and journey checks. Uses the repository's
 * pinned Playwright version (its bundled Chromium build matches the
 * pre-installed browser in the build environment).
 */
/** Port of the API the auth journeys run against; `scripts/dev/web-e2e-api.sh` listens here. */
export const E2E_API_PORT = 3900;
export const E2E_API_ORIGIN = `http://127.0.0.1:${E2E_API_PORT}`;

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
        webServer: [
          // The real API with the nonproduction test issuer, when a test database is available.
          ...(process.env['MARKOV_TEST_DATABASE_URL']
            ? [
                {
                  command: 'bash ../../scripts/dev/web-e2e-api.sh',
                  url: `${E2E_API_ORIGIN}/healthz`,
                  reuseExistingServer: false,
                  timeout: 90_000,
                  env: { MARKOV_E2E_API_PORT: String(E2E_API_PORT) },
                },
              ]
            : []),
          {
            command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
            url: 'http://127.0.0.1:3100/',
            reuseExistingServer: true,
            timeout: 60_000,
            env: {
              MARKOV_ENV: 'test',
              MARKOV_WEB_INTERNAL_ROUTES: 'true',
              MARKOV_API_ORIGIN: E2E_API_ORIGIN,
            },
          },
        ],
      }),
});
