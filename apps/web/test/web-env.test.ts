import { describe, expect, it } from 'vitest';
import { parseWebEnv, validateWebEnv, WebEnvError } from '../src/config/web-env';

function issues(env: Record<string, string>): string[] {
  const result = parseWebEnv(env);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe('web environment guards', () => {
  it('defaults to local with every development switch off', () => {
    const result = parseWebEnv({});
    expect(result).toEqual({
      ok: true,
      value: {
        markovEnv: 'local',
        internalRoutesEnabled: false,
        fixturesEnabled: false,
        appOrigin: null,
        apiOrigin: 'http://127.0.0.1:3000',
        docsOrigin: null,
      },
    });
  });

  it('accepts a documentation origin only as a bare origin, https outside local and test', () => {
    expect(issues({ MARKOV_ENV: 'local', MARKOV_DOCS_ORIGIN: 'http://127.0.0.1:3200' })).toEqual(
      [],
    );
    const local = parseWebEnv({ MARKOV_DOCS_ORIGIN: 'http://127.0.0.1:3200' });
    expect(local.ok && local.value.docsOrigin).toBe('http://127.0.0.1:3200');
    expect(issues({ MARKOV_ENV: 'local', MARKOV_DOCS_ORIGIN: 'http://127.0.0.1:3200/' })).toEqual([
      'MARKOV_DOCS_ORIGIN',
    ]);
    expect(
      issues({ MARKOV_ENV: 'local', MARKOV_DOCS_ORIGIN: 'http://127.0.0.1:3200/docs' }),
    ).toEqual(['MARKOV_DOCS_ORIGIN']);
    expect(issues({ MARKOV_ENV: 'local', MARKOV_DOCS_ORIGIN: 'not a url' })).toEqual([
      'MARKOV_DOCS_ORIGIN',
    ]);
    expect(
      issues({
        MARKOV_ENV: 'production',
        NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
        MARKOV_API_ORIGIN: 'https://api.markov.pet',
        MARKOV_DOCS_ORIGIN: 'http://docs.markov.pet',
      }),
    ).toEqual(['MARKOV_DOCS_ORIGIN']);
    expect(
      issues({
        MARKOV_ENV: 'production',
        NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
        MARKOV_API_ORIGIN: 'https://api.markov.pet',
        MARKOV_DOCS_ORIGIN: 'https://docs.markov.pet',
      }),
    ).toEqual([]);
    // Unset means /docs is not served; there is no fallback origin.
    const unset = parseWebEnv({
      MARKOV_ENV: 'production',
      NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
      MARKOV_API_ORIGIN: 'https://api.markov.pet',
    });
    expect(unset.ok && unset.value.docsOrigin).toBe(null);
  });

  it('allows internal routes and fixtures in local and test', () => {
    expect(
      issues({
        MARKOV_ENV: 'local',
        MARKOV_WEB_INTERNAL_ROUTES: 'true',
        MARKOV_WEB_FIXTURES: 'true',
      }),
    ).toEqual([]);
    expect(
      issues({ MARKOV_ENV: 'test', MARKOV_WEB_INTERNAL_ROUTES: '1', MARKOV_WEB_FIXTURES: '1' }),
    ).toEqual([]);
  });

  it('refuses fixtures and internal routes in production and fixtures on read-only mainnet', () => {
    expect(
      issues({
        MARKOV_ENV: 'production',
        MARKOV_WEB_INTERNAL_ROUTES: 'true',
        MARKOV_WEB_FIXTURES: 'true',
        NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
        MARKOV_API_ORIGIN: 'https://api.markov.pet',
      }),
    ).toEqual(['MARKOV_WEB_INTERNAL_ROUTES', 'MARKOV_WEB_FIXTURES']);
    expect(
      issues({
        MARKOV_ENV: 'mainnet-read-only',
        MARKOV_WEB_FIXTURES: 'true',
        NEXT_PUBLIC_APP_ORIGIN: 'https://staging.markov.pet',
        MARKOV_API_ORIGIN: 'https://api.staging.markov.pet',
      }),
    ).toEqual(['MARKOV_WEB_FIXTURES']);
    expect(
      issues({ MARKOV_ENV: 'production', MARKOV_API_ORIGIN: 'https://api.markov.pet' }),
    ).toEqual(['NEXT_PUBLIC_APP_ORIGIN']);
    expect(
      issues({
        MARKOV_ENV: 'staging',
        NEXT_PUBLIC_APP_ORIGIN: 'http://staging.markov.pet',
        MARKOV_API_ORIGIN: 'https://api.staging.markov.pet',
      }),
    ).toEqual(['NEXT_PUBLIC_APP_ORIGIN']);
  });

  it('rejects malformed values and throws a descriptive error', () => {
    expect(issues({ MARKOV_ENV: 'prod' })).toEqual(['MARKOV_ENV']);
    expect(issues({ MARKOV_WEB_FIXTURES: 'yes' })).toEqual(['MARKOV_WEB_FIXTURES']);
    expect(() => validateWebEnv({ MARKOV_ENV: 'production', MARKOV_WEB_FIXTURES: 'true' })).toThrow(
      WebEnvError,
    );
  });

  it('requires an explicit https API origin outside local and test', () => {
    expect(issues({ MARKOV_ENV: 'staging' })).toContain('MARKOV_API_ORIGIN');
    expect(issues({ MARKOV_ENV: 'staging', MARKOV_API_ORIGIN: 'http://api.internal' })).toContain(
      'MARKOV_API_ORIGIN',
    );
    expect(
      issues({
        MARKOV_ENV: 'production',
        NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
        MARKOV_API_ORIGIN: 'https://api.markov.pet',
      }),
    ).toEqual([]);
    expect(issues({ MARKOV_ENV: 'local', MARKOV_API_ORIGIN: 'http://127.0.0.1:3000/' })).toContain(
      'MARKOV_API_ORIGIN',
    );
  });
});
