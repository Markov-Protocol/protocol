import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks of the built site served the way markov.pet/docs serves
 * it (baseUrl /docs/). `pnpm --filter @markov/docs build` must have run.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../.markov-tmp/playwright-docs',
  fullyParallel: true,
  retries: 0,
  // A stray test.only must fail CI instead of silently narrowing the evidence.
  forbidOnly: Boolean(process.env['CI']),
  // CI keeps a JUnit report and the HTML report (with traces of failed tests) as run evidence.
  reporter: process.env['CI']
    ? [
        ['list'],
        ['junit', { outputFile: '../../.markov-tmp/reports/docs-e2e.junit.xml' }],
        ['html', { outputFolder: '../../.markov-tmp/reports/docs-e2e-html', open: 'never' }],
      ]
    : [['list']],
  use: {
    baseURL: process.env['MARKOV_DOCS_BASE_URL'] ?? 'http://127.0.0.1:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
  ...(process.env['MARKOV_DOCS_BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'pnpm exec docusaurus serve --port 3200 --host 127.0.0.1 --no-open',
          url: 'http://127.0.0.1:3200/docs/',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
