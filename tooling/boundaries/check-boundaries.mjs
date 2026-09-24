#!/usr/bin/env node
/**
 * Mechanical check of the dependency direction documented in
 * docs/markov/architecture.md. It inspects package.json dependencies and
 * every import/export specifier in src/ and test/ TypeScript files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const rules = JSON.parse(readFileSync(join(root, 'tooling/boundaries/rules.json'), 'utf8'));

function listWorkspacePackages() {
  const packages = [];
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    for (const name of readdirSync(dir)) {
      const manifestPath = join(dir, name, 'package.json');
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        packages.push({ name: manifest.name, dir: join(dir, name), manifest });
      } catch {
        // not a package
      }
    }
  }
  return packages;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') {
        walk(full, out);
      }
    } else if (/\.(ts|mts|cts|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SPECIFIER =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersIn(file) {
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
      found.add(specifier);
    }
  }
  return [...found];
}

const packages = listWorkspacePackages();
const internalNames = new Set(packages.map((pkg) => pkg.name));
const violations = [];

for (const pkg of packages) {
  const isApp = rules.apps.includes(pkg.name);
  const layer = rules.layers[pkg.name];
  if (!isApp && !layer) {
    violations.push(`${pkg.name}: not classified in tooling/boundaries/rules.json`);
    continue;
  }
  const declared = {
    ...(pkg.manifest.dependencies ?? {}),
    ...(pkg.manifest.devDependencies ?? {}),
  };
  const declaredNames = Object.keys(declared);
  const files = [...walk(join(pkg.dir, 'src')), ...walk(join(pkg.dir, 'test'))];

  for (const file of files) {
    const rel = relative(root, file);
    const inTest = rel.includes('/test/');
    for (const specifier of specifiersIn(file)) {
      const base = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (internalNames.has(base)) {
        if (rules.apps.includes(base) && base !== pkg.name) {
          violations.push(`${rel}: app ${pkg.name} imports app ${base}`);
        } else if (!isApp && base !== pkg.name) {
          const allowed =
            layer.allow.includes(base) || (inTest && rules.testOnlyPackages.includes(base));
          if (!allowed) {
            violations.push(`${rel}: ${pkg.name} may not import ${base}`);
          }
        }
        if (!inTest && rules.testOnlyPackages.includes(base) && base !== pkg.name) {
          violations.push(`${rel}: test-only package ${base} imported from production code`);
        }
        if (base !== pkg.name && !declaredNames.includes(base)) {
          violations.push(`${rel}: ${base} is imported but not declared in package.json`);
        }
        continue;
      }
      for (const [family, owners] of Object.entries(rules.externalOwners)) {
        const matches = family.endsWith('/') ? specifier.startsWith(family) : base === family;
        if (matches && !owners.includes(pkg.name)) {
          violations.push(
            `${rel}: ${specifier} may only be imported by ${owners.length ? owners.join(', ') : 'no package yet (add an owner in rules.json with an ADR)'}`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('dependency boundary violations:\n');
  for (const violation of violations) {
    process.stderr.write(`  - ${violation}\n`);
  }
  process.exit(1);
}
process.stdout.write(`dependency boundaries ok (${packages.length} workspace packages)\n`);
