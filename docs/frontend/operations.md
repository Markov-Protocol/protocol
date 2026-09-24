# Frontend operations

Status: F01 slice. Deployment, monitoring and rollback procedures are
completed in F19/F20; this file records what exists now.

- **Build**: `pnpm build` (backend graph, produces the contracts the app
  consumes) then `pnpm web:build`. The build fails on an invalid or unsafe
  `MARKOV_ENV` combination.
- **Start**: `pnpm web:start` (Next.js server). `instrumentation.ts`
  re-validates the environment and logs the resolved switches once.
- **Health**: none yet; the app exposes no health endpoint until F19.
- **Internal routes**: `/dev/components` only when
  `MARKOV_WEB_INTERNAL_ROUTES=true`; production refuses the flag.
- **Rollback**: redeploy the previous artifact; no client state to migrate
  exists yet. A frontend redeploy never cancels backend or on-chain work.
