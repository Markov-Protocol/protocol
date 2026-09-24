import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbClientOptions {
  readonly url: string;
  readonly ssl: 'disable' | 'require';
  readonly poolMax: number;
  readonly statementTimeoutMs: number;
  readonly applicationName: string;
}

export interface PingResult {
  readonly ok: boolean;
  readonly durationMs: number;
  /** Secret-free failure classification; never a connection string. */
  readonly detail: string;
}

export interface DbClient {
  readonly db: Database;
  readonly pool: pg.Pool;
  ping(timeoutMs?: number): Promise<PingResult>;
  close(): Promise<void>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const prefix = typeof code === 'string' ? `${code}: ` : `${error.name}: `;
    return `${prefix}${error.message}`.slice(0, 200);
  }
  return 'unknown error';
}

export function createDbClient(options: DbClientOptions): DbClient {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax,
    ssl: options.ssl === 'require' ? { rejectUnauthorized: true } : false,
    application_name: options.applicationName,
    statement_timeout: options.statementTimeoutMs,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
  });
  // A failing idle client must not crash the process; the next query surfaces the error.
  pool.on('error', () => undefined);
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async ping(timeoutMs = 2_000) {
      const started = Date.now();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ping exceeded ${timeoutMs}ms`)), timeoutMs);
      });
      try {
        await Promise.race([pool.query('SELECT 1'), timeout]);
        return { ok: true, durationMs: Date.now() - started, detail: 'SELECT 1 succeeded' };
      } catch (error) {
        return { ok: false, durationMs: Date.now() - started, detail: describeError(error) };
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
