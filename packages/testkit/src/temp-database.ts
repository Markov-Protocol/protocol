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
    await dropDatabase(adminUrl, name);
  }
}

const DROP_ATTEMPTS = 5;
const DROP_RETRY_MS = 250;

/**
 * A forced drop terminates the other sessions of the database. When a
 * session that this role may not signal (a superuser maintenance
 * backend) is attached at that instant, PostgreSQL refuses the drop with
 * 42501 or 55006; the database is not gone, so the drop is retried a few
 * times before the error is surfaced.
 */
async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const cleanup = new pg.Client({ connectionString: adminUrl });
  await cleanup.connect();
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const transient = code === '42501' || code === '55006';
        if (!transient || attempt >= DROP_ATTEMPTS) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, DROP_RETRY_MS * attempt));
      }
    }
  } finally {
    await cleanup.end();
  }
}
