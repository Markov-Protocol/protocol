#!/usr/bin/env node
/**
 * Check the release status manifest against the sources it summarises.
 *
 *   node tooling/release/status.mjs --check      (exit 1 with every problem)
 *   node tooling/release/status.mjs --summary    (markdown summary on stdout)
 *
 * `docs/markov/release-status.json` is a reviewed, descriptive record: which
 * sessions landed in which commits, the state of every capability and its
 * evidence, the release gates and the mainnet checklist, the open decisions,
 * the deployments that exist and the CI runs that were observed. It grants
 * nothing: no runtime package may read it (checked here), capability rows in
 * the database and configuration decide what runs, and a gate moves only
 * when its evidence is reviewed. This check keeps the record from drifting:
 * capability ids and states must equal the contract and the migration seeds
 * and the reviewed table in provider-capabilities.md; decisions, gates and
 * checklist rows must match their documents; every session log must be
 * listed; cited commits must be on this branch with the recorded subject;
 * cited evidence files must exist. Requires `pnpm build` (it imports the
 * built capability modules) and the git history of the branch.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANIFEST_PATH = 'docs/markov/release-status.json';

const TOP_LEVEL_KEYS = [
  '$comment',
  'schemaVersion',
  'kind',
  'notice',
  'grantsCapabilities',
  'asOf',
  'review',
  'repository',
  'branch',
  'historyRewrite',
  'sessions',
  'plannedSessions',
  'capabilities',
  'gates',
  'checklist',
  'openDecisions',
  'deployments',
  'ci',
];
const CAPABILITY_STATES = [
  'IMPLEMENTED',
  'FIXTURE_VERIFIED',
  'LIVE_READ_VERIFIED',
  'LIVE_WRITE_VERIFIED',
  'BLOCKED',
  'DISABLED',
];
export const GATE_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  blocked: 'Blocked',
  disabled: 'Disabled by design',
};
export const CHECKLIST_LABELS = { not_met: 'Not met', partly_met: 'Partly met', met: 'Met' };
const SESSION_STATUSES = ['complete', 'in_progress', 'closed_partial'];
const PLANNED_STATUSES = ['not_started', 'in_progress', 'complete', 'blocked'];
const DECISION_STATUSES = ['open', 'partly_decided', 'decided'];
const DEPLOYMENT_STATES = ['deployed', 'not_deployed', 'prepared'];
const FULL_SHA = /^[0-9a-f]{40}$/;
const SESSION_ID = /^[A-Z]\d{2}$/;

function isRepoPath(value) {
  return typeof value === 'string' && !/^[a-z]+:\/\//i.test(value);
}

/** Cells of a markdown table row, trimmed, with surrounding backticks removed. */
export function tableCells(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/^`(.*)`$/, '$1'));
}

/** First-cell -> row cells for every table row of a markdown document. */
export function tableRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    if (!/^\s*\|/.test(line) || /^\s*\|\s*-{3,}/.test(line)) {
      continue;
    }
    const cells = tableCells(line);
    if (cells.length > 1 && !rows.has(cells[0])) {
      rows.set(cells[0], cells);
    }
  }
  return rows;
}

/**
 * Pure check of a manifest against gathered sources. Returns every problem
 * found; an empty list means the manifest agrees with its sources.
 */
export function checkManifest(manifest, sources) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['the manifest is not a JSON object'];
  }
  for (const key of Object.keys(manifest)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      fail(`unknown top-level key "${key}"`);
    }
  }
  for (const key of TOP_LEVEL_KEYS.filter((k) => k !== '$comment')) {
    if (!(key in manifest)) {
      fail(`missing top-level key "${key}"`);
    }
  }
  if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (manifest.kind !== 'markov-release-status') fail('kind must be "markov-release-status"');
  if (manifest.grantsCapabilities !== false) {
    fail('grantsCapabilities must be false: the manifest describes, it never authorizes');
  }
  if (typeof manifest.notice !== 'string' || !/grants? no/i.test(manifest.notice)) {
    fail('notice must state that the manifest grants nothing');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(manifest.asOf))) fail('asOf must be a YYYY-MM-DD date');

  const review = manifest.review ?? {};
  if (!['unreviewed', 'reviewed'].includes(review.state)) {
    fail('review.state must be "unreviewed" or "reviewed"');
  } else if (review.state === 'reviewed' && (!review.reviewer || !review.reviewedAt)) {
    fail('a reviewed manifest names its reviewer and review date');
  } else if (review.state === 'unreviewed' && (review.reviewer || review.reviewedAt)) {
    fail('an unreviewed manifest names no reviewer');
  }

  const checkEvidence = (where, evidence) => {
    if (!Array.isArray(evidence)) {
      fail(`${where}: evidence must be a list`);
      return;
    }
    for (const item of evidence) {
      if (typeof item !== 'string' || item.length === 0) {
        fail(`${where}: evidence entries are non-empty strings`);
      } else if (isRepoPath(item)) {
        const path = item.split('#')[0];
        if (!sources.exists(path)) fail(`${where}: evidence file ${path} does not exist`);
      } else if (!item.startsWith('https://')) {
        fail(`${where}: evidence URL ${item} must use https`);
      }
    }
  };
  const checkCommit = (where, sha, subject) => {
    if (!FULL_SHA.test(String(sha))) {
      fail(`${where}: commit must be a full 40-character hash`);
      return;
    }
    if (!sources.git) {
      fail(`${where}: git history is unavailable, commit ${sha.slice(0, 12)} cannot be checked`);
      return;
    }
    if (!sources.git.isAncestor(sha)) {
      fail(`${where}: commit ${sha.slice(0, 12)} is not on this branch`);
      return;
    }
    if (subject !== undefined && sources.git.subject(sha) !== subject) {
      fail(
        `${where}: commit ${sha.slice(0, 12)} has subject "${sources.git.subject(sha)}", not "${subject}"`,
      );
    }
  };

  // Decisions first: capabilities cite them.
  const decisions = Array.isArray(manifest.openDecisions) ? manifest.openDecisions : [];
  const decisionIds = new Set();
  for (const decision of decisions) {
    if (!/^OD-\d{2}$/.test(String(decision.id)))
      fail(`open decision id "${decision.id}" is malformed`);
    if (decisionIds.has(decision.id)) fail(`open decision ${decision.id} is listed twice`);
    decisionIds.add(decision.id);
    if (!DECISION_STATUSES.includes(decision.status))
      fail(`${decision.id}: status must be one of ${DECISION_STATUSES.join(', ')}`);
    if (typeof decision.summary !== 'string' || decision.summary.length === 0)
      fail(`${decision.id}: summary is required`);
  }
  for (const id of sources.openDecisionIds) {
    if (!decisionIds.has(id)) fail(`${id} is in open-decisions.md but not in the manifest`);
  }
  for (const id of decisionIds) {
    if (!sources.openDecisionIds.includes(id))
      fail(`${id} is in the manifest but not in open-decisions.md`);
  }

  // Capabilities: same ids and order as the contract, same state as the seed and the reviewed table.
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const listed = capabilities.map((capability) => capability.id);
  if (listed.join(',') !== sources.capabilityIds.join(',')) {
    fail(`capability ids must equal CAPABILITY_IDS in order; manifest has [${listed.join(', ')}]`);
  }
  for (const capability of capabilities) {
    const where = `capability ${capability.id}`;
    if (!CAPABILITY_STATES.includes(capability.state))
      fail(`${where}: unknown state ${capability.state}`);
    const seeded = sources.seedStates.get(capability.id);
    if (seeded !== undefined && seeded !== capability.state) {
      fail(`${where}: manifest says ${capability.state}, the migration seed says ${seeded}`);
    }
    const reviewed = sources.providerTable.get(capability.id);
    if (reviewed === undefined) {
      fail(`${where}: no row in docs/markov/provider-capabilities.md`);
    } else if (reviewed !== capability.state) {
      fail(
        `${where}: manifest says ${capability.state}, provider-capabilities.md says ${reviewed}`,
      );
    }
    checkEvidence(where, capability.evidence);
    for (const blocker of capability.blockedBy ?? []) {
      if (!decisionIds.has(blocker)) fail(`${where}: blockedBy ${blocker} is not an open decision`);
    }
    if (
      capability.state === 'BLOCKED' &&
      (capability.blockedBy ?? []).length === 0 &&
      !capability.blocker
    ) {
      fail(`${where}: a BLOCKED capability names what blocks it (blockedBy or blocker)`);
    }
  }

  // Gates and checklist rows mirror release-readiness.md.
  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  for (const gate of gates) {
    const where = `gate "${gate.name}"`;
    if (!(gate.status in GATE_LABELS)) {
      fail(`${where}: status must be one of ${Object.keys(GATE_LABELS).join(', ')}`);
      continue;
    }
    const row = sources.readinessRows.get(gate.name);
    if (!row) {
      fail(`${where}: no row in docs/markov/release-readiness.md`);
    } else if (!row[row.length - 1].startsWith(GATE_LABELS[gate.status])) {
      fail(
        `${where}: release-readiness.md status "${row[row.length - 1]}" does not start with "${GATE_LABELS[gate.status]}"`,
      );
    }
    checkEvidence(where, gate.evidence ?? []);
  }
  const checklist = Array.isArray(manifest.checklist) ? manifest.checklist : [];
  for (const item of checklist) {
    const where = `checklist ${item.id}`;
    if (!/^RC-\d{2}$/.test(String(item.id))) fail(`${where}: id must look like RC-01`);
    if (!(item.status in CHECKLIST_LABELS)) {
      fail(`${where}: status must be one of ${Object.keys(CHECKLIST_LABELS).join(', ')}`);
      continue;
    }
    const row = sources.readinessRows.get(item.id);
    if (!row) {
      fail(`${where}: no row in docs/markov/release-readiness.md`);
    } else if (!row[row.length - 1].startsWith(CHECKLIST_LABELS[item.status])) {
      fail(
        `${where}: release-readiness.md status "${row[row.length - 1]}" does not start with "${CHECKLIST_LABELS[item.status]}"`,
      );
    }
    if (item.status === 'met' && (item.evidence ?? []).length === 0)
      fail(`${where}: a met item cites its evidence`);
    checkEvidence(where, item.evidence ?? []);
  }

  // Sessions: every log listed, commits on this branch with their recorded subject.
  const sessions = Array.isArray(manifest.sessions) ? manifest.sessions : [];
  const sessionIds = new Set();
  let pendingBindings = 0;
  for (const session of sessions) {
    const where = `session ${session.id}`;
    if (!SESSION_ID.test(String(session.id))) fail(`${where}: id must look like B01`);
    if (sessionIds.has(session.id)) fail(`${where}: listed twice`);
    sessionIds.add(session.id);
    if (!SESSION_STATUSES.includes(session.status))
      fail(`${where}: status must be one of ${SESSION_STATUSES.join(', ')}`);
    if (!sources.exists(String(session.log))) fail(`${where}: log ${session.log} does not exist`);
    for (const [index, commit] of (session.commits ?? []).entries()) {
      checkCommit(`${where} commit ${index + 1}`, commit.sha, commit.subject);
      if (commit.preRewriteSha !== undefined && !FULL_SHA.test(String(commit.preRewriteSha))) {
        fail(`${where} commit ${index + 1}: preRewriteSha must be a full hash`);
      }
    }
    if (session.bindsTo !== undefined) {
      if (session.bindsTo !== 'next-manifest-update')
        fail(`${where}: bindsTo may only be "next-manifest-update"`);
      pendingBindings += 1;
    }
    if (
      session.status === 'complete' &&
      (session.commits ?? []).length === 0 &&
      session.bindsTo === undefined
    ) {
      fail(`${where}: a complete session cites its commit, or binds to the next manifest update`);
    }
  }
  if (pendingBindings > 1)
    fail('only the newest session may wait for the next manifest update to bind its commit');
  for (const log of sources.sessionLogs) {
    const id = log.replace(/^.*\//, '').replace(/\.md$/, '');
    if (!sessionIds.has(id)) fail(`session log ${log} is not listed in the manifest`);
  }

  const planned = Array.isArray(manifest.plannedSessions) ? manifest.plannedSessions : [];
  const plannedIds = new Set();
  for (const item of planned) {
    const where = `planned session ${item.id}`;
    if (!SESSION_ID.test(String(item.id))) fail(`${where}: id must look like P02`);
    if (plannedIds.has(item.id)) fail(`${where}: listed twice`);
    plannedIds.add(item.id);
    if (!PLANNED_STATUSES.includes(item.status))
      fail(`${where}: status must be one of ${PLANNED_STATUSES.join(', ')}`);
    if (item.status === 'complete' && !sessionIds.has(item.id))
      fail(`${where}: complete without a session record`);
  }

  // Deployments: a deployed component has a verified https URL and evidence; nothing else claims to be live.
  const deployments = Array.isArray(manifest.deployments) ? manifest.deployments : [];
  for (const deployment of deployments) {
    const where = `deployment ${deployment.id}`;
    if (!DEPLOYMENT_STATES.includes(deployment.state))
      fail(`${where}: state must be one of ${DEPLOYMENT_STATES.join(', ')}`);
    if (deployment.state === 'deployed') {
      if (!String(deployment.url).startsWith('https://'))
        fail(`${where}: a deployed component has an https URL`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deployment.verifiedAt)))
        fail(`${where}: verifiedAt date required`);
      if ((deployment.evidence ?? []).length === 0) fail(`${where}: evidence required`);
    }
    checkEvidence(where, deployment.evidence ?? []);
    if (deployment.equivalentCommit !== undefined)
      checkCommit(`${where} equivalentCommit`, deployment.equivalentCommit);
  }

  const runs = Array.isArray(manifest.ci?.observedRuns) ? manifest.ci.observedRuns : [];
  if (!sources.exists(String(manifest.ci?.workflow)))
    fail(`ci.workflow ${manifest.ci?.workflow} does not exist`);
  for (const run of runs) {
    const where = `CI run ${run.runId}`;
    if (!String(run.url).startsWith('https://github.com/'))
      fail(`${where}: url must be a github.com run URL`);
    if (!['success', 'failure', 'cancelled'].includes(run.conclusion))
      fail(`${where}: conclusion must be success, failure or cancelled`);
    checkCommit(where, run.commit);
  }

  for (const file of sources.runtimeReferences) {
    fail(
      `${file} references ${MANIFEST_PATH}; runtime code must never read the release status manifest`,
    );
  }
  return problems;
}

function runtimeReferences(root) {
  const hits = [];
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.next', 'build', '.docusaurus'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(path);
      } else if (
        /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) &&
        readFileSync(path, 'utf8').includes('release-status.json')
      ) {
        hits.push(path.slice(root.length + 1));
      }
    }
  };
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'docs') scan(join(base, entry.name, 'src'));
    }
  }
  return hits;
}

/** Collect every source the check compares against, from the repository at root. */
export async function gatherSources(root) {
  const contracts = join(root, 'packages/contracts/dist/capabilities.js');
  const seeds = join(root, 'packages/db/dist/capabilities.js');
  if (!existsSync(contracts) || !existsSync(seeds)) {
    throw new Error('built capability modules are missing; run `pnpm build` first');
  }
  const { CAPABILITY_IDS } = await import(pathToFileURL(contracts).href);
  const { BASELINE_CAPABILITY_READINESS } = await import(pathToFileURL(seeds).href);
  const providerTable = new Map();
  for (const [first, cells] of tableRows(
    readFileSync(join(root, 'docs/markov/provider-capabilities.md'), 'utf8'),
  )) {
    if (cells.length >= 2 && /^[a-z]+\.[a-z0-9.-]+$/.test(first))
      providerTable.set(first, cells[1]);
  }
  const openDecisionIds = [
    ...tableRows(readFileSync(join(root, 'docs/markov/open-decisions.md'), 'utf8')).keys(),
  ].filter((id) => /^OD-\d{2}$/.test(id));
  const sessionLogs = readdirSync(join(root, 'docs/sessions'))
    .filter((name) => /^[A-Z]\d{2}\.md$/.test(name))
    .map((name) => `docs/sessions/${name}`)
    .sort();
  let git = null;
  try {
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: 'ignore' });
    git = {
      isAncestor(sha) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
            cwd: root,
            stdio: 'ignore',
          });
          return true;
        } catch {
          return false;
        }
      },
      subject(sha) {
        return execFileSync('git', ['log', '-1', '--format=%s', sha], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
      },
    };
  } catch {
    git = null;
  }
  return {
    capabilityIds: [...CAPABILITY_IDS],
    seedStates: new Map(BASELINE_CAPABILITY_READINESS.map((row) => [row.capability, row.status])),
    providerTable,
    openDecisionIds,
    readinessRows: tableRows(readFileSync(join(root, 'docs/markov/release-readiness.md'), 'utf8')),
    sessionLogs,
    exists: (path) => existsSync(join(root, path)),
    git,
    runtimeReferences: runtimeReferences(root),
  };
}

export function summaryMarkdown(manifest) {
  const count = (list, key) => {
    const counts = {};
    for (const item of list) {
      counts[item[key]] = (counts[item[key]] ?? 0) + 1;
    }
    return counts;
  };
  const lines = [
    `# Release status (${manifest.asOf}, ${manifest.review.state})`,
    '',
    manifest.notice,
    '',
    '| Capability | State |',
    '| ---------- | ----- |',
    ...manifest.capabilities.map((c) => `| ${c.id} | ${c.state} |`),
    '',
    '| Gate | Status |',
    '| ---- | ------ |',
    ...manifest.gates.map((g) => `| ${g.name} | ${GATE_LABELS[g.status]} |`),
    '',
    `Checklist: ${JSON.stringify(count(manifest.checklist, 'status'))}. Decisions: ${JSON.stringify(count(manifest.openDecisions, 'status'))}.`,
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const mode = process.argv[2] ?? '--check';
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
  } catch (error) {
    process.stderr.write(`release status: cannot read ${MANIFEST_PATH}: ${error.message}\n`);
    process.exit(2);
  }
  if (mode === '--summary') {
    process.stdout.write(summaryMarkdown(manifest));
    process.exit(0);
  }
  let sources;
  try {
    sources = await gatherSources(root);
  } catch (error) {
    process.stderr.write(`release status: ${error.message}\n`);
    process.exit(2);
  }
  const problems = checkManifest(manifest, sources);
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.stdout.write(
    `release status: ${manifest.capabilities?.length ?? 0} capabilities, ${manifest.sessions?.length ?? 0} sessions, ${manifest.gates?.length ?? 0} gates, ${manifest.checklist?.length ?? 0} checklist items: ${problems.length} problem(s)\n`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}
