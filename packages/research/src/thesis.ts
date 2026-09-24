import { createHash } from 'node:crypto';
import { companyKey, type SourceRole, type ThesisRevisionInput } from '@markov/contracts';

/**
 * Rules that make a thesis honest: facts and issuer assertions rest on
 * fetched sources, claims about backing, rights, fees or redemption rest on
 * issuer, legal or filing evidence, model inferences name their run, and
 * instruments are admitted catalog ids. Companies the catalog does not
 * carry are research subjects.
 */
export interface RevisionIssue {
  readonly path: string;
  readonly message: string;
}

export interface KnownInstrument {
  readonly instrumentId: string;
  readonly companyName: string;
  readonly status: 'admitted' | 'paused' | string;
}

export interface KnownSource {
  readonly sourceId: string;
  readonly role: SourceRole;
  readonly status: 'fetched' | 'blocked' | 'failed';
}

export interface RevisionContext {
  readonly instruments: ReadonlyMap<string, KnownInstrument>;
  readonly sources: ReadonlyMap<string, KnownSource>;
  readonly runIds: ReadonlySet<string>;
}

const EVIDENCE_ROLES = new Set<SourceRole>(['issuer', 'legal', 'filing']);
const EVIDENCE_TOPICS = new Set(['backing', 'rights', 'fees', 'redemption']);

export function validateRevision(
  input: ThesisRevisionInput,
  context: RevisionContext,
): RevisionIssue[] {
  const issues: RevisionIssue[] = [];
  const seenStatements = new Set<string>();
  input.statements.forEach((statement, index) => {
    const path = `statements/${index}`;
    if (seenStatements.has(statement.statementId)) {
      issues.push({ path, message: `duplicate statement id ${statement.statementId}` });
    }
    seenStatements.add(statement.statementId);
    const cited = statement.sourceIds.map((id) => context.sources.get(id));
    statement.sourceIds.forEach((id, sourceIndex) => {
      const source = context.sources.get(id);
      if (!source) {
        issues.push({ path: `${path}/sourceIds/${sourceIndex}`, message: `unknown source ${id}` });
      } else if (source.status !== 'fetched') {
        issues.push({
          path: `${path}/sourceIds/${sourceIndex}`,
          message: `source ${id} was ${source.status}; cite a fetched source`,
        });
      }
    });
    if (
      (statement.kind === 'fact' || statement.kind === 'issuer_assertion') &&
      statement.sourceIds.length === 0
    ) {
      issues.push({
        path,
        message: `a ${statement.kind.replace('_', ' ')} must cite at least one source`,
      });
    }
    if (statement.kind === 'issuer_assertion' && EVIDENCE_TOPICS.has(statement.topic)) {
      const evidenced = cited.some(
        (source) =>
          source !== undefined && source.status === 'fetched' && EVIDENCE_ROLES.has(source.role),
      );
      if (!evidenced) {
        issues.push({
          path,
          message: `a claim about ${statement.topic} must cite an issuer, legal or filing source`,
        });
      }
    }
    if (statement.kind === 'model_inference') {
      if (statement.runId === null) {
        issues.push({
          path,
          message: 'a model inference must name the research run that produced it',
        });
      } else if (!context.runIds.has(statement.runId)) {
        issues.push({ path: `${path}/runId`, message: `unknown research run ${statement.runId}` });
      }
    } else if (statement.runId !== null) {
      issues.push({ path: `${path}/runId`, message: `only model inferences carry a run id` });
    }
  });
  const seenInstruments = new Set<string>();
  const instrumentCompanies = new Set<string>();
  input.instruments.forEach((reference, index) => {
    const path = `instruments/${index}`;
    if (seenInstruments.has(reference.instrumentId)) {
      issues.push({ path, message: `instrument ${reference.instrumentId} is referenced twice` });
    }
    seenInstruments.add(reference.instrumentId);
    const instrument = context.instruments.get(reference.instrumentId);
    if (!instrument) {
      issues.push({
        path,
        message: `instrument ${reference.instrumentId} is not in the admitted catalog`,
      });
      return;
    }
    if (instrument.status !== 'admitted' && instrument.status !== 'paused') {
      issues.push({
        path,
        message: `instrument ${reference.instrumentId} is ${instrument.status}; only admitted or paused instruments can be referenced`,
      });
    }
    instrumentCompanies.add(companyKey(instrument.companyName));
  });
  const seenSubjects = new Set<string>();
  input.subjects.forEach((subject, index) => {
    const key = companyKey(subject.name);
    const path = `subjects/${index}`;
    if (key === '') {
      issues.push({ path, message: 'subject name is empty after normalisation' });
      return;
    }
    if (seenSubjects.has(key)) {
      issues.push({ path, message: `subject ${subject.name} is listed twice` });
    }
    seenSubjects.add(key);
    if (instrumentCompanies.has(key)) {
      issues.push({
        path,
        message: `${subject.name} is already referenced through an admitted instrument`,
      });
    }
  });
  return issues;
}

/** Deterministic JSON (sorted keys) of everything public in a revision; private notes are excluded. */
export function canonicalRevision(input: ThesisRevisionInput): string {
  const publicContent = {
    title: input.title,
    claim: input.claim,
    statements: input.statements.map((statement) => ({
      statementId: statement.statementId,
      kind: statement.kind,
      topic: statement.topic,
      text: statement.text,
      sourceIds: [...statement.sourceIds].sort(),
      runId: statement.runId,
    })),
    counterarguments: input.counterarguments,
    instruments: [...input.instruments].sort((a, b) =>
      a.instrumentId.localeCompare(b.instrumentId),
    ),
    subjects: [...input.subjects].sort((a, b) => a.name.localeCompare(b.name)),
  };
  return JSON.stringify(publicContent, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}

export function contentHashOf(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}
