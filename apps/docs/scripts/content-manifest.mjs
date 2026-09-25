/**
 * The publication manifest (apps/docs/content-manifest.json): which
 * repository documents markov.pet/docs publishes, where, for whom, and
 * whether they are curated or generated. Nothing outside it is published.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
export const ROOT = resolve(here, '..', '..', '..');
export const MANIFEST_PATH = 'apps/docs/content-manifest.json';

export const AUDIENCES = ['user', 'developer', 'operator', 'reviewer'];
const ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const SOURCE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.md$/;

export function readManifest(root = ROOT) {
  return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
}

/**
 * Every problem with a manifest, as sentences; empty when it is sound.
 * `exists(path)` answers whether a repository-relative file exists.
 */
export function manifestProblems(manifest, exists) {
  const problems = [];
  if (manifest?.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof manifest?.repository !== 'string') problems.push('repository is required');
  if (typeof manifest?.maintainedBranch !== 'string') problems.push('maintainedBranch is required');
  const targets = new Set((manifest?.sections ?? []).map((section) => section.target));
  const ids = new Set();
  const sources = new Set();
  const check = (entry, where, idRule) => {
    const label = `${where} ${entry?.id ?? '(no id)'}`;
    if (typeof entry?.id !== 'string' || !ID.test(entry.id)) problems.push(`${label}: invalid id`);
    if (ids.has(entry?.id)) problems.push(`${label}: duplicate id`);
    ids.add(entry?.id);
    if (
      typeof entry?.source !== 'string' ||
      !SOURCE.test(entry.source) ||
      entry.source.includes('..')
    )
      problems.push(`${label}: invalid source path`);
    else if (!exists(entry.source))
      problems.push(
        `${label}: source ${entry.source} does not exist; restore it or remove the entry`,
      );
    if (sources.has(entry?.source)) problems.push(`${label}: ${entry.source} is published twice`);
    sources.add(entry?.source);
    if (!AUDIENCES.includes(entry?.audience))
      problems.push(`${label}: audience must be one of ${AUDIENCES.join(', ')}`);
    if (entry?.kind !== 'curated') problems.push(`${label}: kind must be curated`);
    idRule(entry, label);
  };
  for (const entry of manifest?.sitePages ?? []) {
    check(entry, 'site page', (page, label) => {
      if (page.source !== `apps/docs/docs/${page.id}.md`)
        problems.push(`${label}: a site page's source must be apps/docs/docs/<id>.md`);
      if (
        page.id.startsWith('reference/') ||
        page.id.startsWith('api/') ||
        page.id.startsWith('cli/')
      )
        problems.push(`${label}: reference/, api/ and cli/ are generated at build time`);
    });
  }
  for (const entry of manifest?.pages ?? []) {
    check(entry, 'page', (page, label) => {
      const target = posix.dirname(page.id).replace(/^reference\//, '');
      if (!page.id.startsWith('reference/') || !targets.has(target))
        problems.push(
          `${label}: id must be reference/<section target>/<name> with a declared section`,
        );
      if (page.source.startsWith('apps/docs/'))
        problems.push(`${label}: site pages belong in sitePages`);
    });
  }
  for (const group of manifest?.generated ?? []) {
    const label = `generated ${group?.idPrefix ?? '(no prefix)'}`;
    if (!['api/', 'cli/'].includes(group?.idPrefix)) problems.push(`${label}: unknown prefix`);
    if (group?.kind !== 'generated') problems.push(`${label}: kind must be generated`);
    if (!AUDIENCES.includes(group?.audience)) problems.push(`${label}: invalid audience`);
    for (const path of [group?.generator, ...(group?.inputs ?? [])]) {
      if (typeof path !== 'string' || !exists(path))
        problems.push(`${label}: ${path} does not exist`);
    }
  }
  return problems;
}

/** The manifest, validated against the checkout; throws with every problem listed. */
export function loadManifest(root = ROOT) {
  const manifest = readManifest(root);
  const problems = manifestProblems(manifest, (path) => existsSync(join(root, ...path.split('/'))));
  if (problems.length > 0) {
    throw new Error(`${MANIFEST_PATH} is not sound:\n- ${problems.join('\n- ')}`);
  }
  return manifest;
}

/** Markdown files under apps/docs/docs that Docusaurus would publish but the manifest does not list. */
export function unlistedSitePages(manifest, root = ROOT) {
  const base = join(root, 'apps', 'docs', 'docs');
  const listed = new Set(manifest.sitePages.map((page) => page.id));
  const found = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) {
        if (!prefix && ['reference', 'api', 'cli'].includes(name)) continue;
        walk(path, rel);
      } else if (/\.mdx?$/.test(name) && !listed.has(rel.replace(/\.mdx?$/, ''))) {
        found.push(`apps/docs/docs/${rel}`);
      }
    }
  };
  walk(base, '');
  return found;
}
