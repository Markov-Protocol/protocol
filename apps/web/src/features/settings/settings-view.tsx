'use client';

import { StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { ReadinessSummary } from '../wallets/readiness-summary';

const sections = [
  {
    href: '/settings/wallets',
    label: 'Wallets',
    detail: 'Verified wallets, connection, receive and funding status.',
    available: true,
  },
  {
    href: '/settings/eligibility',
    label: 'Eligibility and terms',
    detail: 'Your declaration, the decision and the terms to acknowledge.',
    available: true,
  },
  {
    href: null,
    label: 'Profile, sessions, appearance',
    detail: 'Not built yet (planned for session P17).',
    available: false,
  },
  {
    href: null,
    label: 'Balance privacy and notifications',
    detail: 'Not built yet (planned for sessions P13 and P17).',
    available: false,
  },
  {
    href: null,
    label: 'Connected devices and agent credentials',
    detail: 'Not built yet (planned for session P17).',
    available: false,
  },
] as const;

/** Settings index: real sections link; the rest say they are not built yet and which session plans them. */
export function SettingsView() {
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Settings</h1>
        <ReadinessSummary compact />
      </header>
      <ul className="space-y-2">
        {sections.map((section) => (
          <li
            key={section.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border/60 p-3"
          >
            <div>
              <p className="font-medium">
                {section.href ? (
                  <Link href={section.href} className="underline underline-offset-2">
                    {section.label}
                  </Link>
                ) : (
                  section.label
                )}
              </p>
              <p className="text-supporting text-text-muted">{section.detail}</p>
            </div>
            <StatusBadge tone={section.available ? 'success' : 'neutral'}>
              {section.available ? 'Available' : 'Not yet'}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}
