import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  classifyResolved,
  collapseWhitespace,
  evaluateContentType,
  evaluateRedirect,
  evaluateUrl,
  excerptOf,
  extractTitle,
  fixtureSourceFor,
  htmlToText,
  MAX_BODY_BYTES,
  RETRIEVAL_TIMEOUT_MS,
  stripControl,
} from '@markov/research';

/**
 * Safe retrieval of a research source. Every hop resolves the host, refuses
 * any non-public answer and pins the connection to the address that was
 * classified (no rebinding between check and use); redirects are validated
 * against the same policy; bodies are capped while streaming; only
 * text-like content types are accepted; everything becomes bounded plain
 * text. The retriever holds no credentials and follows no instruction found
 * in a page.
 */
export interface HopResponse {
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly body: AsyncIterable<Uint8Array>;
  /** Drop the connection: called when the body is not read to its end. */
  close(): void;
}

export interface RetrievalTransport {
  /** Every address the host resolves to; the fetch is refused when any is not public. */
  resolve(host: string): Promise<string[]>;
  /** One request to `url` sent to the pinned `address` with the URL host as SNI and Host header; never follows redirects. */
  request(url: URL, address: string, signal: AbortSignal): Promise<HopResponse>;
}

export interface RetrievedDocument {
  readonly status: 'fetched';
  readonly finalUrl: string;
  readonly title: string | null;
  readonly contentType: string;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly excerpt: string;
  readonly redirects: string[];
  readonly origin: 'network' | 'fixture';
}

export type RetrievalOutcome =
  | RetrievedDocument
  | {
      readonly status: 'blocked' | 'failed';
      readonly reason: string;
      readonly redirects: string[];
    };

export interface Retriever {
  retrieve(url: string): Promise<RetrievalOutcome>;
}

export interface RetrieverOptions {
  /** Serve the bundled fixture sources from memory: local and test only. */
  readonly fixtures: boolean;
  readonly transport?: RetrievalTransport;
  readonly timeoutMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPT = 'text/html, application/xhtml+xml, text/plain, application/json';
const USER_AGENT = 'markov-research/0.1 (source retrieval; no credentials)';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
}

function headerOf(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return Array.isArray(value) ? (value[0] ?? null) : null;
}

/** `node:https` transport: OS resolver for the answers, a pinned lookup for the connection. */
export function createHttpsTransport(): RetrievalTransport {
  return {
    async resolve(host) {
      const answers = await dns.lookup(host, { all: true, verbatim: true });
      return answers.map((answer) => answer.address);
    },
    request(url, address, signal) {
      return new Promise((resolve, reject) => {
        const family = address.includes(':') ? 6 : 4;
        const lookup: LookupFunction = (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        };
        const req = httpsRequest(
          url,
          {
            method: 'GET',
            lookup,
            servername: url.hostname,
            headers: {
              host: url.host,
              accept: ACCEPT,
              'accept-encoding': 'identity',
              'user-agent': USER_AGENT,
            },
            signal,
            timeout: RETRIEVAL_TIMEOUT_MS,
          },
          (response) => {
            const length = headerOf(response.headers['content-length']);
            resolve({
              status: response.statusCode ?? 0,
              location: headerOf(response.headers.location),
              contentType: headerOf(response.headers['content-type']),
              contentLength: length !== null && /^\d+$/.test(length) ? Number(length) : null,
              body: response,
              close: () => response.destroy(),
            });
          },
        );
        req.on('timeout', () => req.destroy(new Error('request timed out')));
        req.on('error', reject);
        req.end();
      });
    },
  };
}

/** Reads at most `max` bytes; answers null as soon as the body exceeds the cap. */
async function readBounded(response: HopResponse, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > max) {
      response.close();
      return null;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function documentOf(
  bytes: Buffer,
  contentTypeHeader: string,
  finalUrl: string,
  redirects: string[],
  origin: 'network' | 'fixture',
): RetrievalOutcome {
  const contentType = evaluateContentType(contentTypeHeader);
  if (!contentType.ok) {
    return { status: 'blocked', reason: contentType.reason, redirects };
  }
  const raw = bytes.toString('utf8');
  const isHtml =
    contentType.mediaType === 'text/html' || contentType.mediaType === 'application/xhtml+xml';
  const text = isHtml ? htmlToText(raw) : collapseWhitespace(stripControl(raw));
  return {
    status: 'fetched',
    finalUrl,
    title: isHtml ? extractTitle(raw) : null,
    contentType: contentType.mediaType,
    byteLength: bytes.byteLength,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    excerpt: excerptOf(text),
    redirects,
    origin,
  };
}

export function createRetriever(options: RetrieverOptions): Retriever {
  const transport = options.transport ?? createHttpsTransport();
  const timeoutMs = options.timeoutMs ?? RETRIEVAL_TIMEOUT_MS;
  return {
    async retrieve(candidate) {
      if (options.fixtures) {
        const fixture = fixtureSourceFor(candidate);
        if (fixture) {
          return documentOf(
            Buffer.from(fixture.body, 'utf8'),
            fixture.contentType,
            fixture.url,
            [],
            'fixture',
          );
        }
      }
      const verdict = evaluateUrl(candidate);
      if (!verdict.ok) {
        return { status: 'blocked', reason: verdict.reason, redirects: [] };
      }
      const redirects: string[] = [];
      const signal = AbortSignal.timeout(timeoutMs);
      let current = verdict.url;
      for (let hop = 0; ; hop += 1) {
        let addresses: string[];
        try {
          addresses = await transport.resolve(current.hostname);
        } catch (error) {
          return {
            status: 'failed',
            reason: `could not resolve ${current.hostname}: ${messageOf(error)}`,
            redirects,
          };
        }
        const classified = classifyResolved(addresses);
        if (!classified.ok) {
          return {
            status: 'blocked',
            reason: `${current.hostname} resolves to a refused address: ${classified.reason}`,
            redirects,
          };
        }
        let response: HopResponse;
        try {
          response = await transport.request(current, addresses[0] as string, signal);
        } catch (error) {
          return {
            status: 'failed',
            reason: `request to ${current.hostname} failed: ${messageOf(error)}`,
            redirects,
          };
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          response.close();
          const next = evaluateRedirect(current, response.location, hop);
          if (!next.ok) {
            return { status: 'blocked', reason: `redirect refused: ${next.reason}`, redirects };
          }
          redirects.push(next.url.toString());
          current = next.url;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          response.close();
          return {
            status: 'failed',
            reason: `HTTP ${response.status} from ${current.hostname}`,
            redirects,
          };
        }
        const contentType = evaluateContentType(response.contentType);
        if (!contentType.ok) {
          response.close();
          return { status: 'blocked', reason: contentType.reason, redirects };
        }
        if (response.contentLength !== null && response.contentLength > MAX_BODY_BYTES) {
          response.close();
          return {
            status: 'blocked',
            reason: `declared length ${response.contentLength} exceeds the ${MAX_BODY_BYTES} byte cap`,
            redirects,
          };
        }
        let body: Buffer | null;
        try {
          body = await readBounded(response, MAX_BODY_BYTES);
        } catch (error) {
          return { status: 'failed', reason: `body read failed: ${messageOf(error)}`, redirects };
        }
        if (body === null) {
          return {
            status: 'blocked',
            reason: `body exceeds the ${MAX_BODY_BYTES} byte cap`,
            redirects,
          };
        }
        return documentOf(
          body,
          response.contentType ?? contentType.mediaType,
          current.toString(),
          redirects,
          'network',
        );
      }
    },
  };
}
