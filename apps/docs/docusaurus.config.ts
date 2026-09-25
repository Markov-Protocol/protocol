import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

/**
 * markov.pet/docs. The site is generated from the repository at build time:
 * the API reference from docs/markov/openapi.json, the CLI reference from
 * the command tree, and the backend, app and session documents from docs/.
 * Every page carries an edit link to its source file.
 */
const REPOSITORY = 'https://github.com/Markov-Protocol/protocol';
const BRANCH = 'main';

function editUrl({ docPath }: { docPath: string }): string | undefined {
  if (docPath.startsWith('reference/')) {
    return `${REPOSITORY}/edit/${BRANCH}/docs/${docPath.slice('reference/'.length)}`;
  }
  if (docPath.startsWith('api/')) {
    return `${REPOSITORY}/blob/${BRANCH}/docs/markov/openapi.json`;
  }
  if (docPath.startsWith('cli/')) {
    return `${REPOSITORY}/blob/${BRANCH}/apps/cli/src/program.ts`;
  }
  return `${REPOSITORY}/edit/${BRANCH}/apps/docs/docs/${docPath}`;
}

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
        { href: REPOSITORY, label: 'GitHub', position: 'right' },
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
            { label: 'Repository', href: REPOSITORY },
          ],
        },
      ],
      copyright:
        'Generated from the Markov repository at build time. Nothing here is investment advice, a promise of liquidity, or a claim that anything is deployed: every capability carries its verification state.',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'rust', 'diff'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
