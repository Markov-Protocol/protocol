#!/usr/bin/env node
/**
 * Redact credential-shaped values from CI evidence before it is uploaded.
 *
 *   node tooling/release/redact.mjs <dir>            rewrite, then report
 *   node tooling/release/redact.mjs --verify <dir>   exit 1 if any value remains
 *   node tooling/release/redact.mjs --extract-embedded <dir> <out>
 *                                   copy archives embedded in HTML to <out>
 *
 * Rewrites text files under <dir> in place, and the text entries of ZIP
 * archives (Playwright traces) and of the archive a Playwright HTML report
 * embeds in its index.html. It writes <dir>/redaction.json with what was
 * replaced (rule names and counts, never the values). An archive that cannot
 * be inspected (encrypted, ZIP64, unknown compression) is deleted and listed,
 * so nothing unread is uploaded. Images and other binary files are left as
 * they are and listed; gitleaks's default allowlist skips images too, so a
 * screenshot is checked by neither. CI then scans the directory with gitleaks
 * (scripts/ci/evidence-gate.sh). Redaction is defence in depth: tests must
 * not print real secrets in the first place, and CI holds none.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * ANSI SGR colour codes a terminal reporter may print between a prefix and a
 * secret, raw or JSON-escaped; the patterns tolerate them so colour never
 * hides a value from redaction.
 */
const SGR = String.raw`(?:(?:\x1b|\\u001[bB])\[[0-9;]*m)*`;

/**
 * Each rule replaces the secret part of a match and keeps enough context to
 * read the log. Placeholders use square brackets so a redacted JUnit XML or
 * HTML file stays well formed.
 */
export const REDACTION_RULES = [
  {
    name: 'pem-private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: '[redacted-private-key]',
  },
  {
    // Base64 DER of an Ed25519 PKCS#8 private key (the e2e fixture wallet's key shape).
    name: 'ed25519-pkcs8',
    pattern: /MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{43}/g,
    replace: '[redacted-private-key]',
  },
  {
    // No leading word boundary: a credential glued to an identifier or colour code still matches.
    name: 'markov-credential',
    pattern: new RegExp(`mkv_(ss|ag|op|dv|wk)_${SGR}[A-Za-z0-9_-]{8,}`, 'g'),
    replace: 'mkv_$1_[redacted]',
  },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: '[redacted-jwt]',
  },
  {
    // HAR-shaped headers, as a Playwright trace records them: {"name":"cookie","value":"..."}.
    name: 'har-credential-header',
    pattern:
      /(\\?"name\\?"\s*:\s*\\?"(?:set-cookie|cookie|authorization|proxy-authorization|x-api-key|api-key)\\?"\s*,\s*\\?"value\\?"\s*:\s*\\?")(?!\[redacted)(?:[^"\\]|\\(?!"))+/gi,
    replace: '$1[redacted]',
  },
  {
    // The value stops at a quote, a newline or '<', so a JUnit XML or HTML line stays well formed.
    name: 'credential-header',
    pattern: new RegExp(
      String.raw`\b(set-cookie|cookie|proxy-authorization|authorization|x-api-key|api-key)((?:\\?["'])?${SGR}\s*[:=]\s*${SGR}(?:\\?["'])?)(?!\[redacted)[^\s"'\\<\x1b][^"'\\\r\n<]{2,}`,
      'gi',
    ),
    replace: '$1$2[redacted]',
  },
  {
    name: 'bearer-token',
    pattern: new RegExp(String.raw`\b(Bearer)\s+${SGR}(?!\[redacted)[A-Za-z0-9._~+/=-]{8,}`, 'gi'),
    replace: '$1 [redacted]',
  },
  {
    name: 'url-password',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>]+):(?!\[redacted\])[^\s@/"'<>]+@/gi,
    replace: '$1:[redacted]@',
  },
];

const TEXT_EXTENSIONS = new Set([
  '.xml',
  '.log',
  '.txt',
  '.json',
  '.md',
  '.csv',
  '.yml',
  '.yaml',
  '.sql',
]);

/** Apply every rule to one text; returns the new text and the per-rule counts. */
export function redactText(text) {
  const counts = {};
  let out = text;
  for (const rule of REDACTION_RULES) {
    let hits = 0;
    out = out.replace(rule.pattern, (...args) => {
      hits += 1;
      const groups = args.slice(1, -2);
      return rule.replace.replace(/\$(\d)/g, (_, index) => groups[Number(index) - 1] ?? '');
    });
    if (hits > 0) {
      counts[rule.name] = hits;
    }
  }
  return { text: out, counts };
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

class UnreadableArchive extends Error {}

/**
 * Entries of a ZIP archive (stored or deflated, no encryption, no ZIP64): the
 * format Playwright writes for traces and report data. Sizes come from the
 * central directory, so entries written with data descriptors read correctly.
 */
export function readZip(buffer) {
  const minEnd = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = buffer.length - 22; at >= minEnd; at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new UnreadableArchive('no end of central directory');
  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new UnreadableArchive('ZIP64 archive');
  const entries = [];
  let at = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50)
      throw new UnreadableArchive('bad central directory');
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const time = buffer.readUInt16LE(at + 12);
    const date = buffer.readUInt16LE(at + 14);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    if (flags & 0x1) throw new UnreadableArchive(`encrypted entry ${name}`);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new UnreadableArchive('ZIP64 entry');
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new UnreadableArchive('bad local header');
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) {
      content = Buffer.from(data);
    } else if (method === 8) {
      content = inflateRawSync(data);
    } else {
      throw new UnreadableArchive(`compression method ${method}`);
    }
    entries.push({ name, content, time, date });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A deflated ZIP archive of the given entries (UTF-8 names, original timestamps kept). */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = deflateRawSync(entry.content);
    const crc = crc32(entry.content) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(entry.time ?? 0, 10);
    local.writeUInt16LE(entry.date ?? 0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(entry.time ?? 0, 12);
    central.writeUInt16LE(entry.date ?? 0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function isText(content) {
  if (content.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

function addCounts(target, counts) {
  for (const [rule, hits] of Object.entries(counts)) {
    target[rule] = (target[rule] ?? 0) + hits;
  }
}

/** Redact every text entry of an archive (nested archives included); unchanged archives keep their bytes. */
export function redactZip(buffer, depth = 0) {
  if (depth > 3) throw new UnreadableArchive('archives nested too deeply');
  const counts = {};
  let changed = false;
  const entries = readZip(buffer).map((entry) => {
    if (entry.name.endsWith('/')) return entry;
    if (entry.name.toLowerCase().endsWith('.zip')) {
      const inner = redactZip(entry.content, depth + 1);
      addCounts(counts, inner.counts);
      if (inner.changed) changed = true;
      return { ...entry, content: inner.buffer };
    }
    if (!isText(entry.content)) return entry;
    const { text, counts: hits } = redactText(entry.content.toString('utf8'));
    if (Object.keys(hits).length === 0) return entry;
    addCounts(counts, hits);
    changed = true;
    return { ...entry, content: Buffer.from(text, 'utf8') };
  });
  return { buffer: changed ? writeZip(entries) : buffer, counts, changed };
}

const EMBEDDED_ZIP = /(data:application\/zip;base64,)([A-Za-z0-9+/=]+)/g;

/** Redact the archive a Playwright HTML report embeds as a base64 data URL. */
export function redactEmbeddedZips(html, depth = 0) {
  const counts = {};
  let changed = false;
  const out = html.replace(EMBEDDED_ZIP, (whole, prefix, data) => {
    const result = redactZip(Buffer.from(data, 'base64'), depth);
    addCounts(counts, result.counts);
    if (!result.changed) return whole;
    changed = true;
    return `${prefix}${result.buffer.toString('base64')}`;
  });
  return { html: out, counts, changed };
}

/** Redact every file under dir in place; returns the report written to redaction.json. */
export function redactDirectory(dir) {
  const report = {
    tool: 'tooling/release/redact.mjs',
    rules: REDACTION_RULES.map((rule) => rule.name),
    textFiles: 0,
    archives: 0,
    rewritten: [],
    removed: [],
    notInspected: [],
  };
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    if (rel === 'redaction.json') {
      continue;
    }
    const extension = extname(file).toLowerCase();
    try {
      if (extension === '.zip') {
        report.archives += 1;
        const result = redactZip(readFileSync(file));
        if (result.changed) {
          writeFileSync(file, result.buffer);
          report.rewritten.push({ path: rel, replacements: result.counts });
        }
      } else if (extension === '.html' || extension === '.htm') {
        const original = readFileSync(file, 'utf8');
        if (!original.includes('data:application/zip;base64,')) {
          report.notInspected.push({ path: rel, bytes: statSync(file).size });
          continue;
        }
        report.archives += 1;
        const result = redactEmbeddedZips(original);
        if (result.changed) {
          writeFileSync(file, result.html);
          report.rewritten.push({ path: rel, replacements: result.counts });
        }
      } else if (TEXT_EXTENSIONS.has(extension)) {
        report.textFiles += 1;
        const original = readFileSync(file, 'utf8');
        const { text, counts } = redactText(original);
        if (text !== original) {
          writeFileSync(file, text);
          report.rewritten.push({ path: rel, replacements: counts });
        }
      } else {
        report.notInspected.push({ path: rel, bytes: statSync(file).size });
      }
    } catch (error) {
      if (!(error instanceof UnreadableArchive) && !(error instanceof RangeError)) throw error;
      rmSync(file);
      report.removed.push({ path: rel, reason: `could not be inspected: ${error.message}` });
    }
  }
  writeFileSync(join(dir, 'redaction.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** Credential-shaped values still present under dir (inside archives too): [{ path, rule }]. */
export function verifyDirectory(dir) {
  const remaining = [];
  const check = (path, text) => {
    for (const rule of REDACTION_RULES) {
      if (redactText(text).counts[rule.name]) remaining.push({ path, rule: rule.name });
    }
  };
  const checkZip = (path, buffer) => {
    for (const entry of readZip(buffer)) {
      if (entry.name.toLowerCase().endsWith('.zip'))
        checkZip(`${path}!${entry.name}`, entry.content);
      else if (isText(entry.content))
        check(`${path}!${entry.name}`, entry.content.toString('utf8'));
    }
  };
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    const extension = extname(file).toLowerCase();
    try {
      inspect(rel, file, extension);
    } catch (error) {
      if (!(error instanceof UnreadableArchive) && !(error instanceof RangeError)) throw error;
      remaining.push({ path: rel, rule: `uninspectable archive (${error.message})` });
    }
  }
  return remaining;

  function inspect(rel, file, extension) {
    if (extension === '.zip') {
      checkZip(rel, readFileSync(file));
    } else if (extension === '.html' || extension === '.htm') {
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(EMBEDDED_ZIP))
        checkZip(`${rel}!embedded`, Buffer.from(match[2], 'base64'));
    } else if (TEXT_EXTENSIONS.has(extension)) {
      check(rel, readFileSync(file, 'utf8'));
    }
  }
}

/**
 * Write every archive embedded in an HTML file under dir to outDir as
 * <path>.embedded-<n>.zip, so a secret scanner that does not read data URLs
 * still sees them. Returns the written paths (relative to outDir).
 */
export function extractEmbeddedZips(dir, outDir) {
  const written = [];
  for (const file of walk(dir)) {
    if (extname(file).toLowerCase() !== '.html') continue;
    const rel = relative(dir, file);
    let index = 0;
    for (const match of readFileSync(file, 'utf8').matchAll(EMBEDDED_ZIP)) {
      index += 1;
      const target = `${rel.replaceAll('/', '__')}.embedded-${index}.zip`;
      writeFileSync(join(outDir, target), Buffer.from(match[2], 'base64'));
      written.push(target);
    }
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === '--extract-embedded') {
    const [, from, to] = args;
    if (!from || !to || !statSync(to, { throwIfNoEntry: false })?.isDirectory()) {
      process.stderr.write(
        'usage: node tooling/release/redact.mjs --extract-embedded <dir> <out>\n',
      );
      process.exit(2);
    }
    const written = extractEmbeddedZips(from, to);
    process.stdout.write(`redact: ${written.length} embedded archive(s) extracted for scanning\n`);
    process.exit(0);
  }
  const verify = args[0] === '--verify';
  const dir = verify ? args[1] : args[0];
  if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    process.stderr.write(
      'usage: node tooling/release/redact.mjs [--verify] <dir> | --extract-embedded <dir> <out>\n',
    );
    process.exit(2);
  }
  if (verify) {
    const remaining = verifyDirectory(dir);
    for (const hit of remaining) process.stderr.write(`- ${hit.path}: ${hit.rule}\n`);
    process.stdout.write(
      `redact --verify: ${remaining.length} credential-shaped value(s) remain\n`,
    );
    process.exit(remaining.length === 0 ? 0 : 1);
  }
  const report = redactDirectory(dir);
  const replaced = report.rewritten.reduce(
    (sum, file) => sum + Object.values(file.replacements).reduce((a, b) => a + b, 0),
    0,
  );
  process.stdout.write(
    `redact: ${report.textFiles} text file(s) and ${report.archives} archive(s) inspected, ${report.rewritten.length} rewritten (${replaced} replacement(s)), ${report.removed.length} removed as uninspectable, ${report.notInspected.length} binary file(s) not inspected (gitleaks skips images as well)\n`,
  );
}
