#!/usr/bin/env node
/**
 * Copies the repository's documents into the site (docs/reference/**) with
 * front matter, a curated order and rewritten links, and extracts the
 * design tokens for the theme. Generated output is gitignored; the
 * repository files stay the source of truth and every page links back to
 * them for editing.
 *
 *   node apps/docs/scripts/sync-content.mjs
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '..', '..', '..');
const siteDocs = resolve(here, '..', 'docs');
const out = join(siteDocs, 'reference');
const REPOSITORY = 'https://github.com/Markov-Protocol/protocol';
const BRANCH = 'main';
const RAW = 'https://raw.githubusercontent.com/Markov-Protocol/protocol';
/** HTML the documents use on purpose; every other `<word>` is a placeholder and is escaped. */
const HTML_ALLOWED = new Set(['pre', 'br', 'details', 'summary', 'sub', 'sup', 'kbd', 'code']);

/** Source folders (not recursive) and the order their pages appear in. */
const SOURCES = [
  {
    dir: 'docs/markov',
    target: 'markov',
    label: 'Backend contract',
    order: [
      'product-scope',
      'architecture',
      'api',
      'identity-and-principals',
      'catalog',
      'instrument-admission',
      'eligibility-and-policy',
      'research',
      'strategies',
      'strategy-registry',
      'execution-planning',
      'execution-state-machine',
      'accounting-methodology',
      'discovery',
      'agents',
      'agent-permissions',
      'maintenance',
      'provider-capabilities',
      'source-register',
      'threat-model',
      'operations',
      'release-readiness',
      'open-decisions',
    ],
  },
  { dir: 'docs/markov/adr', target: 'markov/adr', label: 'Architecture decisions', position: 30 },
  {
    dir: 'docs/frontend',
    target: 'frontend',
    label: 'App (markov.pet)',
    order: [
      'README',
      'product-contract',
      'routes-and-journeys',
      'mark-i-shell',
      'design-system',
      'accessibility',
      'api-contract-map',
      'security-and-privacy',
      'operations',
      'verification',
      'source-register',
    ],
  },
  {
    dir: 'docs/frontend/design-reference',
    target: 'frontend/design-reference',
    label: 'Design reference',
    position: 20,
  },
  { dir: 'docs/sessions', target: 'sessions', label: 'Session evidence' },
];

function listMarkdown(dir) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute)
    .filter((name) => name.endsWith('.md') && statSync(join(absolute, name)).isFile())
    .sort();
}

/** Session ids sort by letter then number (B01 … B13, F01 … F10). */
function sessionKey(name) {
  const match = /^([A-Z])(\d+)$/.exec(name);
  return match ? `${match[1]}${match[2].padStart(4, '0')}` : name;
}

const pages = new Map(); // repo-relative source path -> { destination (site-relative), slugId }
for (const source of SOURCES) {
  const names = listMarkdown(source.dir);
  const ordered = source.order
    ? [...names].sort((a, b) => {
        const ia = source.order.indexOf(a.replace(/\.md$/, ''));
        const ib = source.order.indexOf(b.replace(/\.md$/, ''));
        return (ia === -1 ? 1000 : ia) - (ib === -1 ? 1000 : ib) || a.localeCompare(b);
      })
    : source.target === 'sessions'
      ? [...names].sort((a, b) =>
          sessionKey(a.replace(/\.md$/, '')).localeCompare(sessionKey(b.replace(/\.md$/, ''))),
        )
      : names;
  ordered.forEach((name, index) => {
    const sourcePath = posix.join(source.dir, name);
    const id = name.replace(/\.md$/, '').toLowerCase();
    pages.set(sourcePath, {
      destination: posix.join('reference', source.target, `${id}.md`),
      position: index + 1,
      source,
    });
  });
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

function rewriteLinks(body, sourcePath, destination) {
  const sourceDir = posix.dirname(sourcePath);
  return body.replace(
    /(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (whole, bang, text, target, title) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
        return whole;
      }
      const [pathPart, anchor] = target.split('#');
      const repoRel = posix.normalize(posix.join(sourceDir, pathPart));
      const page = pages.get(repoRel);
      if (page) {
        const relLink = posix.relative(posix.dirname(destination), page.destination);
        return `${bang}[${text}](${relLink}${anchor ? `#${anchor}` : ''}${title})`;
      }
      const absolute = join(root, ...repoRel.split('/'));
      if (!existsSync(absolute)) {
        process.stderr.write(
          `sync-content: ${sourcePath} links to a missing file ${repoRel}; left as a repository link\n`,
        );
      }
      const url = bang
        ? `${RAW}/${BRANCH}/${repoRel}`
        : `${REPOSITORY}/blob/${BRANCH}/${repoRel}${anchor ? `#${anchor}` : ''}`;
      return `${bang}[${text}](${url}${title})`;
    },
  );
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
  const body = escapePlaceholders(rewriteLinks(withoutTitle, sourcePath, page.destination));
  const isSession = page.source.target === 'sessions';
  const label = isSession
    ? fallback
    : page.source.target === 'frontend' && fallback === 'README'
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
      custom_edit_url: `${REPOSITORY}/edit/${BRANCH}/${sourcePath}`,
      source_path: sourcePath,
    }) +
      `:::info Source\nThis page is generated from [\`${sourcePath}\`](${REPOSITORY}/blob/${BRANCH}/${sourcePath}) at build time. Edit the repository file, not the site.\n:::\n\n` +
      body,
  );
  written += 1;
}

for (const source of SOURCES) {
  if (source.position !== undefined) {
    const categoryDir = join(out, ...source.target.split('/'));
    mkdirSync(categoryDir, { recursive: true });
    writeFileSync(
      join(categoryDir, '_category_.json'),
      `${JSON.stringify({ label: source.label, position: source.position, collapsed: true }, null, 2)}\n`,
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

process.stdout.write(
  `sync-content: ${written} pages written under ${relative(root, out).split(sep).join('/')}\n`,
);
