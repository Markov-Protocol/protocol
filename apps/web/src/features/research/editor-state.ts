import {
  type EvidenceTopic,
  type InstrumentReference,
  type ResearchSubject,
  type SourceRecord,
  type StatementKind,
  type ThesisRevision,
  type ThesisRevisionInput,
  type ThesisStatement,
  thesisRevisionInputSchema,
} from '@markov/contracts';

/**
 * The thesis editor's form state: the current revision's content as the
 * person edits it. Saving appends an immutable revision through the API,
 * which is the authority on every rule; the checks here only explain the
 * obvious ones before a round trip.
 */
export interface EditorForm {
  readonly title: string;
  readonly claim: string;
  readonly statements: readonly ThesisStatement[];
  readonly counterarguments: readonly string[];
  readonly instruments: readonly InstrumentReference[];
  readonly subjects: readonly ResearchSubject[];
  readonly privateNotes: string;
}

export const EMPTY_FORM: EditorForm = {
  title: '',
  claim: '',
  statements: [],
  counterarguments: [],
  instruments: [],
  subjects: [],
  privateNotes: '',
};

export const STATEMENT_KIND_LABELS: Readonly<Record<StatementKind, string>> = {
  fact: 'Sourced fact',
  issuer_assertion: 'Issuer assertion',
  user_opinion: 'Your opinion',
  model_inference: 'Model interpretation',
};

export const STATEMENT_KIND_HELP: Readonly<Record<StatementKind, string>> = {
  fact: 'Something a fetched source states; cite at least one source.',
  issuer_assertion:
    'What the issuer says about its own product; cite the issuer, legal or filing source.',
  user_opinion: 'Your own view. No source needed; never presented as fact.',
  model_inference: 'Produced by a bounded research run; labelled as such and bound to the run.',
};

export const TOPIC_LABELS: Readonly<Record<EvidenceTopic, string>> = {
  general: 'General',
  backing: 'Backing',
  rights: 'Rights',
  fees: 'Fees',
  redemption: 'Redemption',
};

/** Topics whose claims must rest on issuer, legal or filing evidence rather than memory. */
export const EVIDENCE_REQUIRED_TOPICS: ReadonlySet<EvidenceTopic> = new Set([
  'backing',
  'rights',
  'fees',
  'redemption',
]);

export function formFromRevision(revision: ThesisRevision): EditorForm {
  return {
    title: revision.title,
    claim: revision.claim,
    statements: revision.statements,
    counterarguments: revision.counterarguments,
    instruments: revision.instruments,
    subjects: revision.subjects,
    privateNotes: revision.privateNotes ?? '',
  };
}

export function revisionInputFromForm(form: EditorForm): ThesisRevisionInput {
  return thesisRevisionInputSchema.parse({
    title: form.title.trim(),
    claim: form.claim.trim(),
    statements: form.statements.map((statement) => ({
      ...statement,
      text: statement.text.trim(),
    })),
    counterarguments: form.counterarguments
      .map((text) => text.trim())
      .filter((text) => text !== ''),
    instruments: form.instruments,
    subjects: form.subjects,
    privateNotes: form.privateNotes.trim() === '' ? null : form.privateNotes.trim(),
  });
}

/** True when the form no longer matches the revision it was loaded from. */
export function isDirty(form: EditorForm, saved: EditorForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(saved);
}

let counter = 0;
/** Statement ids are local labels (≤ 40 chars) that stay stable across saves. */
export function newStatementId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface FormIssue {
  readonly fieldId: string;
  readonly message: string;
}

const MARKUP = /[<>]/;

/** Rules that would certainly be refused by the API, explained before the round trip. */
export function checkForm(form: EditorForm, sources: readonly SourceRecord[]): FormIssue[] {
  const issues: FormIssue[] = [];
  const fetched = new Set(
    sources.filter((source) => source.status === 'fetched').map((source) => source.sourceId),
  );
  if (form.title.trim() === '') {
    issues.push({ fieldId: 'thesis-title', message: 'Give the thesis a title.' });
  }
  if (form.claim.trim() === '') {
    issues.push({ fieldId: 'thesis-claim', message: 'State the claim you are researching.' });
  }
  for (const [field, value] of [
    ['thesis-title', form.title],
    ['thesis-claim', form.claim],
    ['thesis-private-notes', form.privateNotes],
  ] as const) {
    if (MARKUP.test(value)) {
      issues.push({ fieldId: field, message: 'Markup (< or >) is not allowed; write plain text.' });
    }
  }
  form.statements.forEach((statement, index) => {
    const fieldId = `statement-${index}-text`;
    if (statement.text.trim() === '') {
      issues.push({ fieldId, message: `Statement ${index + 1} is empty.` });
    } else if (MARKUP.test(statement.text)) {
      issues.push({ fieldId, message: `Statement ${index + 1}: markup is not allowed.` });
    }
    const cited = statement.sourceIds.filter((id) => fetched.has(id));
    if (
      (statement.kind === 'fact' || statement.kind === 'issuer_assertion') &&
      cited.length === 0
    ) {
      issues.push({
        fieldId: `statement-${index}-sources`,
        message: `Statement ${index + 1}: a ${STATEMENT_KIND_LABELS[statement.kind].toLowerCase()} must cite at least one fetched source.`,
      });
    }
    if (statement.kind === 'model_inference' && statement.runId === null) {
      issues.push({
        fieldId,
        message: `Statement ${index + 1}: a model interpretation must come from a research run.`,
      });
    }
  });
  return issues;
}

/** Map the API's `details[].path` (e.g. `statements/0`) onto editor field ids. */
export function issuesFromApiDetails(
  details: readonly { readonly path: string; readonly message: string }[],
): FormIssue[] {
  return details.map((detail) => {
    const statement = /^statements\/(\d+)/.exec(detail.path);
    if (statement) {
      return { fieldId: `statement-${statement[1]}-text`, message: detail.message };
    }
    const subject = /^subjects\/(\d+)/.exec(detail.path);
    if (subject) {
      return { fieldId: `subject-${subject[1]}`, message: detail.message };
    }
    const instrument = /^instruments\/(\d+)/.exec(detail.path);
    if (instrument) {
      return { fieldId: `instrument-${instrument[1]}`, message: detail.message };
    }
    if (detail.path === 'title' || detail.path === 'claim' || detail.path === 'privateNotes') {
      return {
        fieldId: detail.path === 'privateNotes' ? 'thesis-private-notes' : `thesis-${detail.path}`,
        message: detail.message,
      };
    }
    return { fieldId: 'thesis-title', message: `${detail.path}: ${detail.message}` };
  });
}

/**
 * A starting allocation for a shortlist: equal integer basis points per
 * leg, the remainder held as cash so the total is exactly 10,000. Nothing
 * is rounded away; the person changes every weight in the builder (F07).
 */
export function equalWeightsWithCashRemainder(legs: number): {
  readonly weightBps: number;
  readonly cashWeightBps: number;
} {
  if (!Number.isInteger(legs) || legs <= 0) {
    throw new RangeError('at least one leg is needed');
  }
  const weightBps = Math.floor(10_000 / legs);
  return { weightBps, cashWeightBps: 10_000 - weightBps * legs };
}

/** Only https destinations are ever offered as links; everything else is shown as text. */
export function safeExternalHref(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
