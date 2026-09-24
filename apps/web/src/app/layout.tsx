import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
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
  // No public product surface exists yet; indexing is enabled route by route from F02 onward.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-screen text-text antialiased">{children}</body>
    </html>
  );
}
