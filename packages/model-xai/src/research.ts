import {
  type ModelInput,
  type ModelOutput,
  plainText,
  promptTextOf,
  type ResearchModelAdapter,
} from '@markov/research';
import { z } from 'zod';
import { parseJsonObject, unique, type XaiClient, XaiError } from './client.js';

/**
 * Research runs over xAI (B17). The provider receives the canonical prompt
 * text the run hashes for provenance, verbatim, and is asked for one JSON
 * object. Its answer is validated here deterministically (only the run's
 * own source ids and candidate instrument ids survive, statements become
 * bounded plain text) and again by the research service before anything
 * is stored. A model cannot place an order, name a token address as a
 * company, or cite what the run did not read.
 */
export const RESEARCH_SYSTEM_PROMPT = [
  'You draft research notes for a person from the JSON in the user message and nothing else.',
  'Use only its sources; do not invent facts; name companies, never token addresses.',
  'Reply with exactly one JSON object and no other text:',
  '{"statements":[{"text":"<one plain-text inference>","sourceIds":["<id of a source it rests on>"]}],"instrumentIds":["<candidate instrumentId the question or thesis concerns>"],"companies":["<company you mention that matches no candidate>"]}.',
  'sourceIds must be ids from the sources; instrumentIds must be ids from the candidates; keep within the budget.',
  'The person reviews everything; nothing you write places an order.',
].join(' ');

const outputSchema = z.object({
  statements: z
    .array(
      z.object({
        text: z.string().max(4000),
        sourceIds: z.array(z.string().max(120)).max(20).default([]),
      }),
    )
    .max(60)
    .default([]),
  instrumentIds: z.array(z.string().max(120)).max(60).default([]),
  companies: z.array(z.string().max(200)).max(60).default([]),
});

export interface XaiResearchOptions {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export function createXaiResearchAdapter(
  client: XaiClient,
  options: XaiResearchOptions = {},
): ResearchModelAdapter {
  return {
    provider: 'xai',
    model: client.model,
    // xAI publishes no dated model version; the model name is what provenance can record.
    modelVersion: client.model,
    async generate(input: ModelInput): Promise<ModelOutput> {
      const result = await client.chat({
        messages: [
          { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
          { role: 'user', content: promptTextOf(input) },
        ],
        maxOutputTokens:
          options.maxOutputTokens ??
          Math.min(4096, Math.ceil(input.budget.maxOutputChars / 2) + 256),
        temperature: options.temperature ?? 0,
        json: true,
      });
      const object = parseJsonObject(result.text);
      const parsed = object === null ? null : outputSchema.safeParse(object);
      if (parsed === null || !parsed.success) {
        throw new XaiError('malformed', 'the model did not answer with the research JSON object');
      }
      const knownSources = new Set(input.sources.map((source) => source.sourceId));
      const candidates = new Set(input.candidates.map((candidate) => candidate.instrumentId));
      const statements = parsed.data.statements
        .slice(0, Math.max(0, input.budget.maxStatements))
        .map((statement) => ({
          text: plainText(statement.text, 1000),
          sourceIds: unique(statement.sourceIds.filter((id) => knownSources.has(id))),
        }))
        .filter((statement) => statement.text.length > 0);
      const instrumentIds = unique(parsed.data.instrumentIds.filter((id) => candidates.has(id)));
      const companies = unique(
        parsed.data.companies
          .map((company) => plainText(company, 120))
          .filter((company) => company.length > 0),
      );
      return {
        statements,
        instrumentIds,
        companies,
        outputChars: statements.reduce((sum, statement) => sum + statement.text.length, 0),
      };
    },
  };
}
