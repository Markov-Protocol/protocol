/**
 * Rewrites the Markdown links of one synced document for the site:
 * - a link to another published document becomes a relative site link;
 * - an embedded repository image is bundled next to the page (the copy of
 *   this build), never hot-linked from GitHub;
 * - any other repository path becomes a GitHub link at the build's commit
 *   (or the maintained branch when the revision is unknown);
 * - absolute URLs and in-page anchors are left alone; a relative path that
 *   leaves the repository is refused.
 */
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0 || out[out.length - 1] === '..') out.push('..');
      else out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function relativeTo(fromDir, to) {
  const from = fromDir ? fromDir.split('/') : [];
  const target = to.split('/');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common])
    common += 1;
  return [...Array(from.length - common).fill('..'), ...target.slice(common)].join('/');
}

/**
 * context: { sourcePath, destination, pages: Map<source, { destination }>,
 *            links: { blob(path, anchor) }, bundleImage(repoRel, destination) -> url,
 *            exists(repoRel) -> boolean, warn(message) }
 */
export function rewriteLinks(body, context) {
  const sourceDir = dirname(context.sourcePath);
  return body.replace(LINK, (whole, bang, text, target, title) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) {
      return whole;
    }
    const [pathPart, anchor] = target.split('#');
    const repoRel = normalize(`${sourceDir}/${decodeURI(pathPart)}`);
    if (repoRel === '' || repoRel.startsWith('..')) {
      throw new Error(`${context.sourcePath} links outside the repository (${target})`);
    }
    const page = context.pages.get(repoRel);
    if (page && !bang) {
      const link = relativeTo(dirname(context.destination), page.destination);
      return `[${text}](${link}${anchor ? `#${anchor}` : ''}${title})`;
    }
    if (bang && IMAGE.test(repoRel)) {
      return `![${text}](${context.bundleImage(repoRel, context.destination)}${title})`;
    }
    if (!context.exists(repoRel)) {
      context.warn(
        `${context.sourcePath} links to a missing file ${repoRel}; left as a repository link`,
      );
    }
    return `${bang}[${text}](${context.links.blob(repoRel, anchor)}${title})`;
  });
}
