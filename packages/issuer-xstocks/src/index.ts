import { readFile } from 'node:fs/promises';
import type { IngestionSource, Issuer, SnapshotKindSchemaType } from '@markov/contracts';

/**
 * @markov/issuer-xstocks
 *
 * The xStocks issuer source for listed-stock products and corporate-action
 * events. The live xStocks endpoints (assets, corporate actions, multiplier
 * guide) are BLOCKED facts (xstocks.com unreachable from the build
 * environment; open decision OD-18). This package delivers the Markov
 * issuer feed contract and the corporate-action feed contract (both version
 * 1) from bundled synthetic fixtures (local and test) or operator-configured
 * https URLs that already serve those contracts. Mapping xStocks' real
 * responses is the first task once the documentation is verified.
 */
export interface IssuerSourceResult {
  readonly sourceRef: string;
  readonly fetchedAt: Date;
  readonly payload: unknown;
  readonly bytes: number;
}

export interface IssuerSource {
  readonly issuer: Issuer;
  readonly kind: SnapshotKindSchemaType;
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

export const XSTOCKS_FIXTURES = ['products', 'events', 'events-drift'] as const;
export type XstocksFixture = (typeof XSTOCKS_FIXTURES)[number];

const fixtureFiles: Record<XstocksFixture, { file: string; kind: SnapshotKindSchemaType }> = {
  products: { file: 'xstocks-products.v1.json', kind: 'products' },
  events: { file: 'xstocks-events.v1.json', kind: 'corporate_actions' },
  'events-drift': { file: 'xstocks-events.drift.json', kind: 'corporate_actions' },
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

/** Synthetic listed stocks and events only; no real xStocks product, mint or event appears here. */
export function createXstocksFixtureSource(fixture: XstocksFixture): IssuerSource {
  const { file, kind } = fixtureFiles[fixture];
  const url = new URL(`../fixtures/${file}`, import.meta.url);
  return {
    issuer: 'xstocks',
    kind,
    source: 'fixture',
    async fetch() {
      const text = await readFile(url, 'utf8');
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

export interface XstocksUrlSourceOptions {
  readonly url: string;
  readonly kind: SnapshotKindSchemaType;
  readonly allowInsecure?: boolean;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Bounded fetch of a configured feed: https only outside local/test, no credentials, no redirects, timeout and byte cap. */
export function createXstocksUrlSource(options: XstocksUrlSourceOptions): IssuerSource {
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
  const sourceRef = `${url.protocol}//${url.host}${url.pathname}`;
  return {
    issuer: 'xstocks',
    kind: options.kind,
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
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (cause) {
        throw new IssuerSourceError('malformed', `feed ${sourceRef} is not JSON`, cause);
      }
      return { sourceRef, fetchedAt: new Date(), payload, bytes: total };
    },
  };
}
