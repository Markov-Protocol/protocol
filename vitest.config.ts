import { defineConfig } from 'vitest/config';

// Unit tests run everywhere. Integration tests that need PostgreSQL or a
// Temporal dev server gate themselves on MARKOV_TEST_DATABASE_URL and
// MARKOV_TEST_TEMPORAL_ADDRESS and report themselves as skipped otherwise.
export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'tooling/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: '.markov-tmp/junit.xml' },
    env: {
      MARKOV_ENV: 'test',
    },
  },
});
