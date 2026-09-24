import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface JsonRpcRequestRecord {
  readonly method: string;
  readonly params: unknown;
  readonly id: unknown;
}

export type JsonRpcHandler = (
  params: unknown,
) => unknown | { rpcError: { code: number; message: string } };

export interface FakeJsonRpcOptions {
  readonly handlers: Readonly<Record<string, JsonRpcHandler>>;
  /** Delay every response by this many milliseconds (for timeout tests). */
  readonly delayMs?: number;
  /** Respond with this exact body and status instead of JSON-RPC (for malformed/oversized tests). */
  readonly rawResponse?: {
    readonly status: number;
    readonly body: string;
    readonly contentType?: string;
  };
}

export interface FakeJsonRpcServer {
  readonly url: string;
  readonly requests: readonly JsonRpcRequestRecord[];
  close(): Promise<void>;
}

/** Minimal JSON-RPC 2.0 server on a random loopback port for provider-adapter tests. */
export async function startFakeJsonRpcServer(
  options: FakeJsonRpcOptions,
): Promise<FakeJsonRpcServer> {
  const requests: JsonRpcRequestRecord[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const respond = () => {
        if (options.rawResponse) {
          res.writeHead(options.rawResponse.status, {
            'content-type': options.rawResponse.contentType ?? 'application/json',
          });
          res.end(options.rawResponse.body);
          return;
        }
        let parsed: { method?: string; params?: unknown; id?: unknown };
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof parsed;
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'parse error' },
            }),
          );
          return;
        }
        const method = parsed.method ?? '';
        requests.push({ method, params: parsed.params, id: parsed.id });
        const handler = options.handlers[method];
        res.writeHead(200, { 'content-type': 'application/json' });
        if (!handler) {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? null,
              error: { code: -32601, message: 'method not found' },
            }),
          );
          return;
        }
        const result = handler(parsed.params);
        if (typeof result === 'object' && result !== null && 'rpcError' in result) {
          const { rpcError } = result as { rpcError: { code: number; message: string } };
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, error: rpcError }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, result }));
      };
      if (options.delayMs) {
        setTimeout(respond, options.delayMs);
      } else {
        respond();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
