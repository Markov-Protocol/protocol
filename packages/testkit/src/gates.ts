/**
 * Integration tests gate themselves on these variables and skip with a
 * visible reason otherwise. CI sets both; local runs set what they have.
 */
export function testDatabaseUrl(): string | null {
  const value = process.env['MARKOV_TEST_DATABASE_URL'];
  return value !== undefined && value.trim() !== '' ? value : null;
}

export function testTemporalAddress(): string | null {
  const value = process.env['MARKOV_TEST_TEMPORAL_ADDRESS'];
  return value !== undefined && value.trim() !== '' ? value : null;
}
