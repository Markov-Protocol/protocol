# Security and privacy (frontend)

Status: F01 slice. The browser is an untrusted client; UI guardrails aid
comprehension and never replace server authorization, policy or on-chain
constraints.

## Implemented in F01

| Control | Where | Verification |
| ------- | ----- | ------------ |
| Development switches refused in production (`MARKOV_WEB_FIXTURES`, `MARKOV_WEB_INTERNAL_ROUTES`), fixtures also refused in staging and read-only mainnet | `apps/web/src/config/web-env.ts`, enforced by `next.config.ts` (build) and `instrumentation.ts` (server start) | `apps/web/test/web-env.test.ts` |
| Internal reference route hidden unless explicitly enabled; `noindex` | `apps/web/src/app/dev/components/page.tsx` | e2e header check; guard tests |
| Baseline headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Permissions-Policy` disabling camera, geolocation, microphone and payment | `apps/web/next.config.ts` | Playwright header assertions |
| No secrets in the app environment; only `NEXT_PUBLIC_APP_ORIGIN` is public | `docs/frontend/README.md` | build inspection in F20 |
| Frontend packages cannot import databases, config, RPC clients or signers | `tooling/boundaries/rules.json` (`appDeny`) | `pnpm boundaries:check` in CI |
| No remote images (`images.remotePatterns` empty) | `next.config.ts` | n/a |

## Planned (with the sessions that own them)

Full CSP with exact identity/wallet allowances and report-only rollout,
HSTS at the deployment, session/CSRF model (F03), principal-scoped query
caches and account-switch isolation (F03), signing-path validation (F10),
analytics consent and retention (F14/F20). Threat-model rows from the build
prompt are tracked in `docs/frontend/verification.md` as they gain tests.
