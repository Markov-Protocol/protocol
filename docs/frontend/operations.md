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
- **Backend link**: `MARKOV_API_ORIGIN` (server-only, https outside
  local/test) is the only way the app reaches the API. If the API is down the
  top bar shows "Backend unreachable", sign-in reports it, and a signed-in
  person sees "cannot verify your session" instead of stale private data;
  the cookie is kept so recovery needs no new sign-in.
- **Sessions**: the app stores nothing server-side. Revoking a session
  (sign-out, `markov` operator tooling, or a future account-disable route)
  takes effect on the next request. Rotating the API's `CREDENTIAL_PEPPER`
  signs everyone out.
- **Browser tests with the API**: `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e`
  starts a migrated API with the test issuer on port 3900
  (`scripts/dev/web-e2e-api.sh`) beside the web server on 3100.
- **Rollback**: redeploy the previous artifact; the only client state is the
  session cookie, which the previous artifact reads the same way. A frontend
  redeploy never cancels backend or on-chain work.
