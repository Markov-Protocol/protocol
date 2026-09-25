import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';
import { linksFor, readBuildSource } from './scripts/source-metadata.mjs';

/**
 * markov.pet/docs. The site is generated from the repository at build time:
 * the API reference from docs/markov/openapi.json, the CLI reference from
 * the command tree, and the repository documents the content manifest
 * (content-manifest.json) lists. Where the build comes from is resolved once
 * by scripts/sync-content.mjs (generated/source.json): edit links open the
 * maintained branch, source links pin the built commit, and the footer says
 * which revision this is, or that it is a local build without one.
 */
const root = resolve(__dirname, '..', '..');
const source = readBuildSource(root);
const links = linksFor(source);
const manifest = JSON.parse(readFileSync(resolve(__dirname, 'content-manifest.json'), 'utf8')) as {
  readonly sitePages: readonly { readonly id: string; readonly source: string }[];
};
const sitePages = new Map(manifest.sitePages.map((page) => [`${page.id}.md`, page.source]));

/**
 * Hand-written pages edit their file on the maintained branch; synced pages
 * carry their own edit URL in front matter; generated pages (API, CLI) have
 * none: their note links the input and the generator instead.
 */
function editUrl({ docPath }: { docPath: string }): string | undefined {
  const page = sitePages.get(docPath);
  return page ? links.edit(page) : undefined;
}

const commitUrl = links.commit();
const revision =
  source.commit && commitUrl
    ? `Built from commit <a href="${commitUrl}"><code>${source.commit.slice(0, 12)}</code></a>.`
    : source.state === 'local-uncommitted'
      ? 'Local build with uncommitted changes: no verified source revision.'
      : 'Source revision unknown: this build carried no commit metadata.';

const config: Config = {
  title: 'Markov documentation',
  tagline:
    'Turn an investment thesis into a versioned, executable portfolio of tokenized stock exposures, with explicit permissions and inspectable results.',
  favicon: 'img/favicon.svg',
  url: 'https://markov.pet',
  baseUrl: '/docs/',
  trailingSlash: false,
  organizationName: 'Markov-Protocol',
  projectName: 'protocol',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw' },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        docsRouteBasePath: '/',
        indexBlog: false,
        indexPages: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl,
          showLastUpdateTime: false,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/social-card.png',
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false },
    docs: { sidebar: { hideable: true, autoCollapseCategories: true } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
    mermaid: { theme: { light: 'neutral', dark: 'dark' } },
    navbar: {
      title: 'markov',
      hideOnScroll: false,
      items: [
        {
          to: '/intro',
          label: 'Docs',
          position: 'left',
          activeBaseRegex: '^/docs/(intro|getting-started|guides|contributing)',
        },
        { to: '/api', label: 'API', position: 'left', activeBaseRegex: '^/docs/api' },
        { to: '/cli', label: 'CLI', position: 'left', activeBaseRegex: '^/docs/cli' },
        {
          to: '/reference/markov/accounting-methodology',
          label: 'Methodology',
          position: 'left',
        },
        { href: 'https://markov.pet', label: 'App', position: 'right' },
        { href: source.repository, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'markov.pet app', href: 'https://markov.pet' },
            { label: 'Mark I devices (markov.trade)', href: 'https://markov.trade' },
            { label: 'Product scope', to: '/reference/markov/product-scope' },
          ],
        },
        {
          title: 'Reference',
          items: [
            { label: 'API', to: '/api' },
            { label: 'CLI', to: '/cli' },
            { label: 'Backend contract', to: '/reference/markov/architecture' },
            { label: 'App', to: '/reference/frontend' },
          ],
        },
        {
          title: 'Evidence',
          items: [
            { label: 'Provider capabilities', to: '/reference/markov/provider-capabilities' },
            { label: 'Open decisions', to: '/reference/markov/open-decisions' },
            { label: 'Session logs', to: '/reference/sessions/b01' },
            { label: 'Repository', href: source.repository },
          ],
        },
      ],
      copyright: `<span class="markov-build-source" data-source-state="${source.state}">${revision}</span> Generated from the Markov repository at build time. Nothing here is investment advice, a promise of liquidity, or a claim that anything is deployed: every capability carries its verification state.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'rust', 'diff'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
