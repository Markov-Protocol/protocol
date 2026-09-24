# ADR-0002: Runtime and toolchain pins

Date: 2026-09-24 · Status: accepted · Session: B01

## Context

The specification asks for a supported Node LTS, TypeScript strict, a pnpm
workspace with a frozen lockfile and pinned versions chosen from current
documentation. Versions were resolved on 2026-09-24 against the npm registry
and the Node release schedule (see `docs/markov/source-register.md`).

## Decision

| Component  | Pin        | Reason                                                                 |
| ---------- | ---------- | ---------------------------------------------------------------------- |
| Node       | 22 (`.node-version`), engines `>=22.12 <27` | Node 22 "Jod" is in LTS maintenance until 2027-04-30 and is what the build environment runs; Node 24 is active LTS and is compatible with every pinned dependency. |
| pnpm       | 10.33.0    | Version present in the build environment; `packageManager` pins it for corepack and CI. `minimumReleaseAge: 1440` delays brand-new package versions by 24 hours. |
| TypeScript | 5.9.3      | TypeScript 7.0 (native compiler) is `latest` and 6.0 is the bridge release; tool support across drizzle-kit, vitest, tsx and the Temporal bundler is verified for 5.9 only. Upgrade tracked in open decisions. |
| Module system | ESM, `module: NodeNext`, `verbatimModuleSyntax` | Matches all pinned libraries; explicit `.js` specifiers. |
| Lint/format | Biome 2.5.14 | Single fast tool; no ESLint plugin sprawl. |
| Tests      | Vitest 5.0.1 | Native ESM/TS; integration tests self-gate on `MARKOV_TEST_*`. |
| Runtime libs | fastify 5.12.5, zod 4.6.5, fastify-type-provider-zod 7.0.0, @fastify/swagger 9.9.0, pino 10.3.1, drizzle-orm 0.45.3, drizzle-kit 0.31.11, pg 8.23.0, @temporalio/* 1.24.0, commander 15.0.0 | Latest published versions with satisfied peer ranges. |
| Local tools | Temporal CLI 1.9.1, gitleaks 8.30.1 | Installed by checksum-verified scripts under `scripts/dev/`. |

All dependency versions are exact in `package.json`; transitive versions are
pinned by `pnpm-lock.yaml`. Dependency install scripts run only for the
allowlisted `esbuild` and `@swc/core` (`pnpm-workspace.yaml`); the ignored
`protobufjs` postinstall is a no-op warning.

## Consequences

- CI installs with `--frozen-lockfile` and verifies on Node 22.
- Upgrading TypeScript to 6.x/7.x requires re-running the full gate and a
  note in this ADR.
