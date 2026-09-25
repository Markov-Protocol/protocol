import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects: backend/tooling tests run in Node; frontend component and
// formatter tests run in jsdom. Integration tests that need PostgreSQL or a
// Temporal dev server gate themselves on MARKOV_TEST_DATABASE_URL and
// MARKOV_TEST_TEMPORAL_ADDRESS and report themselves as skipped otherwise.
export default defineConfig({
  test: {
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: '.markov-tmp/junit.xml' },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'apps/api/test/**/*.test.ts',
            'apps/worker/test/**/*.test.ts',
            'apps/cli/test/**/*.test.ts',
            'apps/indexer/test/**/*.test.ts',
            'apps/web/test/server/**/*.test.ts',
            'packages/amounts/test/**/*.test.ts',
            'packages/api-client/test/**/*.test.ts',
            'packages/auth/test/**/*.test.ts',
            'packages/catalog/test/**/*.test.ts',
            'packages/config/test/**/*.test.ts',
            'packages/contracts/test/**/*.test.ts',
            'packages/db/test/**/*.test.ts',
            'packages/issuer-prestocks/test/**/*.test.ts',
            'packages/issuer-xstocks/test/**/*.test.ts',
            'packages/observability/test/**/*.test.ts',
            'packages/policy/test/**/*.test.ts',
            'packages/registry/test/**/*.test.ts',
            'packages/solana-codec/test/**/*.test.ts',
            'packages/planning/test/**/*.test.ts',
            'packages/venue-jupiter/test/**/*.test.ts',
            'packages/execution/test/**/*.test.ts',
            'packages/accounting/test/**/*.test.ts',
            'packages/research/test/**/*.test.ts',
            'packages/strategy/test/**/*.test.ts',
            'packages/solana-rpc/test/**/*.test.ts',
            'packages/testkit/test/**/*.test.ts',
            'tooling/**/*.test.mjs',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
          pool: 'forks',
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: { MARKOV_ENV: 'test' },
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: [
            'packages/ui/test/**/*.test.{ts,tsx}',
            'packages/markov-shell/test/**/*.test.{ts,tsx}',
            'packages/formatters/test/**/*.test.ts',
            'apps/web/test/**/*.test.{ts,tsx}',
          ],
          exclude: ['**/node_modules/**', '**/.next/**', 'apps/web/test/server/**'],
          setupFiles: ['./packages/ui/test/setup.ts'],
          css: false,
          testTimeout: 30_000,
          env: { MARKOV_ENV: 'test' },
        },
      },
    ],
  },
});
