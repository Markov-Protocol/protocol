import { type MarkovEnv, markovEnvSchema } from '@markov/contracts';
import { z } from 'zod';

/**
 * Web process configuration. Only non-secret, deployment-level switches live
 * here; provider secrets never reach this app. Production guards fail the
 * build (next.config.ts) and the server start (instrumentation.ts).
 */
const boolFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Where `pnpm dev:api` listens by default; only local and test may rely on it. */
export const LOCAL_API_ORIGIN = 'http://127.0.0.1:3000';

export const webEnvSchema = z.object({
  MARKOV_ENV: markovEnvSchema.default('local'),
  /** Internal-only routes such as the component reference. Never in production. */
  MARKOV_WEB_INTERNAL_ROUTES: boolFromEnv.default(false),
  /** Development/test fixture adapters in place of live backend reads. Never in production or read-only mainnet. */
  MARKOV_WEB_FIXTURES: boolFromEnv.default(false),
  /** Public origin of this deployment, used for absolute links and callback validation. */
  NEXT_PUBLIC_APP_ORIGIN: z.url().optional(),
  /** Origin of the Markov API, called only from the server (route handlers, server components). */
  MARKOV_API_ORIGIN: z.url().optional(),
  /**
   * Origin that serves the documentation site (apps/docs) under `/docs/`. When set, the app
   * rewrites `/docs` and `/docs/*` to it so markov.pet/docs is one origin; when unset, `/docs`
   * is not served (never a fallback origin).
   */
  MARKOV_DOCS_ORIGIN: z.url().optional(),
});

export interface WebEnv {
  readonly markovEnv: MarkovEnv;
  readonly internalRoutesEnabled: boolean;
  readonly fixturesEnabled: boolean;
  readonly appOrigin: string | null;
  readonly apiOrigin: string;
  readonly docsOrigin: string | null;
}

export interface WebEnvIssue {
  readonly path: string;
  readonly message: string;
}

export type WebEnvResult =
  | { readonly ok: true; readonly value: WebEnv }
  | { readonly ok: false; readonly issues: readonly WebEnvIssue[] };

function withoutEmpty(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') {
      out[key] = value;
    }
  }
  return out;
}

export function parseWebEnv(env: Readonly<Record<string, string | undefined>>): WebEnvResult {
  const parsed = webEnvSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    };
  }
  const value: WebEnv = {
    markovEnv: parsed.data.MARKOV_ENV,
    internalRoutesEnabled: parsed.data.MARKOV_WEB_INTERNAL_ROUTES,
    fixturesEnabled: parsed.data.MARKOV_WEB_FIXTURES,
    appOrigin: parsed.data.NEXT_PUBLIC_APP_ORIGIN ?? null,
    apiOrigin: parsed.data.MARKOV_API_ORIGIN ?? LOCAL_API_ORIGIN,
    docsOrigin: parsed.data.MARKOV_DOCS_ORIGIN ?? null,
  };
  const issues: WebEnvIssue[] = [];
  const isDev = value.markovEnv === 'local' || value.markovEnv === 'test';
  if (!isDev && parsed.data.MARKOV_API_ORIGIN === undefined) {
    issues.push({
      path: 'MARKOV_API_ORIGIN',
      message: `MARKOV_ENV=${value.markovEnv} requires the API origin to be configured explicitly`,
    });
  }
  if (
    !isDev &&
    parsed.data.MARKOV_API_ORIGIN !== undefined &&
    !value.apiOrigin.startsWith('https://')
  ) {
    issues.push({
      path: 'MARKOV_API_ORIGIN',
      message: 'must be an https origin outside local and test',
    });
  }
  if (value.apiOrigin.replace(/\/+$/, '') !== value.apiOrigin) {
    issues.push({
      path: 'MARKOV_API_ORIGIN',
      message: 'must be an origin without a trailing slash',
    });
  }
  if (value.docsOrigin !== null) {
    const docsUrl = new URL(value.docsOrigin);
    if (docsUrl.origin !== value.docsOrigin) {
      issues.push({
        path: 'MARKOV_DOCS_ORIGIN',
        message: 'must be an origin only: no path, query, fragment or trailing slash',
      });
    }
    if (!isDev && docsUrl.protocol !== 'https:') {
      issues.push({
        path: 'MARKOV_DOCS_ORIGIN',
        message: 'must be an https origin outside local and test',
      });
    }
  }
  if (value.markovEnv === 'production') {
    if (value.internalRoutesEnabled) {
      issues.push({
        path: 'MARKOV_WEB_INTERNAL_ROUTES',
        message: 'internal routes cannot be enabled in production',
      });
    }
    if (value.fixturesEnabled) {
      issues.push({
        path: 'MARKOV_WEB_FIXTURES',
        message: 'fixture adapters cannot be enabled in production',
      });
    }
    if (value.appOrigin === null) {
      issues.push({
        path: 'NEXT_PUBLIC_APP_ORIGIN',
        message: 'production requires the public app origin',
      });
    }
  }
  if (
    (value.markovEnv === 'mainnet-read-only' || value.markovEnv === 'staging') &&
    value.fixturesEnabled
  ) {
    issues.push({
      path: 'MARKOV_WEB_FIXTURES',
      message: `fixture adapters cannot be enabled when MARKOV_ENV=${value.markovEnv}`,
    });
  }
  if (
    value.appOrigin !== null &&
    !value.appOrigin.startsWith('https://') &&
    value.markovEnv !== 'local' &&
    value.markovEnv !== 'test'
  ) {
    issues.push({
      path: 'NEXT_PUBLIC_APP_ORIGIN',
      message: 'must be an https origin outside local and test',
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}

export class WebEnvError extends Error {
  override readonly name = 'WebEnvError';
  readonly issues: readonly WebEnvIssue[];

  constructor(issues: readonly WebEnvIssue[]) {
    super(
      `invalid web configuration:\n${issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')}`,
    );
    this.issues = issues;
  }
}

/** Parse or throw. Used at build time and at server start so a bad combination never serves. */
export function validateWebEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebEnv {
  const result = parseWebEnv(env);
  if (!result.ok) {
    throw new WebEnvError(result.issues);
  }
  return result.value;
}
