import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type BrowserContext, type Cookie, expect, type Page, test } from '@playwright/test';
import { E2E_API_ORIGIN } from '../playwright.config';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const evidenceDir = new URL('../../../docs/frontend/evidence/F03/', import.meta.url).pathname;
const COOKIE = '__Host-markov_session';

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'auth journeys need the real API (set MARKOV_TEST_DATABASE_URL; see docs/frontend/verification.md)',
);

async function sessionCookie(context: BrowserContext): Promise<Cookie> {
  const cookie = (await context.cookies()).find((candidate) => candidate.name === COOKIE);
  if (!cookie) {
    throw new Error('session cookie missing');
  }
  return cookie;
}

async function signIn(page: Page, subject: string): Promise<void> {
  await page.getByLabel('Subject', { exact: false }).fill(subject);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

function accountMenu(page: Page, subject: string) {
  return page
    .getByRole('button', { name: `Account menu for ${subject}` })
    .filter({ visible: true });
}

let clientCounter = 0;

test.describe('sessions and account recovery', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  // Each test is one person at one address: the app forwards X-Forwarded-For
  // to the API, whose sign-in limits are per client address (10 per minute).
  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${testInfo.parallelIndex % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('signs in from a private route, returns there, survives a reload and signs out', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/portfolio');
    await expect(page.getByText('Connected · devnet')).toBeVisible();
    await page
      .getByRole('link', { name: 'Sign in', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fportfolio$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Nonproduction')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}sign-in-1280.png` });

    // Accessibility of the sign-in screen.
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              c: Document,
              o: object,
            ) => Promise<{ violations: { impact: string; id: string }[] }>;
          };
        }
      ).axe;
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      return result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => v.id);
    });
    expect(violations).toEqual([]);

    await signIn(page, 'did:test:alice');
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(accountMenu(page, 'did:test:alice')).toBeVisible();

    const cookie = await sessionCookie(context);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.domain).toBe('127.0.0.1');
    expect(cookie.value).toMatch(/^mkv_ss_/);
    // The credential never appears in the URL or the page. Boolean checks, so a
    // failure message never echoes a credential into the retained evidence.
    expect(page.url().includes('mkv_ss_'), 'credential in the URL').toBe(false);
    expect((await page.content()).includes('mkv_ss_'), 'credential in the page').toBe(false);

    await page.reload();
    await expect(accountMenu(page, 'did:test:alice')).toBeVisible();
    // Playwright's request context does not attach Secure cookies over plain http, so the cookie is sent explicitly.
    const session = await page.request.get('/api/auth/session', {
      headers: { cookie: `${COOKIE}=${cookie.value}` },
    });
    expect(session.headers()['cache-control']).toBe('no-store');
    expect(await session.json()).toMatchObject({
      state: 'signed-in',
      account: { subject: 'did:test:alice' },
    });

    await page.goto('/');
    await expect(page.getByText('Signed in as did:test:alice')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before your first strategy' })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}home-signed-in-1280.png` });

    await accountMenu(page, 'did:test:alice').click();
    await page.screenshot({ path: `${evidenceDir}account-menu-1280.png` });
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('link', { name: 'Sign in', exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText('Signed in as')).toHaveCount(0);

    // Replaying the old cookie after sign-out is refused by the server.
    const replayed = await page.request.get('/api/auth/session', {
      headers: { cookie: `${COOKIE}=${cookie.value}` },
    });
    expect(await replayed.json()).toEqual({ state: 'signed-out' });
    expect(
      (replayed.headers()['set-cookie'] ?? '').includes('Max-Age=0'),
      'the replay clears the cookie',
    ).toBe(true);
  });

  test('recovers from an expired session with the return path preserved', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/sign-in?next=%2Frankings');
    await signIn(page, 'did:test:alice');
    await expect(page).toHaveURL(/\/rankings$/);
    const cookie = await sessionCookie(context);

    // The session ends on the server (revocation stands in for expiry; the client cannot tell them apart).
    const revoked = await page.request.delete(`${E2E_API_ORIGIN}/v1/auth/sessions/current`, {
      headers: { authorization: `Bearer ${cookie.value}` },
    });
    expect(revoked.status()).toBe(204);

    // A back/forward-cache restore re-verifies before anything private is shown.
    await page.evaluate(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await expect(page.getByText('Your session has expired')).toBeVisible();
    await expect(page.getByText('Session expired')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}expired-1280.png` });
    await page.getByRole('link', { name: 'Sign in again' }).first().click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Frankings$/);
    await signIn(page, 'did:test:alice');
    await expect(page).toHaveURL(/\/rankings$/);
    await expect(accountMenu(page, 'did:test:alice')).toBeVisible();
  });

  test('switching accounts revokes the previous session and shows no data from it', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/sign-in');
    await signIn(page, 'did:test:alice');
    await expect(page.getByText('Signed in as did:test:alice')).toBeVisible();
    const alice = await sessionCookie(context);

    await accountMenu(page, 'did:test:alice').click();
    await page.getByRole('menuitem', { name: 'Switch account' }).click();
    await expect(page).toHaveURL(/\/sign-in\?switch=1/);
    await expect(page.getByText('You are signed in as did:test:alice')).toBeVisible();
    await signIn(page, 'did:test:bob');
    await expect(page.getByText('Signed in as did:test:bob')).toBeVisible();
    await expect(page.getByText('did:test:alice')).toHaveCount(0);
    const bob = await sessionCookie(context);
    expect(bob.value).not.toBe(alice.value);

    const aliceAtApi = await page.request.get(`${E2E_API_ORIGIN}/v1/me`, {
      headers: { authorization: `Bearer ${alice.value}` },
    });
    expect(aliceAtApi.status()).toBe(401);
  });

  test('never follows an external return target', async ({ page }) => {
    for (const target of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      '/sign-in',
    ]) {
      await page.goto(`/sign-in?next=${encodeURIComponent(target)}`);
      await expect(page.getByText('After sign-in you return to /', { exact: false })).toBeVisible();
    }
    await page.goto('/sign-in?next=https%3A%2F%2Fevil.example');
    await signIn(page, 'did:test:carol');
    await expect(page).toHaveURL('http://127.0.0.1:3100/');
  });

  test('refuses unauthorized direct API access and cross-origin mutations', async ({ page }) => {
    await page.goto('/');
    const anonymous = await page.request.get(`${E2E_API_ORIGIN}/v1/me`);
    expect(anonymous.status()).toBe(401);
    const garbage = await page.request.get(`${E2E_API_ORIGIN}/v1/me`, {
      headers: { authorization: `Bearer mkv_ss_notreal00_${'a'.repeat(43)}` },
    });
    expect(garbage.status()).toBe(401);
    // From the page itself the API is a different origin with no CORS allowance.
    const blocked = await page.evaluate(async (origin) => {
      try {
        await fetch(`${origin}/v1/me`, { credentials: 'include' });
        return 'allowed';
      } catch {
        return 'blocked';
      }
    }, E2E_API_ORIGIN);
    expect(blocked).toBe('blocked');

    const crossOrigin = await page.request.post('/api/auth/sign-out', {
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(crossOrigin.status()).toBe(403);
    const formPost = await page.request.post('/api/auth/sign-in', {
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: 'provider=test&subject=did:test:mallory',
    });
    expect(formPost.status()).toBe(403);
    const anonymousSession = await page.request.get('/api/auth/session');
    expect(await anonymousSession.json()).toEqual({ state: 'signed-out' });
  });

  test('explains cancelled, failed, unsupported and empty provider callbacks', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/callback?error=access_denied');
    await expect(page.getByText('Sign-in was cancelled')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}callback-cancelled-390.png` });
    await page.goto(
      '/auth/callback?error=server_error&error_description=upstream%20timeout%3Cscript%3E',
    );
    await expect(page.getByText('Sign-in did not complete')).toBeVisible();
    await expect(page.getByText('Provider message: upstream timeout<script>')).toBeVisible();
    await page.goto('/auth/callback?code=abc&state=xyz');
    await expect(page.getByText('not connected in this build')).toBeVisible();
    await page.goto('/auth/callback');
    await expect(page.getByText('No sign-in is in progress')).toBeVisible();
    await page.getByRole('link', { name: 'Go to sign-in' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
