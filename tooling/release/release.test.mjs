import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { digestDirectory } from './digest.mjs';
import { buildRecord, conclude, inventory, parseJobs } from './evidence.mjs';
import {
  extractEmbeddedZips,
  readZip,
  redactDirectory,
  redactEmbeddedZips,
  redactText,
  redactZip,
  verifyDirectory,
  writeZip,
} from './redact.mjs';
import { checkManifest, tableRows } from './status.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'markov-release-'));
}

// Credential-shaped samples are assembled at runtime so no secret-looking literal sits in the source.
const SESSION = ['mkv', 'ss', 'A1b2C3d4E5f6G7h8'].join('_');
const JWT = ['eyJhbGciOiJFUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTEifQ', 'c2lnbmF0dXJlLWJ5dGVz'].join('.');

describe('evidence redaction', () => {
  it('redacts credential values and keeps the surrounding text readable', () => {
    const input = [
      `Authorization: Bearer ${SESSION}`,
      `session ${SESSION} issued`,
      `token ${JWT}`,
      'postgres://markov:hunter22@127.0.0.1:5432/markov_test',
      'cookie: markov_session=abcdef123456; Path=/',
      'it rejects a missing authorization header',
    ].join('\n');
    const { text, counts } = redactText(input);
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('hunter22');
    expect(text).not.toContain('abcdef123456');
    expect(text).toContain('Authorization: [redacted]');
    expect(text).toContain('session mkv_ss_[redacted] issued');
    expect(text).toContain('postgres://markov:[redacted]@127.0.0.1:5432/markov_test');
    expect(text).toContain('it rejects a missing authorization header');
    expect(counts['markov-credential']).toBe(2);
    expect(redactText(text).text).toBe(text);
  });

  it('redacts the header shapes a Playwright trace records and values behind colour codes', () => {
    const network = JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        request: {
          headers: [
            { name: 'Cookie', value: `__Host-markov_session=${SESSION}` },
            { name: 'authorization', value: 'Token abcdef123456' },
            { name: 'accept', value: 'application/json' },
          ],
        },
      },
    });
    const escaped = JSON.stringify({ log: network });
    const coloured = `session \x1b[31m${SESSION.replace('mkv_ss_', 'mkv_ss_\x1b[1m')}\x1b[0m and id_${SESSION}`;
    for (const input of [network, escaped, coloured]) {
      const { text } = redactText(input);
      expect(text).not.toContain(SESSION.slice(7));
      expect(text).not.toContain('abcdef123456');
      expect(redactText(text).text).toBe(text);
    }
    expect(redactText(network).text).toContain('{"name":"accept","value":"application/json"}');
    expect(JSON.parse(redactText(network).text).snapshot.request.headers[0].value).toBe(
      '[redacted]',
    );
    expect(
      JSON.parse(JSON.parse(redactText(escaped).text).log).snapshot.request.headers[1].value,
    ).toBe('[redacted]');
  });

  it('redacts the fixture wallet key shape and keeps a JUnit report well formed', () => {
    const key = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'der' })
      .toString('base64');
    const junit = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites><testsuite name="api" tests="1">',
      `<testcase name="signs in"><failure message="cookie: markov_session=${SESSION}; Path=/">`,
      `Authorization: Bearer ${SESSION}</failure>`,
      `<system-out>key ${key} token ${JWT}</system-out></testcase>`,
      '</testsuite></testsuites>',
    ].join('\n');
    const { text, counts } = redactText(junit);
    expect(text).not.toContain(SESSION.slice(7));
    expect(text).not.toContain(key);
    expect(counts['ed25519-pkcs8']).toBe(1);
    const doc = new new JSDOM('').window.DOMParser().parseFromString(text, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagName('testcase')).toHaveLength(1);
    expect(doc.getElementsByTagName('failure')[0]?.getAttribute('message')).toBe(
      'cookie: [redacted]',
    );
  });

  it('rewrites text files, leaves binaries to the secret scan and reports only rule names', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'vitest.log'), `x-api-key: sk-${'z'.repeat(20)}\n`);
    writeFileSync(join(dir, 'tests', 'clean.xml'), '<testsuite name="a"/>');
    writeFileSync(join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const report = redactDirectory(dir);
    expect(report.textFiles).toBe(2);
    expect(report.rewritten).toEqual([
      { path: 'tests/vitest.log', replacements: { 'credential-header': 1 } },
    ]);
    expect(report.notInspected).toEqual([{ path: 'shot.png', bytes: 4 }]);
    expect(readFileSync(join(dir, 'tests', 'vitest.log'), 'utf8')).toBe('x-api-key: [redacted]\n');
    expect(readFileSync(join(dir, 'redaction.json'), 'utf8')).not.toContain('zzzz');
  });
});

/**
 * A trace-shaped archive written by Python's zipfile (a different ZIP implementation): trace.network
 * carries a session cookie, nested.zip carries a session token, screenshot.jpeg is binary.
 */
const PYTHON_TRACE_ZIP = Buffer.from(
  [
    'UEsDBBQAAAAIAEWVOV167VFgSAAAAEoAAAANAAAAdHJhY2UubmV0d29ya6tWykvMTVWyUkrOz8/O',
    'TFXSUSpLzCkFCcTHe+QXl+jmJhZl55fFF6cWF2fm59nmZgPZxfGOhklGzsYpJq6maWbu5hkWSrVc',
    'AFBLAwQUAAAACABFlTldj5WukQkAAAAHAAAADwAAAHNjcmVlbnNob3QuanBlZ/t/4z8DIxMzAFBL',
    'AwQUAAAACABFlTldoHe19XkAAACyAAAACgAAAG5lc3RlZC56aXAL8GZmEWFgYOBgcJ1qGWuznf2e',
    'DpCnBcRCQFyUWpxfWpScWqyfmJSsl1Wcn7c6TMtPV+/cmfPcJ8/7nQ3eFHTqrF63vl5fuYmPUZGZ',
    'n2Ghqa9xsfn5DQGrWBkCvBmZRJhxmw4DDYwMWO0K8GZlA8kwAqEDkI4BqwYAUEsDBBQAAAAIAEWV',
    'OV0AAAAAAgAAAAAAAAAEAAAAZGlyLwMAUEsBAhQDFAAAAAgARZU5XXrtUWBIAAAASgAAAA0AAAAA',
    'AAAAAAAAAIABAAAAAHRyYWNlLm5ldHdvcmtQSwECFAMUAAAACABFlTldj5WukQkAAAAHAAAADwAA',
    'AAAAAAAAAAAAgAFzAAAAc2NyZWVuc2hvdC5qcGVnUEsBAhQDFAAAAAgARZU5XaB3tfV5AAAAsgAA',
    'AAoAAAAAAAAAAAAAAIABqQAAAG5lc3RlZC56aXBQSwECFAMUAAAACABFlTldAAAAAAIAAAAAAAAA',
    'BAAAAAAAAAAAABAA/UFKAQAAZGlyL1BLBQYAAAAABAAEAOIAAABuAQAAAAA=',
  ].join(''),
  'base64',
);

describe('archive redaction', () => {
  it('reads a foreign archive and redacts nested text entries without touching binary ones', () => {
    const names = readZip(PYTHON_TRACE_ZIP).map((entry) => entry.name);
    expect(names).toEqual(['trace.network', 'screenshot.jpeg', 'nested.zip', 'dir/']);
    const { buffer, counts, changed } = redactZip(PYTHON_TRACE_ZIP);
    expect(changed).toBe(true);
    expect(counts).toEqual({ 'markov-credential': 2, 'har-credential-header': 1 });
    const entries = new Map(readZip(buffer).map((entry) => [entry.name, entry.content]));
    expect(entries.get('trace.network')?.toString('utf8')).toBe(
      '{"name":"cookie","value":"[redacted]"}\n',
    );
    expect([...(entries.get('screenshot.jpeg') ?? [])]).toEqual([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]);
    const nested = readZip(entries.get('nested.zip') ?? Buffer.alloc(0));
    expect(nested[0]?.content.toString('utf8')).toBe('{"sessionToken":"mkv_ss_[redacted]"}');
    expect(redactZip(buffer).changed).toBe(false);
  });

  it('round-trips its own archives and leaves clean archives byte for byte', () => {
    const clean = writeZip([{ name: 'a.txt', content: Buffer.from('nothing secret') }]);
    expect(readZip(clean)[0]?.content.toString('utf8')).toBe('nothing secret');
    expect(redactZip(clean).buffer).toBe(clean);
  });

  it('redacts the archive a Playwright HTML report embeds', () => {
    const html = `<html><script id="playwrightReportBase64" type="application/zip">data:application/zip;base64,${PYTHON_TRACE_ZIP.toString('base64')}</script></html>`;
    const result = redactEmbeddedZips(html);
    expect(result.changed).toBe(true);
    const data = /base64,([A-Za-z0-9+/=]+)</.exec(result.html)?.[1] ?? '';
    const network = readZip(Buffer.from(data, 'base64')).find(
      (entry) => entry.name === 'trace.network',
    );
    expect(network?.content.toString('utf8')).not.toContain(SESSION);
    expect(network?.content.toString('utf8')).toContain('"value":"[redacted]"');
  });

  it('extracts embedded report archives so the secret scan can read them', () => {
    const dir = tempDir();
    const out = tempDir();
    mkdirSync(join(dir, 'web-e2e-html'));
    writeFileSync(
      join(dir, 'web-e2e-html', 'index.html'),
      `<script>data:application/zip;base64,${PYTHON_TRACE_ZIP.toString('base64')}</script>`,
    );
    expect(extractEmbeddedZips(dir, out)).toEqual(['web-e2e-html__index.html.embedded-1.zip']);
    expect(readdirSync(out)).toEqual(['web-e2e-html__index.html.embedded-1.zip']);
    expect(readFileSync(join(out, 'web-e2e-html__index.html.embedded-1.zip'))).toEqual(
      PYTHON_TRACE_ZIP,
    );
  });

  it('removes archives it cannot inspect and verifies that nothing credential-shaped remains', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'trace.zip'), PYTHON_TRACE_ZIP);
    writeFileSync(join(dir, 'broken.zip'), Buffer.from('PK\u0005\u0006 not an archive'));
    expect(
      verifyDirectory(dir)
        .map((hit) => `${hit.path} ${hit.rule}`)
        .sort(),
    ).toEqual([
      expect.stringMatching(/^broken\.zip /),
      'trace.zip!nested.zip!resources/abc.json markov-credential',
      'trace.zip!trace.network har-credential-header',
      'trace.zip!trace.network markov-credential',
    ]);
    const report = redactDirectory(dir);
    expect(report.removed.map((item) => item.path)).toEqual(['broken.zip']);
    expect(report.rewritten).toEqual([
      { path: 'trace.zip', replacements: { 'markov-credential': 2, 'har-credential-header': 1 } },
    ]);
    expect(verifyDirectory(dir)).toEqual([]);
  });
});

describe('build digests', () => {
  it('depends on content and paths, not on file order or timestamps', () => {
    const a = tempDir();
    const b = tempDir();
    writeFileSync(join(a, 'one.js'), 'one');
    writeFileSync(join(a, 'two.js'), 'two');
    writeFileSync(join(b, 'two.js'), 'two');
    writeFileSync(join(b, 'one.js'), 'one');
    expect(digestDirectory(a)).toEqual(digestDirectory(b));
    writeFileSync(join(b, 'two.js'), 'changed');
    expect(digestDirectory(a).sha256).not.toBe(digestDirectory(b).sha256);
  });
});

describe('CI evidence record', () => {
  it('concludes success only when every job succeeded in CI', () => {
    const jobs = parseJobs(
      JSON.stringify({ checks: { result: 'success' }, program: { result: 'failure' } }),
    );
    expect(jobs).toEqual([
      { name: 'checks', result: 'success' },
      { name: 'program', result: 'failure' },
    ]);
    expect(conclude(jobs, true)).toBe('failure');
    expect(conclude([{ name: 'a', result: 'success' }], true)).toBe('success');
    expect(conclude([{ name: 'a', result: 'cancelled' }], true)).toBe('incomplete');
    expect(conclude([], true)).toBe('incomplete');
    expect(conclude([{ name: 'a', result: 'success' }], false)).toBe(
      'local-assembly-not-ci-evidence',
    );
  });

  it('inventories artifacts with digests and never passes a local assembly off as a run', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'checks-reports'));
    writeFileSync(join(dir, 'checks-reports', 'redaction.json'), '{}');
    writeFileSync(join(dir, 'checks-reports', 'lint.log'), 'ok');
    const artifacts = inventory(dir);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].redacted).toBe(true);
    expect(artifacts[0].files.map((f) => f.path)).toEqual(['lint.log', 'redaction.json']);
    const local = buildRecord({ dir, jobs: [], env: {}, root: dir });
    expect(local.run).toBeNull();
    expect(local.conclusion).toBe('local-assembly-not-ci-evidence');
    const ci = buildRecord({
      dir,
      jobs: [{ name: 'checks', result: 'success' }],
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_RUN_ID: '42',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SHA: 'a'.repeat(40),
      },
      root: dir,
    });
    expect(ci.run).toEqual({
      id: '42',
      attempt: null,
      url: 'https://github.com/o/r/actions/runs/42',
    });
    expect(ci.conclusion).toBe('success');
    expect(ci.notice).toMatch(/grants no capability/);
  });
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function sources(overrides = {}) {
  return {
    capabilityIds: ['platform.api.health', 'catalog.prestocks.ingest'],
    seedStates: new Map([
      ['platform.api.health', 'IMPLEMENTED'],
      ['catalog.prestocks.ingest', 'BLOCKED'],
    ]),
    providerTable: new Map([
      ['platform.api.health', 'IMPLEMENTED'],
      ['catalog.prestocks.ingest', 'BLOCKED'],
    ]),
    openDecisionIds: ['OD-17'],
    readinessRows: tableRows(
      [
        '| Gate | Evidence | Status |',
        '| --- | --- | --- |',
        '| Local feature completion | x | In progress: sessions B01-B16 |',
        '| RC-01 | Candidate identified | Partly met: CI runs retained |',
      ].join('\n'),
    ),
    sessionLogs: ['docs/sessions/B01.md', 'docs/sessions/P01.md'],
    exists: (path) =>
      [
        'docs/sessions/B01.md',
        'docs/sessions/P01.md',
        '.github/workflows/ci.yml',
        'apps/api/test/app.test.ts',
      ].includes(path),
    git: {
      isAncestor: (sha) => sha === SHA_A,
      subject: () => 'feat(platform): bootstrap stock strategy backend',
    },
    runtimeReferences: [],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'markov-release-status',
    notice: 'Descriptive record; it grants no capability.',
    grantsCapabilities: false,
    asOf: '2026-09-25',
    review: { state: 'unreviewed', reviewer: null, reviewedAt: null },
    repository: 'o/r',
    branch: 'b',
    historyRewrite: null,
    sessions: [
      {
        id: 'B01',
        title: 'Foundation',
        status: 'complete',
        log: 'docs/sessions/B01.md',
        commits: [{ sha: SHA_A, subject: 'feat(platform): bootstrap stock strategy backend' }],
      },
      {
        id: 'P01',
        title: 'Release candidate',
        status: 'complete',
        log: 'docs/sessions/P01.md',
        commits: [],
        bindsTo: 'next-manifest-update',
      },
    ],
    plannedSessions: [{ id: 'P02', title: 'Runtime', status: 'not_started' }],
    capabilities: [
      { id: 'platform.api.health', state: 'IMPLEMENTED', evidence: ['apps/api/test/app.test.ts'] },
      { id: 'catalog.prestocks.ingest', state: 'BLOCKED', evidence: [], blockedBy: ['OD-17'] },
    ],
    gates: [{ name: 'Local feature completion', status: 'in_progress', evidence: [] }],
    checklist: [{ id: 'RC-01', title: 'Candidate', status: 'partly_met', evidence: [] }],
    openDecisions: [{ id: 'OD-17', status: 'open', summary: 'PreStocks feed' }],
    deployments: [],
    ci: { workflow: '.github/workflows/ci.yml', observedRuns: [] },
    ...overrides,
  };
}

describe('release status manifest check', () => {
  it('accepts a manifest that agrees with its sources', () => {
    expect(checkManifest(manifest(), sources())).toEqual([]);
  });

  it('refuses a manifest that claims to grant capabilities or is read by runtime code', () => {
    const problems = checkManifest(
      manifest({ grantsCapabilities: true }),
      sources({ runtimeReferences: ['apps/api/src/boot.ts'] }),
    );
    expect(problems.join('\n')).toMatch(/grantsCapabilities must be false/);
    expect(problems.join('\n')).toMatch(/apps\/api\/src\/boot.ts references/);
  });

  it('refuses a capability state above its seed, its reviewed table or without evidence files', () => {
    const problems = checkManifest(
      manifest({
        capabilities: [
          {
            id: 'platform.api.health',
            state: 'IMPLEMENTED',
            evidence: ['apps/api/test/missing.test.ts'],
          },
          {
            id: 'catalog.prestocks.ingest',
            state: 'LIVE_READ_VERIFIED',
            evidence: [],
            blockedBy: ['OD-99'],
          },
        ],
      }),
      sources(),
    );
    const text = problems.join('\n');
    expect(text).toMatch(/missing.test.ts does not exist/);
    expect(text).toMatch(/manifest says LIVE_READ_VERIFIED, the migration seed says BLOCKED/);
    expect(text).toMatch(/provider-capabilities.md says BLOCKED/);
    expect(text).toMatch(/blockedBy OD-99 is not an open decision/);
  });

  it('refuses commits that are not on the branch or carry another subject, and unlisted session logs', () => {
    const problems = checkManifest(
      manifest({
        sessions: [
          {
            id: 'B01',
            title: 'Foundation',
            status: 'complete',
            log: 'docs/sessions/B01.md',
            commits: [{ sha: SHA_B, subject: 'feat(platform): bootstrap stock strategy backend' }],
          },
        ],
      }),
      sources(),
    );
    const text = problems.join('\n');
    expect(text).toMatch(/is not on this branch/);
    expect(text).toMatch(/session log docs\/sessions\/P01.md is not listed/);
  });

  it('keeps gates and checklist rows in step with release-readiness.md', () => {
    const problems = checkManifest(
      manifest({
        gates: [{ name: 'Local feature completion', status: 'complete', evidence: [] }],
        checklist: [{ id: 'RC-01', title: 'Candidate', status: 'met', evidence: [] }],
      }),
      sources(),
    );
    const text = problems.join('\n');
    expect(text).toMatch(/does not start with "Complete"/);
    expect(text).toMatch(/a met item cites its evidence/);
    expect(text).toMatch(/does not start with "Met"/);
  });

  it('requires a reviewer only for a reviewed manifest and https evidence URLs', () => {
    const problems = checkManifest(
      manifest({
        review: { state: 'reviewed', reviewer: null, reviewedAt: null },
        deployments: [
          {
            id: 'web',
            state: 'deployed',
            url: 'http://example.test',
            evidence: ['http://example.test'],
          },
        ],
      }),
      sources(),
    );
    const text = problems.join('\n');
    expect(text).toMatch(/names its reviewer/);
    expect(text).toMatch(/a deployed component has an https URL/);
    expect(text).toMatch(/evidence URL http:\/\/example.test must use https/);
  });
});
