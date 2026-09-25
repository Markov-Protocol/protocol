import { z } from 'zod';

/**
 * A bounded client for xAI's chat completions endpoint (OpenAI-compatible
 * request and response shapes). It sends exactly the messages an adapter
 * hands it, with the configured model, a timeout, no redirects and a byte
 * cap on the answer; it never logs or echoes the key, and it classifies
 * failures so callers can tell configuration errors from transient ones.
 * The provider's text is data to validate, never an instruction.
 */
export const XAI_DEFAULT_BASE_URL = 'https://api.x.ai/v1';
export const XAI_DEFAULT_MODEL = 'grok-4';

export type XaiFailureKind =
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'http'
  | 'oversized'
  | 'malformed';

export class XaiError extends Error {
  readonly kind: XaiFailureKind;
  readonly httpStatus: number | null;
  /** True for failures a later attempt may not repeat (network, 429, 5xx). */
  readonly retryable: boolean;

  constructor(
    kind: XaiFailureKind,
    message: string,
    options: { httpStatus?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'XaiError';
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Micros of a dollar per token; the budgets of a companion run are measured in these. */
export interface XaiPricing {
  readonly inputMicrosPerToken: number;
  readonly outputMicrosPerToken: number;
}

export interface XaiClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly pricing?: XaiPricing;
  /** Test seam; production uses the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Allow a plain-http base URL for an in-process stand-in (local and test only). */
  readonly allowInsecure?: boolean;
}

export interface XaiChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface XaiChatRequest {
  readonly messages: readonly XaiChatMessage[];
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  /** Ask the provider for a JSON object; the reply is still parsed and validated by the caller. */
  readonly json?: boolean;
}

export interface XaiChatResult {
  readonly text: string;
  /** The model the provider reports having used, or the requested one. */
  readonly model: string;
  readonly finishReason: string | null;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costMicros: number;
  };
}

export interface XaiClient {
  readonly provider: 'xai';
  readonly model: string;
  readonly baseUrl: string;
  chat(request: XaiChatRequest): Promise<XaiChatResult>;
}

const chatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string().optional(),
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const errorBodySchema = z.object({
  error: z
    .union([z.string(), z.object({ message: z.string().optional(), code: z.string().optional() })])
    .optional(),
});

/** Default list prices at the time of writing (micros per token); configuration overrides them and must be checked against the current price list. */
export const XAI_DEFAULT_PRICING: XaiPricing = { inputMicrosPerToken: 3, outputMicrosPerToken: 15 };

function checkedBaseUrl(raw: string, allowInsecure: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new XaiError('malformed', 'the xAI base URL is not a URL');
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new XaiError('malformed', 'the xAI base URL must use https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new XaiError('malformed', 'the xAI base URL must not carry credentials');
  }
  return url.toString().replace(/\/+$/, '');
}

function redact(text: string, secret: string): string {
  return secret.length > 0 ? text.split(secret).join('<redacted>') : text;
}

export function createXaiClient(options: XaiClientOptions): XaiClient {
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
    throw new XaiError('unauthorized', 'an xAI API key is required');
  }
  const apiKey = options.apiKey;
  const baseUrl = checkedBaseUrl(
    options.baseUrl ?? XAI_DEFAULT_BASE_URL,
    options.allowInsecure === true,
  );
  const model = options.model ?? XAI_DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxResponseBytes ?? 1024 * 1024;
  const pricing = options.pricing ?? XAI_DEFAULT_PRICING;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${baseUrl}/chat/completions`;

  const readBounded = async (response: Response): Promise<string> => {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new XaiError('oversized', `xAI declared ${declared} bytes, limit ${maxBytes}`);
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
          throw new XaiError('oversized', `xAI exceeded ${maxBytes} bytes`);
        }
        chunks.push(step.value);
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  const detailOf = (text: string): string => {
    try {
      const parsed = errorBodySchema.safeParse(JSON.parse(text));
      if (parsed.success && parsed.data.error !== undefined) {
        const error = parsed.data.error;
        const message = typeof error === 'string' ? error : (error.message ?? error.code ?? '');
        return redact(message, apiKey).slice(0, 200);
      }
    } catch {
      // not JSON
    }
    return '';
  };

  return {
    provider: 'xai',
    model,
    baseUrl,
    async chat(request) {
      const body = {
        model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_tokens: Math.max(1, Math.trunc(request.maxOutputTokens)),
        temperature: request.temperature ?? 0,
        stream: false,
        ...(request.json === true ? { response_format: { type: 'json_object' } } : {}),
      };
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (cause) {
        throw new XaiError('unreachable', 'xAI did not answer', { retryable: true, cause });
      }
      const text = await readBounded(response);
      if (!response.ok) {
        const detail = detailOf(text);
        const suffix = detail ? `: ${detail}` : '';
        if (response.status === 401 || response.status === 403) {
          throw new XaiError(
            'unauthorized',
            `xAI refused the key (HTTP ${response.status})${suffix}`,
            {
              httpStatus: response.status,
            },
          );
        }
        if (response.status === 429) {
          throw new XaiError('rate_limited', `xAI rate limit (HTTP 429)${suffix}`, {
            httpStatus: 429,
            retryable: true,
          });
        }
        throw new XaiError('http', `xAI answered HTTP ${response.status}${suffix}`, {
          httpStatus: response.status,
          retryable: response.status >= 500,
        });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (cause) {
        throw new XaiError('malformed', 'xAI answered something that is not JSON', { cause });
      }
      const parsed = chatResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new XaiError('malformed', 'xAI answered an unexpected chat completion shape');
      }
      const choice = parsed.data.choices[0];
      const content = choice?.message.content;
      if (typeof content !== 'string') {
        throw new XaiError('malformed', 'xAI answered without message content');
      }
      const inputTokens = parsed.data.usage?.prompt_tokens ?? 0;
      const outputTokens = parsed.data.usage?.completion_tokens ?? 0;
      return {
        text: content,
        model: parsed.data.model ?? model,
        finishReason: choice?.finish_reason ?? null,
        usage: {
          inputTokens,
          outputTokens,
          costMicros: Math.round(
            inputTokens * pricing.inputMicrosPerToken + outputTokens * pricing.outputMicrosPerToken,
          ),
        },
      };
    },
  };
}

/** The first JSON object in a reply (a bare object, or one wrapped in prose or a code fence), or null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidates = [text.trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export { unique };
