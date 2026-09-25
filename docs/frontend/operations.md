# Frontend operations

Status: after F12 and the Vercel deployment of 2026-09-25. Health,
monitoring and rollback procedures are completed in F19/F20 (P18 and P19
in the production completion plan); this file records what exists now.

- **Build**: `pnpm build` (backend graph, produces the contracts the app
  consumes) then `pnpm web:build`. The build fails on an invalid or unsafe
  `MARKOV_ENV` combination.
- **Start**: `pnpm web:start` (Next.js server). `instrumentation.ts`
  re-validates the environment and logs the resolved switches once.
- **Hosting**: the Vercel project `markov-web` (root `apps/web`, install
  and build commands in `apps/web/vercel.json`, Node 22.x) serves
  https://markov-web-theta.vercel.app with `MARKOV_ENV=staging` since
  2026-09-25, built from pre-rewrite commit `7840da2` (rewritten as
  `9b6bde3`, identical tree). No backend is hosted anywhere yet:
  `MARKOV_API_ORIGIN` is the placeholder `https://api.markov.pet`, so the
  top bar shows "Backend unreachable" until the API runs and lists the app
  origin in `API_ALLOWED_ORIGINS` (Railway is selected for the backend,
  not provisioned). `MARKOV_DOCS_ORIGIN` is
  `https://markov-docs.vercel.app`, so the app proxies `/docs` to the
  documentation site. `markov.pet` is not routed to this deployment.
  Nothing deploys on push until the Vercel GitHub App is installed, and no
  secret is held on Vercel. Details: `docs/markov/operations.md`,
  "Frontends on Vercel".
- **Health**: none yet; the app exposes no health endpoint until F19 (P18).
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
