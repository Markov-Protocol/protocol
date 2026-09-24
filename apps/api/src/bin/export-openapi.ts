/**
 * Generate the OpenAPI document from the runtime contracts, or verify that
 * the committed document matches (`--check`). Used by CI to catch contract
 * drift. Builds the app with inert probes; no network or database access.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@markov/config';
import { createSilentLogger } from '@markov/observability';
import { buildApp } from '../app.js';
import type { IdentityService } from '../auth/service.js';
import type { CatalogService } from '../catalog/service.js';
import type { FundingService } from '../funding/service.js';
import type { PolicyService } from '../policy/service.js';
import type { ResearchService } from '../research/service.js';

/** Export mode never touches a database: every identity call is unreachable. */
const unavailableIdentity = new Proxy({} as IdentityService, {
  get: () => () => {
    throw new Error('identity service is unavailable in export mode');
  },
});
const unavailableCatalog = new Proxy({} as CatalogService, {
  get: () => () => {
    throw new Error('catalog service is unavailable in export mode');
  },
});
const unavailablePolicy = new Proxy({} as PolicyService, {
  get: () => () => {
    throw new Error('policy service is unavailable in export mode');
  },
});
const unavailableFunding = new Proxy({} as FundingService, {
  get: () => () => {
    throw new Error('funding service is unavailable in export mode');
  },
});
const unavailableResearch = new Proxy({} as ResearchService, {
  get: () => () => {
    throw new Error('research service is unavailable in export mode');
  },
});

async function generate(): Promise<string> {
  const config = loadConfig({
    MARKOV_ENV: 'test',
    SERVICE_VERSION: 'openapi-export',
    DATABASE_URL: 'postgres://export@127.0.0.1:5432/export',
    SOLANA_CLUSTER: 'devnet',
    SOLANA_RPC_PRIMARY_URL: 'http://127.0.0.1:1',
  });
  const inert = { ok: false, detail: 'export mode', durationMs: 0 };
  const app = await buildApp({
    config,
    logger: createSilentLogger(),
    service: { name: 'markov-api', version: 'openapi-export', startedAt: Date.now() },
    probes: {
      database: async () => inert,
      schema: async () => ({ ...inert, latestTag: null }),
      platformIdentity: async () => ({ ...inert, identity: null }),
      capabilities: async () => [],
    },
    network: {
      snapshot: () => ({
        status: 'unverified',
        observedGenesisHash: null,
        detail: 'export mode',
        checkedAt: null,
        durationMs: null,
      }),
    },
    expectedGenesisHash: null,
    identity: unavailableIdentity,
    catalog: unavailableCatalog,
    policy: unavailablePolicy,
    funding: unavailableFunding,
    research: unavailableResearch,
    mintTestToken: null,
  });
  await app.ready();
  const document = app.swagger();
  await app.close();
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!target) {
    process.stderr.write('usage: export-openapi [--check] <path>\n');
    process.exit(64);
  }
  const generated = await generate();
  if (!check) {
    writeFileSync(target, generated);
    process.stdout.write(`wrote ${target}\n`);
    return;
  }
  let committed: string;
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    process.stderr.write(
      `openapi drift: ${target} does not exist; run \`pnpm openapi:generate\`\n`,
    );
    process.exit(1);
  }
  if (committed !== generated) {
    process.stderr.write(
      `openapi drift: ${target} differs from the runtime contracts; run \`pnpm openapi:generate\` and review the diff\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`openapi document ${target} is current\n`);
}

void main();
