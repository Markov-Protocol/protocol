import { createHash } from 'node:crypto';
import { companyKey, type SourceRole, type ThesisStatement } from '@markov/contracts';
import { plainText } from './sanitize.js';

/**
 * The bounded model adapter contract. A provider receives only what the
 * run names (the question, the thesis title and claim, excerpts of the
 * chosen sources and the admitted candidates) and returns plain text and
 * identifiers that are validated deterministically afterwards. No tool
 * calls exist in V1; retrieved text never becomes an instruction.
 */
export interface ModelInput {
  readonly question: string;
  readonly thesis: { readonly title: string; readonly claim: string };
  readonly sources: readonly {
    readonly sourceId: string;
    readonly role: SourceRole;
    readonly excerpt: string;
  }[];
  readonly candidates: readonly {
    readonly instrumentId: string;
    readonly symbol: string;
    readonly companyName: string;
    readonly issuer: string;
  }[];
  readonly budget: { readonly maxOutputChars: number; readonly maxStatements: number };
}

export interface ModelOutput {
  readonly statements: readonly { readonly text: string; readonly sourceIds: readonly string[] }[];
  /** Identifiers the model believes are instruments; validated, never trusted. */
  readonly instrumentIds: readonly string[];
  /** Company names the model mentioned. */
  readonly companies: readonly string[];
  readonly outputChars: number;
}

export interface ResearchModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  generate(input: ModelInput): Promise<ModelOutput>;
}

/** Canonical prompt text: the exact bytes a provider would receive, hashed for provenance. */
export function promptTextOf(input: ModelInput): string {
  return JSON.stringify({
    instruction:
      'You are drafting research notes for a person. Use only the sources given. Do not invent facts. Name companies, never token addresses. Output is a draft the person must review; it cannot place orders.',
    question: input.question,
    thesis: input.thesis,
    sources: input.sources,
    candidates: input.candidates.map((candidate) => ({
      instrumentId: candidate.instrumentId,
      symbol: candidate.symbol,
      companyName: candidate.companyName,
      issuer: candidate.issuer,
    })),
    budget: input.budget,
  });
}

export function promptHashOf(input: ModelInput): string {
  return createHash('sha256').update(promptTextOf(input)).digest('hex');
}

const LEADING_STOPWORDS = new Set([
  'is',
  'are',
  'does',
  'do',
  'should',
  'will',
  'can',
  'why',
  'how',
  'what',
  'the',
  'a',
  'an',
  'compare',
  'consider',
  'about',
  'versus',
  'than',
  'and',
  'or',
]);

/** "Is Fixture Aerospace Inc" → "Fixture Aerospace Inc": sentence-initial words are not part of a name. */
function trimLeadingStopwords(name: string): string {
  const words = name.split(/\s+/);
  while (words.length > 1 && LEADING_STOPWORDS.has((words[0] ?? '').toLowerCase())) {
    words.shift();
  }
  return words.join(' ');
}

/**
 * Deterministic stand-in for local and test environments: one inference per
 * source excerpt, candidates named in the question or thesis suggested,
 * "<Name> Inc/Corp/Co" phrases that match no candidate reported as
 * companies. Never contacts a network.
 */
export function createFixtureModelAdapter(): ResearchModelAdapter {
  return {
    provider: 'fixture',
    model: 'fixture-research',
    modelVersion: '2026-09-24',
    async generate(input) {
      const text = `${input.question} ${input.thesis.title} ${input.thesis.claim}`;
      const normalised = ` ${companyKey(text)} `;
      const instrumentIds = input.candidates
        .filter((candidate) => normalised.includes(` ${companyKey(candidate.companyName)} `))
        .map((candidate) => candidate.instrumentId);
      const companies: string[] = [];
      for (const match of text.matchAll(
        /\b([A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*)*\s+(?:Inc|Corp|Corporation|Co|Ltd|Holdings|AG|SA|NV|PLC))\b\.?/g,
      )) {
        const name = trimLeadingStopwords(match[1] ?? '');
        if (name && !companies.includes(name)) {
          companies.push(name);
        }
      }
      const statements = input.sources.map((source) => ({
        text: `According to the ${source.role} source, ${plainText(source.excerpt, 200)}`,
        sourceIds: [source.sourceId],
      }));
      if (statements.length === 0) {
        statements.push({
          text: `No source was attached, so nothing can be inferred about: ${plainText(input.question, 200)}`,
          sourceIds: [],
        });
      }
      return {
        statements,
        instrumentIds,
        companies,
        outputChars: statements.reduce((sum, statement) => sum + statement.text.length, 0),
      };
    },
  };
}

export interface ValidatedOutput {
  readonly draft: ThesisStatement[];
  readonly suggestedInstrumentIds: string[];
  readonly unmatchedCompanies: string[];
  readonly rejected: string[];
  readonly budgetUsed: { readonly outputChars: number; readonly statements: number };
}

/**
 * Deterministic validation of model output: statements become labelled
 * inferences bound to the run and cut to the budget; instrument ids must be
 * admitted or paused candidates; companies that match a candidate are
 * suggested, the rest stay research subjects; everything else is rejected
 * and reported.
 */
export function validateModelOutput(
  output: ModelOutput,
  context: {
    readonly runId: string;
    readonly candidates: ModelInput['candidates'];
    readonly sourceIds: ReadonlySet<string>;
    readonly budget: ModelInput['budget'];
  },
): ValidatedOutput {
  const rejected: string[] = [];
  const candidateIds = new Set(context.candidates.map((candidate) => candidate.instrumentId));
  const byCompany = new Map(
    context.candidates.map((candidate) => [
      companyKey(candidate.companyName),
      candidate.instrumentId,
    ]),
  );
  const suggested = new Set<string>();
  for (const id of output.instrumentIds) {
    if (candidateIds.has(id)) {
      suggested.add(id);
    } else {
      rejected.push(`instrument ${id}`);
    }
  }
  const unmatched: string[] = [];
  for (const company of output.companies) {
    const clean = plainText(company, 120);
    const key = companyKey(clean);
    if (key === '') {
      continue;
    }
    const known = byCompany.get(key);
    if (known) {
      suggested.add(known);
    } else if (!unmatched.includes(clean)) {
      unmatched.push(clean);
    }
  }
  const draft: ThesisStatement[] = [];
  let chars = 0;
  for (const [index, statement] of output.statements.entries()) {
    if (draft.length >= context.budget.maxStatements) {
      rejected.push(`statement ${index}: over the statement budget`);
      continue;
    }
    const text = plainText(statement.text, 2000);
    if (text === '') {
      rejected.push(`statement ${index}: empty after sanitisation`);
      continue;
    }
    if (chars + text.length > context.budget.maxOutputChars) {
      rejected.push(`statement ${index}: over the character budget`);
      continue;
    }
    const sourceIds = statement.sourceIds.filter((id) => context.sourceIds.has(id));
    for (const id of statement.sourceIds) {
      if (!context.sourceIds.has(id)) {
        rejected.push(`statement ${index}: unknown source ${id}`);
      }
    }
    chars += text.length;
    draft.push({
      statementId: `run-${context.runId.slice(0, 8)}-${draft.length + 1}`,
      kind: 'model_inference',
      topic: 'general',
      text,
      sourceIds,
      runId: context.runId,
    });
  }
  return {
    draft,
    suggestedInstrumentIds: [...suggested].sort(),
    unmatchedCompanies: unmatched,
    rejected,
    budgetUsed: { outputChars: chars, statements: draft.length },
  };
}
