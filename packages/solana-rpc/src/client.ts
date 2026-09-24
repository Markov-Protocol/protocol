import { z } from 'zod';

export type SolanaRpcFailureKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'oversized'
  | 'malformed'
  | 'rpc-error';

export class SolanaRpcError extends Error {
  override readonly name = 'SolanaRpcError';
  readonly kind: SolanaRpcFailureKind;
  readonly method: string;
  readonly httpStatus: number | null;
  readonly rpcCode: number | null;

  constructor(
    kind: SolanaRpcFailureKind,
    method: string,
    message: string,
    details: { httpStatus?: number; rpcCode?: number; cause?: unknown } = {},
  ) {
    super(`solana rpc ${method} failed (${kind}): ${message}`, { cause: details.cause });
    this.kind = kind;
    this.method = method;
    this.httpStatus = details.httpStatus ?? null;
    this.rpcCode = details.rpcCode ?? null;
  }
}

export interface SolanaRpcClientOptions {
  readonly url: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const envelopeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});

const versionSchema = z.object({
  'solana-core': z.string(),
  'feature-set': z.number().int().optional(),
});

/** JSON-RPC error code Solana nodes return from getHealth when behind or unhealthy. */
export const RPC_NODE_UNHEALTHY_CODE = -32005;

export interface SolanaHealth {
  readonly healthy: boolean;
  readonly detail: string;
}

export interface SolanaVersion {
  readonly solanaCore: string;
  readonly featureSet: number | null;
}

const accountInfoSchema = z.object({
  context: z.object({ slot: z.number().int() }),
  value: z
    .object({
      data: z.tuple([z.string(), z.literal('base64')]),
      executable: z.boolean(),
      lamports: z.number(),
      owner: z.string().min(32).max(44),
      space: z.number().int().optional(),
    })
    .nullable(),
});

export interface SolanaAccount {
  /** Program that owns the account (base58). */
  readonly owner: string;
  readonly data: Uint8Array;
  readonly lamports: number;
  readonly executable: boolean;
}

export interface SolanaAccountInfo {
  readonly slot: number;
  /** Null when no account exists at the address. */
  readonly account: SolanaAccount | null;
}

const balanceSchema = z.object({
  context: z.object({ slot: z.number().int() }),
  value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const keyedAccountsSchema = z.object({
  context: z.object({ slot: z.number().int() }),
  value: z.array(
    z.object({
      pubkey: z.string().min(32).max(44),
      account: z.object({
        data: z.tuple([z.string(), z.literal('base64')]),
        owner: z.string().min(32).max(44),
        lamports: z.number(),
        executable: z.boolean(),
      }),
    }),
  ),
});

export interface SolanaKeyedAccount {
  readonly pubkey: string;
  readonly owner: string;
  readonly data: Uint8Array;
  readonly lamports: number;
}

export interface SolanaTokenAccounts {
  readonly slot: number;
  readonly accounts: readonly SolanaKeyedAccount[];
}

export interface SolanaBalance {
  readonly slot: number;
  /** Lamports; balances above 2^53 are refused as malformed rather than rounded. */
  readonly lamports: number;
}

export class SolanaRpcClient {
  readonly host: string;
  private readonly options: SolanaRpcClientOptions;
  private nextId = 1;

  constructor(options: SolanaRpcClientOptions) {
    this.options = options;
    this.host = new URL(options.url).host;
  }

  async call<T>(
    method: string,
    params: readonly unknown[],
    resultSchema: z.ZodType<T>,
  ): Promise<T> {
    const id = this.nextId++;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'error',
      });
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause.name === 'TimeoutError' || cause.name === 'AbortError')
      ) {
        throw new SolanaRpcError(
          'timeout',
          method,
          `no response within ${this.options.timeoutMs}ms`,
          { cause },
        );
      }
      throw new SolanaRpcError('network', method, 'request failed before a response arrived', {
        cause,
      });
    }

    const text = await this.readBounded(response, method);
    if (!response.ok) {
      throw new SolanaRpcError('http', method, `endpoint answered HTTP ${response.status}`, {
        httpStatus: response.status,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new SolanaRpcError('malformed', method, 'response body is not JSON', { cause });
    }
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new SolanaRpcError('malformed', method, 'response is not a JSON-RPC 2.0 envelope');
    }
    if (envelope.data.id !== id) {
      throw new SolanaRpcError('malformed', method, 'response id does not match the request');
    }
    if (envelope.data.error) {
      throw new SolanaRpcError('rpc-error', method, envelope.data.error.message, {
        rpcCode: envelope.data.error.code,
      });
    }
    const result = resultSchema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new SolanaRpcError('malformed', method, 'result does not match the expected shape');
    }
    return result.data;
  }

  private async readBounded(response: Response, method: string): Promise<string> {
    const limit = this.options.maxResponseBytes;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw new SolanaRpcError(
        'oversized',
        method,
        `declared body of ${declared} bytes exceeds ${limit}`,
      );
    }
    if (!response.body) {
      return '';
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let step: Awaited<ReturnType<typeof reader.read>>;
      try {
        step = await reader.read();
      } catch (cause) {
        throw new SolanaRpcError('network', method, 'response body ended unexpectedly', { cause });
      }
      if (step.done) {
        break;
      }
      total += step.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new SolanaRpcError('oversized', method, `body exceeded ${limit} bytes`);
      }
      chunks.push(step.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  getGenesisHash(): Promise<string> {
    return this.call('getGenesisHash', [], z.string().min(43).max(44));
  }

  async getVersion(): Promise<SolanaVersion> {
    const version = await this.call('getVersion', [], versionSchema);
    return { solanaCore: version['solana-core'], featureSet: version['feature-set'] ?? null };
  }

  async getHealth(): Promise<SolanaHealth> {
    try {
      const result = await this.call('getHealth', [], z.string());
      return { healthy: result === 'ok', detail: result };
    } catch (error) {
      if (error instanceof SolanaRpcError && error.kind === 'rpc-error') {
        return { healthy: false, detail: error.message };
      }
      throw error;
    }
  }

  /** Raw account data with the base64 encoding only; callers parse the bytes themselves. */
  async getAccountInfo(
    address: string,
    commitment: 'processed' | 'confirmed' | 'finalized',
  ): Promise<SolanaAccountInfo> {
    const info = await this.call(
      'getAccountInfo',
      [address, { encoding: 'base64', commitment }],
      accountInfoSchema,
    );
    if (info.value === null) {
      return { slot: info.context.slot, account: null };
    }
    return {
      slot: info.context.slot,
      account: {
        owner: info.value.owner,
        data: new Uint8Array(Buffer.from(info.value.data[0], 'base64')),
        lamports: info.value.lamports,
        executable: info.value.executable,
      },
    };
  }

  getSlot(commitment: 'processed' | 'confirmed' | 'finalized'): Promise<number> {
    return this.call('getSlot', [{ commitment }], z.number().int().nonnegative());
  }

  /** Native balance of an address (agave `getBalance`). */
  async getBalance(
    address: string,
    commitment: 'processed' | 'confirmed' | 'finalized',
  ): Promise<SolanaBalance> {
    const result = await this.call('getBalance', [address, { commitment }], balanceSchema);
    return { slot: result.context.slot, lamports: result.value };
  }

  /** Every token account an owner holds for one mint, raw base64 data (agave `getTokenAccountsByOwner`). */
  async getTokenAccountsByOwner(
    owner: string,
    mint: string,
    commitment: 'processed' | 'confirmed' | 'finalized',
  ): Promise<SolanaTokenAccounts> {
    const result = await this.call(
      'getTokenAccountsByOwner',
      [owner, { mint }, { encoding: 'base64', commitment }],
      keyedAccountsSchema,
    );
    return {
      slot: result.context.slot,
      accounts: result.value.map((entry) => ({
        pubkey: entry.pubkey,
        owner: entry.account.owner,
        data: new Uint8Array(Buffer.from(entry.account.data[0], 'base64')),
        lamports: entry.account.lamports,
      })),
    };
  }

  /** Lamports an account of `dataLength` bytes needs to be rent exempt (agave `getMinimumBalanceForRentExemption`). */
  getMinimumBalanceForRentExemption(dataLength: number): Promise<number> {
    return this.call(
      'getMinimumBalanceForRentExemption',
      [dataLength],
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    );
  }
}
