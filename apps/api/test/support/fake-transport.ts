import type { HopResponse, RetrievalTransport } from '../../src/research/retrieval.js';

export interface FakeHop {
  readonly status: number;
  readonly location?: string;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly body?: string | Uint8Array[];
}

export interface FakeTransport extends RetrievalTransport {
  readonly calls: { url: string; address: string }[];
  readonly closed: number;
}

/** In-memory retrieval transport: hosts resolve to configured answers; URLs answer configured hops. */
export function fakeTransport(
  hosts: Record<string, string[]>,
  pages: Record<string, FakeHop>,
): FakeTransport {
  const calls: { url: string; address: string }[] = [];
  const state = { closed: 0 };
  return {
    calls,
    get closed() {
      return state.closed;
    },
    async resolve(host) {
      const answers = hosts[host];
      if (!answers) {
        throw new Error(`ENOTFOUND ${host}`);
      }
      return answers;
    },
    async request(url, address) {
      calls.push({ url: url.toString(), address });
      const hop = pages[url.toString()];
      if (!hop) {
        throw new Error('ECONNREFUSED');
      }
      const chunks =
        typeof hop.body === 'string'
          ? [new TextEncoder().encode(hop.body)]
          : (hop.body ?? [new Uint8Array(0)]);
      const response: HopResponse = {
        status: hop.status,
        location: hop.location ?? null,
        contentType: hop.contentType ?? null,
        contentLength: hop.contentLength ?? null,
        body: (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
        close: () => {
          state.closed += 1;
        },
      };
      return response;
    },
  };
}
