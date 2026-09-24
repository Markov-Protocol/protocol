/**
 * Retrieved documents are data. They become bounded plain text: scripts,
 * styles, comments and tags are removed, a few entities decoded, whitespace
 * collapsed and control characters dropped. Nothing here is ever rendered
 * as HTML again.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  '#39': "'",
  '#34': '"',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) {
      return ENTITIES[lower] as string;
    }
    if (/^#\d+$/.test(lower)) {
      const code = Number.parseInt(lower.slice(1), 10);
      return code >= 32 && code < 0x110000 && code !== 0x7f ? String.fromCodePoint(code) : ' ';
    }
    if (/^#x[0-9a-f]+$/.test(lower)) {
      const code = Number.parseInt(lower.slice(2), 16);
      return code >= 32 && code < 0x110000 && code !== 0x7f ? String.fromCodePoint(code) : ' ';
    }
    return whole;
  });
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control and line-separator characters are removed on purpose
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g;

export function stripControl(text: string): string {
  return text.replace(CONTROL_CHARACTERS, ' ');
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Plain text from HTML: script, style, template and comment content is dropped entirely. */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|template|noscript|iframe|object|embed|svg|math)\b[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(
      /<(br|p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|td|th)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ');
  return collapseWhitespace(
    stripControl(decodeEntities(withoutBlocks)).replace(/</g, ' ').replace(/>/g, ' '),
  );
}

export function extractTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) {
    return null;
  }
  const title = collapseWhitespace(
    stripControl(decodeEntities(match[1] ?? '')).replace(/[<>]/g, ' '),
  );
  return title === '' ? null : title.slice(0, 300);
}

/** Plain text (already free of markup) bounded to `max` characters, cut on a word boundary with an ellipsis. */
export function excerptOf(text: string, max = 1200): string {
  const clean = collapseWhitespace(stripControl(text)).replace(/[<>]/g, ' ');
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${boundary > max / 2 ? cut.slice(0, boundary) : cut}…`;
}

/** Text a person or a model typed: markup and control characters removed, bounded. */
export function plainText(text: string, max: number): string {
  return excerptOf(text.replace(/<[^>]*>/g, ' '), max);
}
