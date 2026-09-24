import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { AppShell } from '@/shell/app-shell';
import './globals.css';

/** Inter 4.1 (SIL Open Font License), self-hosted; provenance in docs/frontend/design-system.md. */
const inter = localFont({
  src: [
    { path: '../assets/fonts/InterVariable.woff2', style: 'normal' },
    { path: '../assets/fonts/InterVariable-Italic.woff2', style: 'italic' },
  ],
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Markov', template: '%s · Markov' },
  description: 'Build a stock strategy you can explain. Give it only the permissions you choose.',
  // No public product surface exists yet; indexing is enabled route by route once features ship.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#ECEBE6',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-frame text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
