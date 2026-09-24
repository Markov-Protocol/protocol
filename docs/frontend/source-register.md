# Frontend source register

Changing facts used by the frontend implementation, with where they were
checked. Vendor documentation sites (nextjs.org, tailwindcss.com,
radix-ui.com, privy.io) were blocked by the build environment's egress
policy on 2026-09-24; the Next.js documentation was read from the
`vercel/next.js` repository on raw.githubusercontent.com instead.

| ID | Source | Checked | Version | Finding | Uncertainty | Validation |
| -- | ------ | ------- | ------- | ------- | ----------- | ---------- |
| FR-NEXT-01 | vercel/next.js `docs/01-app/01-getting-started/01-installation.mdx`, `.../next-config-js/transpilePackages.mdx`, `.../file-conventions/instrumentation.mdx`, `.../next-config-js/headers.mdx`, `.../components/font.mdx` (canary) | 2026-09-24 | next 16.3.6 | Minimum Node 20.9; Turbopack transpiles workspace packages automatically (listed anyway for webpack); `instrumentation.ts` `register` runs once at server start; `headers()` config; `next/font/local` with `weight: '100 900'` for variable fonts. | Canary docs may run ahead of 16.3.6. | `pnpm web:build` succeeds; header assertions in e2e. |
| FR-NEXT-02 | npm registry | 2026-09-24 | next 16.3.6, react 19.3.0, @types/react 19.3.0 | Peer range `react ^19` satisfied. | none | `pnpm install --frozen-lockfile` |
| FR-TW-01 | Installed `tailwindcss@4.3.3` `theme.css` | 2026-09-24 | 4.3.3 | Theme namespaces `--color-*`, `--text-*`, `--radius-*`, `--font-*`, `--ease-*`, single `--spacing: 0.25rem`; `@theme inline` in an imported file is processed by the PostCSS plugin. | Docs site blocked; behaviour verified by the successful build and rendered utilities. | reference route screenshots |
| FR-RADIX-01 | Installed `radix-ui@1.6.7` type definitions | 2026-09-24 | 1.6.7 | Namespace exports (`Dialog`, `DropdownMenu`, `Tabs`, `Select`, `Slot`, `VisuallyHidden`) re-exported from the individual `@radix-ui/react-*` packages. | Radix docs blocked. | component tests in jsdom and Chromium |
| FR-PW-01 | microsoft/playwright `packages/playwright-core/browsers.json` at tags v1.55.0 to v1.63.0 | 2026-09-24 | @playwright/test 1.56.0 | v1.56.0 ships Chromium build 1194, matching the pre-installed browser at `/opt/pw-browsers/chromium-1194`. | Later Playwright versions need a browser download. | `pnpm web:e2e` |
| FR-FONT-01 | github.com/rsms/inter release v4.1 (`Inter-4.1.zip`, sha256 `9883fdd4…6b11e`) | 2026-09-24 | Inter 4.1 | `web/InterVariable.woff2` sha256 `693b77d4…29a8e3`, `web/InterVariable-Italic.woff2` sha256 `e564f652…7a262a`, licence SIL OFL 1.1 (`LICENSE-Inter.txt`). | none | `sha256sum apps/web/src/assets/fonts/*.woff2` |
| FR-LUCIDE-01 | npm registry publish times | 2026-09-24 | lucide-react 1.47.0 | 1.48.0 was published 11 hours before install and was refused by `minimumReleaseAge`; 1.47.0 (2026-09-17) pinned. | none | `pnpm install` |
| FR-TEST-01 | Installed `@vitejs/plugin-react@6.1.1`, vitest 5.0.1, vite 8.3.0 | 2026-09-24 | as listed | Plugin peer `vite ^8` satisfied; jsdom 30.1.1 needs Radix shims (`hasPointerCapture`, `scrollIntoView`, `ResizeObserver`) added in `packages/ui/test/setup.ts`. | none | `pnpm exec vitest run --project web` |
| FR-W13/W14 | Build prompt fact-check register (W3C reflow and target size) | carried forward | n/a | 320 CSS px reflow with two-dimensional exceptions; AA target minimum 24 px, project target 44 px. | Not re-fetched (w3.org not probed). | reflow assertion in e2e |
