import { readFile } from 'node:fs/promises';
import type { IngestionSource, Issuer } from '@markov/contracts';

/**
 * @markov/issuer-prestocks
 *
 * The PreStocks issuer source. The live PreStocks product endpoint and its
 * response schema are BLOCKED facts (docs.prestocks.com unreachable from the
 * build environment; open decision OD-17). This package therefore delivers
 * the Markov issuer feed contract (`issuerFeedSchema`, version 1) from two
 * sources: bundled synthetic fixtures for local and test modes, and an
 * operator-configured https URL that must already serve that contract.
 * Mapping PreStocks' real response onto the contract is the first task
 * once the documentation is verified; nothing here is a claim about it.
 */
export interface IssuerSourceResult {
  /** Fixture name or the URL without query string and credentials. */
  readonly sourceRef: string;
  readonly fetchedAt: Date;
  readonly payload: unknown;
  readonly bytes: number;
}

export interface IssuerSource {
  readonly issuer: Issuer;
  readonly source: IngestionSource;
  fetch(): Promise<IssuerSourceResult>;
}

export type IssuerSourceFailureKind =
  | 'insecure_url'
  | 'unreachable'
  | 'http'
  | 'oversized'
  | 'malformed';

export class IssuerSourceError extends Error {
  override readonly name = 'IssuerSourceError';
  readonly kind: IssuerSourceFailureKind;

  constructor(kind: IssuerSourceFailureKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.kind = kind;
  }
}

export const PRESTOCKS_FIXTURES = ['default', 'counterfeit', 'drift'] as const;
export type PrestocksFixture = (typeof PRESTOCKS_FIXTURES)[number];

const fixtureFiles: Record<PrestocksFixture, string> = {
  default: 'prestocks-feed.v1.json',
  counterfeit: 'prestocks-feed.counterfeit.json',
  drift: 'prestocks-feed.drift.json',
};

/**
 * Authoring instant of the bundled fixtures. Reference-price observation
 * times are re-anchored to the current hour at fetch time so that the
 * relative freshness the fixtures were written with (a fresh mark, a stale
 * mark) never erodes as real time passes; nothing else in a fixture moves,
 * and configured URLs are never touched. Quantising to the hour keeps
 * repeated fixture ingestions byte-identical within an hour.
 */
export const FIXTURE_PRICE_ANCHOR = Date.parse('2026-09-25T00:00:00Z');

export function reanchorFixturePrices(payload: unknown, now: Date): unknown {
  if (payload === null || typeof payload !== 'object') {
    return payload;
  }
  const products = (payload as { products?: unknown }).products;
  if (!Array.isArray(products)) {
    return payload;
  }
  const hour = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const shift = hour - FIXTURE_PRICE_ANCHOR;
  return {
    ...(payload as Record<string, unknown>),
    products: products.map((product: unknown) => {
      if (product === null || typeof product !== 'object') {
        return product;
      }
      const price = (product as { referencePrice?: unknown }).referencePrice;
      if (price === null || typeof price !== 'object') {
        return product;
      }
      const observedAt = (price as { observedAt?: unknown }).observedAt;
      if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
        return product;
      }
      return {
        ...(product as Record<string, unknown>),
        referencePrice: {
          ...(price as Record<string, unknown>),
          observedAt: new Date(Date.parse(observedAt) + shift).toISOString(),
        },
      };
    }),
  };
}

/** Synthetic products only: no real issuer product, mint or price appears in a fixture. */
export function createPrestocksFixtureSource(fixture: PrestocksFixture = 'default'): IssuerSource {
  const file = new URL(`../fixtures/${fixtureFiles[fixture]}`, import.meta.url);
  return {
    issuer: 'prestocks',
    source: 'fixture',
    async fetch() {
      const text = await readFile(file, 'utf8');
      const fetchedAt = new Date();
      return {
        sourceRef: `fixture:${fixture}`,
        fetchedAt,
        payload: reanchorFixturePrices(JSON.parse(text) as unknown, fetchedAt),
        bytes: Buffer.byteLength(text),
      };
    },
  };
}

export interface PrestocksUrlSourceOptions {
  readonly url: string;
  /** Plain http is accepted only when the caller runs in local or test mode. */
  readonly allowInsecure?: boolean;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

function sourceRefOf(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/**
 * Fetch the feed from a configured URL with the same bounds as the RPC
 * client: https only outside local/test, no redirects, a timeout and a
 * byte cap. The response must already be the Markov feed contract.
 */
export function createPrestocksUrlSource(options: PrestocksUrlSourceOptions): IssuerSource {
  const url = new URL(options.url);
  if (url.username || url.password) {
    throw new IssuerSourceError('insecure_url', 'feed URL must not embed credentials');
  }
  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    throw new IssuerSourceError('insecure_url', 'feed URL must use https');
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sourceRef = sourceRefOf(url);
  return {
    issuer: 'prestocks',
    source: 'configured_url',
    async fetch() {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (cause) {
        throw new IssuerSourceError('unreachable', `feed ${sourceRef} did not answer`, cause);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new IssuerSourceError('http', `feed ${sourceRef} answered HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new IssuerSourceError(
          'oversized',
          `feed declares ${declared} bytes, limit ${maxBytes}`,
        );
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const step = await reader.read();
          if (step.done) {
            break;
          }
          total += step.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new IssuerSourceError('oversized', `feed exceeded ${maxBytes} bytes`);
          }
          chunks.push(step.value);
        }
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (cause) {
        throw new IssuerSourceError('malformed', `feed ${sourceRef} is not JSON`, cause);
      }
      return { sourceRef, fetchedAt: new Date(), payload, bytes: total };
    },
  };
}
