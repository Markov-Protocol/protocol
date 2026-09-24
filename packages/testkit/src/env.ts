/**
 * A valid `test` mode environment for a local devnet-bound process. Tests
 * override individual keys to exercise one rule at a time.
 */
export function baseTestEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string | undefined> = {
    MARKOV_ENV: 'test',
    SERVICE_VERSION: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL:
      process.env['MARKOV_TEST_DATABASE_URL'] ??
      'postgres://markov:markov@127.0.0.1:5432/markov_test',
    SOLANA_CLUSTER: 'devnet',
    SOLANA_RPC_PRIMARY_URL: 'http://127.0.0.1:1',
    SOLANA_RPC_TIMEOUT_MS: '1000',
    TEMPORAL_ADDRESS: process.env['MARKOV_TEST_TEMPORAL_ADDRESS'] ?? '127.0.0.1:7233',
    ...overrides,
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
