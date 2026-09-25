import { createHash } from 'node:crypto';
import type { CompanionBudget, CompanionSource, CompanionUsage } from '@markov/contracts';

/**
 * Redacted provenance (B15). A run records what happened without the text:
 * every tool input and output is stored as a SHA-256 digest of its canonical
 * JSON plus a summary made only of identifiers, enumerations and amounts.
 * Questions, theses, source excerpts and model prose never enter the
 * provenance; the validated answer is the only model text that is kept.
 */

/** Canonical JSON: keys sorted at every depth, no whitespace, bigints as decimal strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}

export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Input fields that may appear in a provenance summary: identifiers, enumerations and amounts, never free text. */
const SUMMARY_KEYS = [
  'instrumentId',
  'instrumentIds',
  'strategyVersionId',
  'walletId',
  'instanceId',
  'decisionId',
  'receiptId',
  'issuer',
  'kind',
  'side',
  'limit',
  'budgetMode',
  'amountRaw',
  'notionalUsdcRaw',
  'slippageBps',
  'cashWeightBps',
] as const;

const MAX_SUMMARY = 200;

/**
 * A bounded, secret-free summary of a tool input. Nested `budget.rawAmount`
 * and `content.legs` are summarised as an amount and a count; anything
 * else (titles, claims, questions, thesis text) is left out by construction.
 */
export function summarizeInput(input: unknown): string {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return '';
  }
  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      parts.push(`${key}=${value.map((entry) => scalar(entry)).join(',')}`);
    } else {
      parts.push(`${key}=${scalar(value)}`);
    }
  }
  const budget = record['budget'];
  if (budget && typeof budget === 'object' && 'rawAmount' in budget) {
    parts.push(`budget.rawAmount=${scalar((budget as Record<string, unknown>)['rawAmount'])}`);
  }
  const content = record['content'];
  if (content && typeof content === 'object') {
    const legs = (content as Record<string, unknown>)['legs'];
    if (Array.isArray(legs)) {
      parts.push(`content.legs=${legs.length}`);
    }
    const cash = (content as Record<string, unknown>)['cashWeightBps'];
    if (typeof cash === 'number') {
      parts.push(`content.cashWeightBps=${cash}`);
    }
  }
  return parts.join(' ').slice(0, MAX_SUMMARY);
}

function scalar(value: unknown): string {
  if (typeof value === 'string') {
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : `#${digestOf(value).slice(0, 12)}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '?';
}

/** What the model may read of a tool output: bounded canonical JSON (a real provider reads JSON as well). */
export function outputTextOf(output: unknown, maxChars: number): string {
  const text = canonicalJson(output);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Things a tool output lets the model cite; anything else it cites is dropped by the loop. */
export function outputRefsOf(tool: string, output: unknown): CompanionSource[] {
  if (output === null || typeof output !== 'object') {
    return [];
  }
  const record = output as Record<string, unknown>;
  const refs: CompanionSource[] = [];
  const instrument = (entry: unknown) => {
    if (entry && typeof entry === 'object') {
      const row = entry as Record<string, unknown>;
      if (typeof row['instrumentId'] === 'string') {
        refs.push({
          kind: 'instrument',
          id: row['instrumentId'],
          label: [row['symbol'], row['companyName'], row['issuer']]
            .filter((part) => typeof part === 'string')
            .join(' · ')
            .slice(0, 200),
        });
      }
    }
  };
  switch (tool) {
    case 'instruments.search':
      for (const entry of asArray(record['instruments'])) {
        instrument(entry);
      }
      break;
    case 'instruments.facts':
      instrument(record['instrument']);
      break;
    case 'exposures.compare':
      for (const entry of asArray(record['rows'])) {
        instrument(entry);
      }
      break;
    case 'thesis.draft': {
      const thesis = record['thesis'];
      if (thesis && typeof thesis === 'object') {
        const id = (thesis as Record<string, unknown>)['thesisId'];
        if (typeof id === 'string') {
          refs.push({ kind: 'thesis', id, label: 'draft thesis' });
        }
      }
      break;
    }
    case 'basket.propose':
    case 'investment.propose':
    case 'rebalance.propose': {
      const id = record['proposalId'];
      if (typeof id === 'string') {
        refs.push({
          kind: 'proposal',
          id,
          label:
            typeof record['summary'] === 'string' ? record['summary'].slice(0, 200) : 'proposal',
        });
      }
      break;
    }
    case 'receipts.read':
      for (const entry of asArray(record['receipts'])) {
        const body = (entry as Record<string, unknown>)['body'];
        const id =
          body && typeof body === 'object' ? (body as Record<string, unknown>)['receiptId'] : null;
        if (typeof id === 'string') {
          refs.push({ kind: 'receipt', id, label: 'receipt' });
        }
      }
      break;
    default:
      break;
  }
  return refs;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** True when a tool output rests on a stale or missing reference price. */
export function outputIsStale(tool: string, output: unknown): boolean {
  if (output === null || typeof output !== 'object') {
    return false;
  }
  const record = output as Record<string, unknown>;
  switch (tool) {
    case 'instruments.facts':
      return record['stale'] === true;
    case 'exposures.compare':
      return asArray(record['stale']).length > 0;
    case 'instruments.search':
      return asArray(record['instruments']).some((entry) => {
        const price = (entry as Record<string, unknown>)['referencePrice'];
        return price === null || (price as Record<string, unknown>)['stale'] === true;
      });
    case 'rebalance.propose': {
      const payload = record['payload'];
      return (
        payload !== null &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>)['stale'] === true
      );
    }
    default:
      return false;
  }
}

export interface BudgetRemaining {
  readonly toolCalls: number;
  readonly outputChars: number;
  readonly costMicros: number;
}

export function remainingOf(budget: CompanionBudget, usage: CompanionUsage): BudgetRemaining {
  return {
    toolCalls: Math.max(0, budget.maxToolCalls - usage.toolCalls),
    outputChars: Math.max(0, budget.maxOutputChars - usage.outputChars),
    costMicros: Math.max(0, budget.maxCostMicros - usage.costMicros),
  };
}

export function emptyUsage(): CompanionUsage {
  return {
    toolCalls: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    durationMs: 0,
  };
}
