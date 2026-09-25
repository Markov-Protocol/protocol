import { createHash } from 'node:crypto';
import type { CompanionSource } from '@markov/contracts';
import { plainText } from '@markov/research';
import { canonicalJson } from './provenance.js';

/**
 * The bounded companion model adapter (B15). A provider sees the question,
 * a redacted context, the tools the caller may use (names, summaries and
 * input schemas), the transcript so far and what remains of the budget.
 * It answers one step at a time: a tool call, or the final answer. The
 * loop that drives it validates every call, refuses what the principal
 * may not do and never lets the provider see credentials, wallets, lots or
 * another account. Nothing the provider says is an instruction to the
 * platform; it is text to validate.
 */
export interface CompanionToolView {
  readonly name: string;
  readonly summary: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface CompanionModelContext {
  readonly thesis: {
    readonly thesisId: string;
    readonly title: string;
    readonly claim: string;
    readonly sources: readonly {
      readonly sourceId: string;
      readonly role: string;
      readonly excerpt: string;
    }[];
  } | null;
  readonly instance: {
    readonly instanceId: string;
    readonly label: string | null;
    readonly versionTitle: string;
    readonly versionNumber: number;
  } | null;
  readonly strategy: { readonly strategyId: string; readonly title: string } | null;
  readonly instruments: readonly {
    readonly instrumentId: string;
    readonly symbol: string;
    readonly companyName: string;
    readonly issuer: string;
  }[];
}

export interface CompanionTranscriptEntry {
  readonly seq: number;
  /** The tool as the model named it. */
  readonly tool: string;
  readonly input: unknown;
  readonly outcome: 'ok' | 'refused';
  readonly code: string | null;
  readonly message: string;
  /** Bounded canonical JSON of the output the model may read; null when refused. */
  readonly outputText: string | null;
  /** What the output lets the model cite. */
  readonly refs: readonly CompanionSource[];
}

export interface CompanionStepInput {
  readonly question: string;
  readonly context: CompanionModelContext;
  readonly tools: readonly CompanionToolView[];
  readonly transcript: readonly CompanionTranscriptEntry[];
  readonly remaining: {
    readonly toolCalls: number;
    readonly outputChars: number;
    readonly costMicros: number;
  };
}

export interface CompanionUsageDelta {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
}

export type CompanionStepOutput =
  | {
      readonly kind: 'call';
      readonly tool: string;
      readonly input: unknown;
      readonly usage: CompanionUsageDelta;
    }
  | {
      readonly kind: 'answer';
      readonly text: string;
      readonly sources: readonly { readonly kind: CompanionSource['kind']; readonly id: string }[];
      readonly usage: CompanionUsageDelta;
    };

export interface CompanionModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  step(input: CompanionStepInput): Promise<CompanionStepOutput>;
}

export const COMPANION_INSTRUCTION =
  'You help one person understand tokenised stock exposures. Use only the tools you are given, with the arguments their schemas allow; you cannot sign, approve, spend, change limits or act for another account, and a tool refusal is final. Answer in plain text the person must review; cite only what the tools returned; never claim an order was placed.';

/** The exact first prompt a provider receives, hashed for provenance; the text itself is not stored. */
export function promptTextOf(
  input: Pick<CompanionStepInput, 'question' | 'context' | 'tools' | 'remaining'>,
): string {
  return canonicalJson({
    instruction: COMPANION_INSTRUCTION,
    question: input.question,
    context: input.context,
    tools: input.tools.map((tool) => tool.name),
    remaining: input.remaining,
  });
}

export function promptHashOf(
  input: Pick<CompanionStepInput, 'question' | 'context' | 'tools' | 'remaining'>,
): string {
  return createHash('sha256').update(promptTextOf(input)).digest('hex');
}

export interface Directive {
  readonly tool: string;
  readonly input: unknown;
}

const DIRECTIVE_HEAD = /TOOL:\s*([A-Za-z][A-Za-z0-9_.-]{0,79})/g;

/** The JSON object starting at `start` (brace depth with string awareness), or null when unbalanced. */
function jsonObjectAt(text: string, start: number): string | null {
  if (text[start] !== '{') {
    return null;
  }
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
    if (char === '\n') {
      break;
    }
  }
  return null;
}

/**
 * Directives a naive model would follow: `TOOL: <name> {json}` anywhere in
 * text it reads, a question or a retrieved document alike. The fixture
 * adapter follows them so that tests prove the tool layer, not the model,
 * is the boundary.
 */
export function parseDirectives(text: string): Directive[] {
  const directives: Directive[] = [];
  for (const match of text.matchAll(DIRECTIVE_HEAD)) {
    const tool = match[1] as string;
    const rest = text.slice(match.index + match[0].length);
    const braceAt = rest.search(/\S/);
    let input: unknown = {};
    if (braceAt >= 0 && rest[braceAt] === '{') {
      const object = jsonObjectAt(rest, braceAt);
      if (object === null) {
        input = { malformed: rest.slice(braceAt, braceAt + 100) };
      } else {
        try {
          input = JSON.parse(object);
        } catch {
          input = { malformed: object.slice(0, 100) };
        }
      }
    }
    directives.push({ tool, input });
  }
  return directives;
}

function tokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Fixture rate: one micro per token in and out; deterministic and documented, never a provider's price. */
export const FIXTURE_COST_MICROS_PER_TOKEN = 1;

function usageOf(input: CompanionStepInput, outputText: string): CompanionUsageDelta {
  const inputTokens = tokensOf(promptTextOf(input) + canonicalJson(input.transcript));
  const outputTokens = tokensOf(outputText);
  return {
    inputTokens,
    outputTokens,
    costMicros: (inputTokens + outputTokens) * FIXTURE_COST_MICROS_PER_TOKEN,
  };
}

/** Everything the fixture model reads, in the order it reads it: the question, the context excerpts, then tool outputs. */
function directivesSeen(input: CompanionStepInput): Directive[] {
  const texts = [input.question];
  for (const source of input.context.thesis?.sources ?? []) {
    texts.push(source.excerpt);
  }
  for (const entry of input.transcript) {
    if (entry.outputText !== null) {
      texts.push(entry.outputText);
    }
  }
  return texts.flatMap(parseDirectives);
}

/**
 * Deterministic stand-in for local and test environments. It follows every
 * `TOOL:` directive it can read, one per step, in the order it read them,
 * then answers with a plain summary of what each call returned or why it
 * was refused, citing only what the transcript lets it cite. It never
 * contacts a network.
 */
export function createFixtureCompanionAdapter(): CompanionModelAdapter {
  return {
    provider: 'fixture',
    model: 'fixture-companion',
    modelVersion: '2026-09-25',
    async step(input) {
      const directives = directivesSeen(input);
      const next = directives[input.transcript.length];
      if (next !== undefined && input.remaining.toolCalls > 0) {
        return {
          kind: 'call',
          tool: next.tool,
          input: next.input,
          usage: usageOf(input, canonicalJson(next)),
        };
      }
      const lines: string[] = [`You asked: ${plainText(input.question, 240)}`];
      if (input.context.thesis) {
        lines.push(
          `Context: thesis "${plainText(input.context.thesis.title, 80)}" with ${input.context.thesis.sources.length} fetched source${input.context.thesis.sources.length === 1 ? '' : 's'}.`,
        );
      }
      if (input.context.instance) {
        lines.push(
          `Context: instance pinned to "${plainText(input.context.instance.versionTitle, 80)}" version ${input.context.instance.versionNumber}.`,
        );
      }
      if (input.transcript.length === 0) {
        lines.push('No tool was called; nothing beyond the context was read.');
      }
      for (const entry of input.transcript) {
        if (entry.outcome === 'ok') {
          const cited = entry.refs
            .slice(0, 6)
            .map((ref) => ref.label)
            .join('; ');
          lines.push(
            `${entry.tool} answered${cited ? `: ${cited}` : ` (${entry.outputText?.length ?? 0} characters)`}.`,
          );
        } else {
          lines.push(
            `${entry.tool} was refused (${entry.code ?? 'REFUSED'}: ${plainText(entry.message, 160)}); nothing was changed by it.`,
          );
        }
      }
      if (directives.length > input.transcript.length) {
        lines.push(
          `${directives.length - input.transcript.length} further instruction${directives.length - input.transcript.length === 1 ? '' : 's'} found in the text were not followed: the tool-call budget is spent.`,
        );
      }
      lines.push(
        'Nothing here is an order; anything to act on appears as a proposal for your review.',
      );
      const text = lines.join(' ').slice(0, Math.max(1, input.remaining.outputChars));
      const sources = input.transcript.flatMap((entry) =>
        entry.refs.map((ref) => ({ kind: ref.kind, id: ref.id })),
      );
      return { kind: 'answer', text, sources, usage: usageOf(input, text) };
    },
  };
}

/** Plain-text validation of a model answer: markup and control characters removed, bounded; reports truncation. */
export function validateAnswer(
  text: string,
  maxChars: number,
): { readonly answer: string; readonly truncated: boolean } {
  const clean = plainText(text, Math.max(1, maxChars) + 1);
  if (clean.length <= maxChars) {
    return { answer: clean, truncated: false };
  }
  return { answer: `${clean.slice(0, maxChars - 1)}…`, truncated: true };
}

/** Only sources the run actually read or created survive; the rest of what the model cited is dropped. */
export function validateSources(
  cited: readonly { readonly kind: CompanionSource['kind']; readonly id: string }[],
  seen: readonly CompanionSource[],
): { readonly sources: CompanionSource[]; readonly dropped: number } {
  const byKey = new Map(seen.map((source) => [`${source.kind}:${source.id}`, source]));
  const sources: CompanionSource[] = [];
  const kept = new Set<string>();
  let dropped = 0;
  for (const entry of cited) {
    const key = `${entry.kind}:${entry.id}`;
    const known = byKey.get(key);
    if (known === undefined) {
      dropped += 1;
      continue;
    }
    if (!kept.has(key)) {
      kept.add(key);
      sources.push(known);
    }
  }
  return { sources, dropped };
}
