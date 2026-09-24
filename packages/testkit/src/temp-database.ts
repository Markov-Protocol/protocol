import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * Create a throwaway database next to the admin connection's database, run
 * `fn` against it, and drop it afterwards. Requires a role with CREATEDB.
 * Each caller gets an isolated schema, so integration tests can run in
 * parallel without interfering.
 */
export async function withTemporaryDatabase<T>(
  adminUrl: string,
  fn: (databaseUrl: string) => Promise<T>,
): Promise<T> {
  const name = `markov_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  try {
    return await fn(url.toString());
  } finally {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
}
