import { colorTokens } from '@markov/ui';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { PrivateQueryProvider } from '@/features/auth/private-query-provider';
import { SessionProvider } from '@/features/auth/session-context';
import { WalletProvider } from '@/features/wallets/wallet-context';
import { currentPlatform, currentSession } from '@/server/auth/current';
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
  themeColor: colorTokens.frameCream,
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Every request resolves the session and platform facts on the server, so
 * the first paint already knows who is signed in and whether the backend
 * answers. Private pages are therefore never statically cached.
 */
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [session, platform] = await Promise.all([currentSession(), currentPlatform()]);
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-frame text-text antialiased">
        <SessionProvider
          initial={session.snapshot}
          staleCookie={session.staleCookie}
          platform={platform}
        >
          <WalletProvider>
            <PrivateQueryProvider>
              <AppShell>{children}</AppShell>
            </PrivateQueryProvider>
          </WalletProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
