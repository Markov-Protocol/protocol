#!/usr/bin/env node
/**
 * Copies the repository documents the content manifest lists
 * (apps/docs/content-manifest.json) into the site (docs/reference/**) with
 * front matter, the manifest's order and rewritten links, and extracts the
 * design tokens for the theme. Nothing the manifest does not list is
 * published, and a listed source that is missing fails the build.
 *
 * It also resolves where this build comes from (scripts/source-metadata.mjs)
 * and writes it to generated/source.json for the generators and the site
 * config: links to source evidence pin that commit, edit links open the
 * maintained branch, and a build without a verified revision says so.
 * Generated output is gitignored; the repository files stay the source of
 * truth.
 *
 *   node apps/docs/scripts/sync-content.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { loadManifest, ROOT, unlistedSitePages } from './content-manifest.mjs';
import { rewriteLinks } from './rewrite-links.mjs';
import { linksFor, resolveSource, writeBuildSource } from './source-metadata.mjs';

const here = dirname(new URL(import.meta.url).pathname);
const root = ROOT;
const siteDocs = resolve(here, '..', 'docs');
const out = join(siteDocs, 'reference');
/** HTML the documents use on purpose; every other `<word>` is a placeholder and is escaped. */
const HTML_ALLOWED = new Set(['pre', 'br', 'details', 'summary', 'sub', 'sup', 'kbd', 'code']);

const manifest = loadManifest(root);
const unlisted = unlistedSitePages(manifest, root);
if (unlisted.length > 0) {
  throw new Error(
    `sync-content: these pages are not in ${'apps/docs/content-manifest.json'} (sitePages) and would be published unreviewed:\n- ${unlisted.join('\n- ')}`,
  );
}
const source = resolveSource({
  repository: manifest.repository,
  maintainedBranch: manifest.maintainedBranch,
  root,
});
const links = linksFor(source);
writeBuildSource(root, source);

const pages = new Map(); // repo-relative source path -> { destination (site-relative), position, section }
const positions = new Map();
for (const entry of manifest.pages) {
  const target = posix.dirname(entry.id).replace(/^reference\//, '');
  const position = (positions.get(target) ?? 0) + 1;
  positions.set(target, position);
  pages.set(entry.source, {
    destination: `${entry.id}.md`,
    position,
    section: manifest.sections.find((section) => section.target === target),
  });
}

/** Repository documents in the published folders that the manifest leaves out (reported, not published). */
function notPublished() {
  const dirs = new Set([...pages.keys()].map((path) => posix.dirname(path)));
  const missing = [];
  for (const dir of dirs) {
    for (const name of readdirSync(join(root, ...dir.split('/')))) {
      const path = posix.join(dir, name);
      if (
        name.endsWith('.md') &&
        statSync(join(root, ...path.split('/'))).isFile() &&
        !pages.has(path)
      )
        missing.push(path);
    }
  }
  return missing.sort();
}

function titleOf(body, fallback) {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match ? match[1].trim() : fallback;
}

function firstParagraph(body) {
  const lines = body.split('\n');
  let started = false;
  const chunk = [];
  for (const line of lines) {
    if (!started) {
      if (
        line.trim() === '' ||
        line.startsWith('#') ||
        line.startsWith('|') ||
        line.startsWith('```')
      ) {
        continue;
      }
      started = true;
    }
    if (line.trim() === '') {
      break;
    }
    chunk.push(line.trim());
  }
  const text = chunk
    .join(' ')
    .replace(/[`*_[\]]/g, '')
    .replace(/\(([^)]*)\)/g, '');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** Escapes `<placeholder>` outside code so CommonMark does not swallow it as an HTML tag. */
function escapePlaceholders(body) {
  const lines = body.split('\n');
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) {
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((segment, index) =>
          index % 2 === 1
            ? segment
            : segment.replace(/<(\/?)([A-Za-z][A-Za-z0-9_.-]*)>/g, (whole, slash, word) =>
                HTML_ALLOWED.has(word.toLowerCase()) ? whole : `&lt;${slash}${word}&gt;`,
              ),
        )
        .join('');
    })
    .join('\n');
}

/** Copies a repository image next to the page so the site bundles the revision it was built from. */
function bundleImage(repoRel, destination) {
  const absolute = join(root, ...repoRel.split('/'));
  if (!existsSync(absolute)) {
    throw new Error(`sync-content: an image ${repoRel} is embedded but does not exist`);
  }
  const name = repoRel.replaceAll('/', '__');
  const assets = join(siteDocs, ...posix.dirname(destination).split('/'), '_assets');
  mkdirSync(assets, { recursive: true });
  copyFileSync(absolute, join(assets, name));
  return `./_assets/${name}`;
}

function rewrite(body, sourcePath, destination) {
  return rewriteLinks(body, {
    sourcePath,
    destination,
    pages,
    links,
    bundleImage,
    exists: (repoRel) => existsSync(join(root, ...repoRel.split('/'))),
    warn: (message) => process.stderr.write(`sync-content: ${message}\n`),
  });
}

/** The provenance note at the top of every synced page. */
function sourceNote(sourcePath) {
  const link = `[\`${sourcePath}\`](${links.blob(sourcePath)})`;
  if (source.commit) {
    return `:::info Source\nPublished from ${link} at commit [\`${source.commit.slice(0, 12)}\`](${links.commit()}). Edit the repository file, not the site.\n:::\n\n`;
  }
  return `:::info Source\nPublished from ${link}. This build has no verified source revision (${source.state === 'local-uncommitted' ? 'a local build with uncommitted changes' : 'no commit metadata'}), so the link opens the maintained branch, which may differ from this page. Edit the repository file, not the site.\n:::\n\n`;
}

function frontMatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

rmSync(out, { recursive: true, force: true });
let written = 0;
for (const [sourcePath, page] of pages) {
  const raw = readFileSync(join(root, ...sourcePath.split('/')), 'utf8');
  const fallback = posix.basename(sourcePath, '.md');
  const title = titleOf(raw, fallback);
  const withoutTitle = raw.replace(/^#\s+.+\n+/m, '');
  const body = escapePlaceholders(rewrite(withoutTitle, sourcePath, page.destination));
  const isSession = page.section.target === 'sessions';
  const label = isSession
    ? fallback
    : page.section.target === 'frontend' && fallback === 'README'
      ? 'Overview'
      : title;
  const destination = join(siteDocs, ...page.destination.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    frontMatter({
      title,
      sidebar_label: label.length > 48 ? `${label.slice(0, 45)}…` : label,
      sidebar_position: page.position,
      description: firstParagraph(withoutTitle),
      custom_edit_url: links.edit(sourcePath),
      source_path: sourcePath,
    }) +
      sourceNote(sourcePath) +
      body,
  );
  written += 1;
}

for (const section of manifest.sections) {
  if (section.position !== undefined) {
    const categoryDir = join(out, ...section.target.split('/'));
    mkdirSync(categoryDir, { recursive: true });
    writeFileSync(
      join(categoryDir, '_category_.json'),
      `${JSON.stringify({ label: section.label, position: section.position, collapsed: true }, null, 2)}\n`,
    );
  }
}

// Theme tokens: the :root block of the generated token sheet, verbatim.
const tokens = readFileSync(join(root, 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
const rootBlock = /:root\s*\{[^}]*\}/.exec(tokens);
if (!rootBlock) {
  throw new Error('packages/ui/src/styles/tokens.css has no :root block');
}
writeFileSync(
  resolve(here, '..', 'src', 'css', 'markov-tokens.generated.css'),
  `/* GENERATED by apps/docs/scripts/sync-content.mjs from packages/ui/src/styles/tokens.css. Do not edit. */\n${rootBlock[0]}\n`,
);

const skipped = notPublished();
process.stdout.write(
  `sync-content: ${written} pages written under ${relative(root, out).split(sep).join('/')}; source ${source.commit ? `commit ${source.commit.slice(0, 12)} (${source.origin})` : source.state}; edit branch ${source.branch}\n`,
);
if (skipped.length > 0) {
  process.stdout.write(
    `sync-content: not published (not in the content manifest): ${skipped.join(', ')}\n`,
  );
}
