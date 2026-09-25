import {
  COMPANION_INSTRUCTION,
  type CompanionModelAdapter,
  type CompanionStepInput,
  type CompanionStepOutput,
  canonicalJson,
  promptTextOf,
} from '@markov/agent-tools';
import type { CompanionSource } from '@markov/contracts';
import { z } from 'zod';
import { parseJsonObject, type XaiClient, XaiError } from './client.js';

/**
 * Companion steps over xAI (B17). Each step sends the instruction, the
 * canonical first prompt the loop hashes for provenance (question,
 * redacted context, tool names, remaining budget) and a second message
 * with the tool schemas and the transcript so far. The model answers one
 * JSON object: a tool call or the final answer. Everything it says is
 * validated by the loop: unknown tools and widened arguments are refused
 * there, uncited sources are dropped, and the answer becomes bounded plain
 * text. A reply that is not the JSON protocol is treated as the answer
 * text, never as a call.
 */
export const COMPANION_PROTOCOL =
  'Reply with exactly one JSON object and nothing else. To use a tool: {"kind":"call","tool":"<name from the tools list>","input":{...}} where input follows that tool\'s inputSchema. To finish: {"kind":"answer","text":"<plain text for the person>","sources":[{"kind":"<kind>","id":"<id>"}]} citing only refs that appear in the transcript. Never call a tool that is not listed; a refused call is final; when the remaining tool-call budget is 0, answer.';

const stepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call'),
    tool: z.string().min(1).max(80),
    input: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('answer'),
    text: z.string().max(20_000),
    sources: z
      .array(z.object({ kind: z.string().max(40), id: z.string().max(120) }))
      .max(50)
      .default([]),
  }),
]);

export interface XaiCompanionOptions {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export function createXaiCompanionAdapter(
  client: XaiClient,
  options: XaiCompanionOptions = {},
): CompanionModelAdapter {
  return {
    provider: 'xai',
    model: client.model,
    modelVersion: client.model,
    async step(input: CompanionStepInput): Promise<CompanionStepOutput> {
      const result = await client.chat({
        messages: [
          { role: 'system', content: `${COMPANION_INSTRUCTION} ${COMPANION_PROTOCOL}` },
          { role: 'user', content: promptTextOf(input) },
          {
            role: 'user',
            content: canonicalJson({
              tools: input.tools,
              transcript: input.transcript,
              remaining: input.remaining,
            }),
          },
        ],
        maxOutputTokens:
          options.maxOutputTokens ??
          Math.min(4096, Math.ceil(Math.max(1, input.remaining.outputChars) / 2) + 256),
        temperature: options.temperature ?? 0,
        json: true,
      });
      if (result.text.trim().length === 0) {
        throw new XaiError('malformed', 'the model answered with empty content');
      }
      const object = parseJsonObject(result.text);
      const parsed = object === null ? null : stepSchema.safeParse(object);
      if (parsed?.success) {
        if (parsed.data.kind === 'call') {
          return {
            kind: 'call',
            tool: parsed.data.tool,
            input: parsed.data.input ?? {},
            usage: result.usage,
          };
        }
        return {
          kind: 'answer',
          text: parsed.data.text,
          sources: parsed.data.sources.map((source) => ({
            kind: source.kind as CompanionSource['kind'],
            id: source.id,
          })),
          usage: result.usage,
        };
      }
      // Prose instead of the protocol: it is the answer, validated as plain text by the loop; it can never become a call.
      return { kind: 'answer', text: result.text, sources: [], usage: result.usage };
    },
  };
}
