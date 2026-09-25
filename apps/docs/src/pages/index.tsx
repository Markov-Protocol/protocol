import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import type { ReactElement } from 'react';
import { PixelEyes } from '../components/PixelEyes';
import styles from './index.module.css';

const STEPS: ReadonlyArray<{
  readonly step: string;
  readonly label: string;
  readonly copy: string;
  readonly result: string;
}> = [
  {
    step: '01',
    label: 'Research',
    copy: 'Find the companies and exposures behind your idea.',
    result: 'Sourced thesis and eligible instrument shortlist',
  },
  {
    step: '02',
    label: 'Assemble',
    copy: 'Turn your thesis into a portfolio you can explain.',
    result: 'Explicit instrument selection and exact weights',
  },
  {
    step: '03',
    label: 'Set Rules',
    copy: 'Choose your budget, limits, and approval preferences.',
    result: 'Validated allocation plus owner-specific policy',
  },
  {
    step: '04',
    label: 'Activate',
    copy: 'Review the plan, authorize execution, and follow the results.',
    result: 'Approved transactions and reconciled holdings',
  },
];

const CARDS: ReadonlyArray<{ readonly to: string; readonly title: string; readonly copy: string }> =
  [
    {
      to: '/getting-started/run-locally',
      title: 'Run it locally',
      copy: 'PostgreSQL, Temporal, the API, the worker and the app from a clean checkout, then the headless startup check that exercises every journey.',
    },
    {
      to: '/api',
      title: 'API reference',
      copy: 'Every route with its parameters, bodies and responses, generated from the OpenAPI document the API itself exports.',
    },
    {
      to: '/cli',
      title: 'CLI reference',
      copy: 'The markov command tree, generated from the program definition, with the flows the startup check runs.',
    },
    {
      to: '/reference/markov/accounting-methodology',
      title: 'Accounting and performance',
      copy: 'Raw units, the balanced journal, FIFO lots, reconciliation, receipts, valuation, returns and rankings, with worked fixtures.',
    },
    {
      to: '/reference/markov/provider-capabilities',
      title: 'What is verified',
      copy: 'Each capability is IMPLEMENTED, FIXTURE_VERIFIED, LIVE_READ_VERIFIED, LIVE_WRITE_VERIFIED, BLOCKED or DISABLED, with its evidence and blocker.',
    },
    {
      to: '/reference/frontend',
      title: 'The markov.pet app',
      copy: 'Routes and journeys, the Mark I shell, the design system, accessibility, security and the browser evidence.',
    },
  ];

export default function Home(): ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Markov documentation" description={siteConfig.tagline}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <PixelEyes className={clsx(styles.eyes)} />
          <p className={styles.kicker}>markov.pet documentation</p>
          <h1 className={styles.title}>
            Explainable stock portfolios, executed with your permission.
          </h1>
          <p className={styles.tagline}>{siteConfig.tagline}</p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/intro">
              Start here
            </Link>
            <Link
              className="button button--secondary button--lg"
              to="/getting-started/startup-check"
            >
              See the verified journey
            </Link>
          </div>
        </section>

        <section className={styles.steps} aria-labelledby="steps-heading">
          <h2 id="steps-heading" className={styles.sectionTitle}>
            Four steps, one deterministic backend
          </h2>
          <ol className={styles.stepList}>
            {STEPS.map((entry) => (
              <li key={entry.step} className={styles.step}>
                <span className={styles.stepNumber}>{entry.step}</span>
                <span className={styles.stepLabel}>{entry.label}</span>
                <span className={styles.stepCopy}>{entry.copy}</span>
                <span className={styles.stepResult}>{entry.result}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.cards} aria-labelledby="cards-heading">
          <h2 id="cards-heading" className={styles.sectionTitle}>
            Where to go
          </h2>
          <div className={styles.cardGrid}>
            {CARDS.map((card) => (
              <Link key={card.to} to={card.to} className={clsx(styles.card)}>
                <span className={styles.cardTitle}>{card.title}</span>
                <span className={styles.cardCopy}>{card.copy}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.honesty} aria-labelledby="honesty-heading">
          <h2 id="honesty-heading" className={styles.sectionTitle}>
            How to read these pages
          </h2>
          <p>
            The site is generated from the repository at build time: the API reference from the
            OpenAPI document the API exports, the CLI reference from the command tree, and the
            contract, app and session documents from <code>docs/</code>. A capability is described
            with its verification state, and a fixture-verified capability is exactly that:
            exercised against sanitised fixtures and the in-memory fixture chain, not against a live
            venue or cluster. A reference price is not an executable quote, a transaction signature
            is not settlement, and a model series is not anyone's account.
          </p>
        </section>
      </main>
    </Layout>
  );
}
