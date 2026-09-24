import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComponentReference } from '@/features/dev/component-reference';
import { webEnv } from '@/server/web-env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Component reference (internal)',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Internal component reference. Served only when MARKOV_WEB_INTERNAL_ROUTES
 * is enabled, which production configuration forbids.
 */
export default function ComponentReferencePage() {
  if (!webEnv().internalRoutesEnabled) {
    notFound();
  }
  return <ComponentReference />;
}
