import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { generateFixtureKeys, installFixtureWallet } from './fixture-wallet';

const evidenceDir = new URL('../../../docs/frontend/evidence/F04/', import.meta.url).pathname;
const RPC_CONTROL = `http://127.0.0.1:${process.env['MARKOV_E2E_RPC_PORT'] ?? '3901'}/fixture/funding`;
const COOKIE = '__Host-markov_session';

test.skip(
  !process.env['MARKOV_TEST_DATABASE_URL'],
  'wallet journeys need the real API (set MARKOV_TEST_DATABASE_URL; see docs/frontend/verification.md)',
);

let clientCounter = 0;

/** Each project (desktop, phone) gets its own accounts so journeys never see another profile's wallets or decisions. */
function subjectFor(
  name: string,
  testInfo: { readonly project: { readonly name: string } },
): string {
  // Kept under 24 characters so the account menu shows the full subject.
  return `did:test:${name}-${testInfo.project.name.startsWith('phone') ? 'p' : 'd'}`;
}

async function signIn(
  page: Page,
  subject: string,
  next = '/settings/wallets',
  options: { readonly switching?: boolean } = {},
): Promise<void> {
  await page.goto(
    `/sign-in?${options.switching ? 'switch=1&' : ''}next=${encodeURIComponent(next)}`,
  );
  await page.getByLabel('Subject', { exact: false }).fill(subject);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (char) => `\\${char}`)}$`));
}

async function connectFixture(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Choose Fixture Wallet' }).click();
  const connected = page.getByTestId('connected-wallet');
  await expect(connected).toBeVisible();
  return (await page.getByTestId('connected-address').textContent()) ?? '';
}

async function setFunding(
  page: Page,
  address: string,
  lamports: number,
  stablecoinRaw: string,
): Promise<void> {
  const response = await page.request.post(RPC_CONTROL, {
    data: { address, lamports, stablecoinRaw },
  });
  expect(response.ok()).toBe(true);
}

async function sessionCookieHeader(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((candidate) => candidate.name === COOKIE);
  if (!cookie) {
    throw new Error('session cookie missing');
  }
  return `${COOKIE}=${cookie.value}`;
}

test.describe('wallet, eligibility and funding readiness', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test.beforeEach(async ({ context }, testInfo) => {
    clientCounter += 1;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `10.${(testInfo.parallelIndex + 40) % 200}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
    });
  });

  test('chooses a wallet explicitly, verifies ownership, shows funding and updates readiness', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    const alice = subjectFor('w-alice', testInfo);
    await signIn(page, alice);

    // Nothing is connected until chosen; the readiness facts are separate.
    await expect(page.getByRole('heading', { level: 1, name: 'Wallets' })).toBeVisible();
    await expect(
      page.getByText('No wallet is connected. Choose one below; Markov never picks one for you.'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __fixtureWalletCalls: { connect: number } }).__fixtureWalletCalls
            .connect,
      ),
    ).toBe(0);
    await expect(page.getByText('No verified wallet yet')).toBeVisible();
    await expect(page.getByTestId('wallet-chip').filter({ visible: true }).first()).toContainText(
      'No wallet connected',
    );
    await page.screenshot({
      path: `${evidenceDir}wallets-choose-${page.viewportSize()?.width}.png`,
    });

    const address = await connectFixture(page);
    expect(address.length).toBeGreaterThanOrEqual(32);
    await expect(page.getByText('Ownership not verified')).toBeVisible();
    await expect(page.getByText('Network: devnet')).toBeVisible();
    await expect(page.getByTestId('wallet-chip').filter({ visible: true }).first()).toContainText(
      'Unverified',
    );

    // The exact challenge text is shown before the wallet signs it.
    const linkRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith('/api/markov/v1/me/wallets'),
    );
    await page.getByTestId('verify-ownership').click();
    await expect(page.getByText('Wallet verified')).toBeVisible();
    const sent = await linkRequest;
    expect(sent.postDataJSON()).toMatchObject({ address });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('verified-wallet')).toContainText(address);
    await expect(page.getByText('Verified owner').first()).toBeVisible();
    await expect(page.getByTestId('wallet-chip').filter({ visible: true }).first()).toContainText(
      'Verified',
    );
    await expect(page.getByRole('button', { name: 'Ownership verified' })).toBeDisabled();
    await page.screenshot({
      path: `${evidenceDir}wallets-verified-${page.viewportSize()?.width}.png`,
    });

    // Funding: balances only after the network shows them; SOL fees are separate from USDC.
    await setFunding(page, address, 9_000, '250000000');
    await page.getByRole('button', { name: 'Receive and funding' }).click();
    const panel = page.getByTestId('funding-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Needs SOL for fees')).toBeVisible();
    await expect(panel.getByTestId('receive-address')).toHaveText(address);
    await expect(panel.getByTestId('qr-code')).toBeVisible();
    await expect(panel.getByTestId('sol-balance')).toHaveText('0.000009 SOL');
    await expect(panel.getByTestId('stablecoin-balance')).toHaveText('250 USDC');
    await expect(panel.getByTestId('required-lamports')).toContainText('(not covered)');
    await expect(panel.getByText(/never gives you a pooled deposit address/)).toBeVisible();
    await expect(
      panel.getByText(/Bridges, fiat onramps and fee sponsorship are not integrated/),
    ).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}funding-needs-sol-${page.viewportSize()?.width}.png`,
    });
    await setFunding(page, address, 1_000_000_000, '250000000');
    await panel.getByRole('button', { name: 'Refresh' }).click();
    await expect(panel.getByText('Funded')).toBeVisible();
    await expect(panel.getByTestId('sol-balance')).toHaveText('1 SOL');
    await expect(panel.getByTestId('required-lamports')).toContainText('(covered)');

    // Home lists only what is still needed.
    await page.goto('/');
    const checklist = page.getByRole('region', { name: 'Before your first strategy' });
    await expect(checklist.getByText('Choose and verify a wallet')).toBeVisible();
    await expect(checklist.getByText('Done').first()).toBeVisible();
    await expect(
      checklist.getByRole('link', { name: 'Resolve eligibility and terms' }),
    ).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}home-readiness-${page.viewportSize()?.width}.png`,
    });

    // Disconnecting the wallet keeps the session.
    await page.goto('/settings/wallets');
    await page.getByRole('button', { name: 'Disconnect wallet' }).click();
    await expect(
      page.getByText('No wallet is connected. Choose one below; Markov never picks one for you.'),
    ).toBeVisible();
    await expect(page.getByTestId('verified-wallet')).toContainText(address);
    await expect(
      page.getByRole('button', { name: `Account menu for ${alice}` }).filter({ visible: true }),
    ).toBeVisible();
  });

  test('refuses to request a signature from a wallet on the wrong network', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, {
      keys: generateFixtureKeys(),
      chains: ['solana:mainnet'],
    });
    let challenges = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/markov/v1/me/wallets/challenges')) {
        challenges += 1;
      }
    });
    await signIn(page, subjectFor('w-mainnet', testInfo));
    await connectFixture(page);
    await expect(page.getByText('This wallet account is on another network')).toBeVisible();
    await expect(page.getByText('Network mismatch')).toBeVisible();
    await expect(page.getByTestId('verify-ownership')).toBeDisabled();
    await expect(page.getByTestId('wallet-chip').filter({ visible: true }).first()).toContainText(
      'Wrong network',
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __fixtureWalletCalls: { sign: number } }).__fixtureWalletCalls
            .sign,
      ),
    ).toBe(0);
    expect(challenges).toBe(0);
    await page.screenshot({
      path: `${evidenceDir}wallets-wrong-network-${page.viewportSize()?.width}.png`,
    });
  });

  test('rejects a replayed signature and a wallet already verified on another account', async ({
    browser,
    page,
    context,
  }, testInfo) => {
    const keys = generateFixtureKeys();
    await installFixtureWallet(context, { keys });
    await signIn(page, subjectFor('w-first', testInfo));
    const address = await connectFixture(page);
    const linkRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith('/api/markov/v1/me/wallets'),
    );
    await page.getByTestId('verify-ownership').click();
    await expect(page.getByText('Wallet verified')).toBeVisible();
    const sent = await linkRequest;

    // Presenting the same signed challenge again is refused by the API through the app's own proxy.
    const replay = await page.request.post('/api/markov/v1/me/wallets', {
      headers: {
        cookie: await sessionCookieHeader(context),
        origin: new URL(page.url()).origin,
        'content-type': 'application/json',
      },
      data: sent.postDataJSON(),
    });
    expect(replay.status()).toBe(409);
    expect((await replay.json()).error.code).toBe('CHALLENGE_INVALID');

    // Another account with the same wallet gets the recovery guidance, never an automatic transfer.
    const other = await browser.newContext();
    try {
      await other.setExtraHTTPHeaders({
        'x-forwarded-for': `10.77.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
      });
      await installFixtureWallet(other, { keys });
      const otherPage = await other.newPage();
      await signIn(otherPage, subjectFor('w-second', testInfo));
      const sameAddress = await connectFixture(otherPage);
      expect(sameAddress).toBe(address);
      await otherPage.getByTestId('verify-ownership').click();
      await expect(
        otherPage.getByText('This wallet is already verified on another Markov account.'),
      ).toBeVisible();
      await expect(
        otherPage.getByText(/Markov never moves a wallet between accounts on its own/),
      ).toBeVisible();
      await otherPage.screenshot({
        path: `${evidenceDir}wallets-already-linked-${otherPage.viewportSize()?.width}.png`,
      });
      await otherPage.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(otherPage.getByText('No verified wallet yet')).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('discards a signature obtained before the account switched', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, { keys: generateFixtureKeys(), holdSignatures: true });
    let linkPosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/markov/v1/me/wallets')) {
        linkPosts += 1;
      }
    });
    await signIn(page, subjectFor('w-switch-a', testInfo));
    await connectFixture(page);
    await page.getByTestId('verify-ownership').click();
    await expect(page.getByTestId('challenge-message')).toBeVisible();

    // The person switches account in another tab while the wallet prompt is open.
    const second = await context.newPage();
    const bob = subjectFor('w-switch-b', testInfo);
    await signIn(second, bob, '/', { switching: true });
    await expect(
      page.getByRole('button', { name: `Account menu for ${bob}` }).filter({ visible: true }),
    ).toBeVisible();

    await page.evaluate(() =>
      (window as unknown as { __releaseSignature: () => void }).__releaseSignature(),
    );
    await expect(page.getByText('Wallet verified')).toHaveCount(0);
    await expect(
      page.getByText('No wallet is connected. Choose one below; Markov never picks one for you.'),
    ).toBeVisible();
    expect(linkPosts).toBe(0);
    const wallets = await second.request.get('/api/markov/v1/me/wallets', {
      headers: { cookie: await sessionCookieHeader(context) },
    });
    expect(await wallets.json()).toEqual({ wallets: [] });
    await second.close();
  });

  test('shows eligibility as unknown, denied or eligible exactly as decided, and records terms by hash', async ({
    page,
    context,
  }, testInfo) => {
    await installFixtureWallet(context, { keys: generateFixtureKeys() });
    await signIn(page, subjectFor('elig-alice', testInfo), '/settings/eligibility');
    await expect(page.getByTestId('eligibility-outcome')).toHaveText('Unknown');
    await expect(page.getByTestId('step-declare_jurisdiction')).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}eligibility-unknown-${page.viewportSize()?.width}.png`,
    });

    const declare = async (code: string) => {
      const update = page.getByTestId('update-declaration');
      if ((await update.count()) > 0) {
        await update.locator('summary').click();
      }
      const form = page.getByRole('form', { name: 'Declare your jurisdiction' });
      await form.getByLabel('Country of residence', { exact: false }).fill(code);
      await form.getByRole('checkbox').check();
      await form.getByRole('button', { name: 'Record declaration' }).click();
    };
    await declare('XX');
    await expect(page.getByTestId('eligibility-outcome')).toHaveText('Not eligible');
    await expect(
      page.getByText(/Declaring another country to get around this is not allowed/),
    ).toBeVisible();
    await expect(page.getByText('fixture jurisdiction XX is denied')).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}eligibility-denied-${page.viewportSize()?.width}.png`,
    });

    await declare('ZZ');
    await expect(page.getByTestId('eligibility-outcome')).toHaveText('Eligible');
    await expect(page.getByText('Terms pending')).toBeVisible();
    await expect(page.getByText(/SHA-256 [0-9a-f]{64}/)).toBeVisible();
    await page.getByRole('button', { name: 'I have read and acknowledge this version' }).click();
    await expect(page.getByText('Terms acknowledged')).toBeVisible();
    await expect(page.getByText('Acknowledged').first()).toBeVisible();
    await expect(page.getByTestId('step-verify_wallet')).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}eligibility-eligible-${page.viewportSize()?.width}.png`,
    });

    await page.goto('/');
    const checklist = page.getByRole('region', { name: 'Before your first strategy' });
    await expect(checklist.getByRole('link', { name: 'Choose and verify a wallet' })).toBeVisible();
    await expect(
      checklist.getByText('Eligible under policy 2026-09-24; terms acknowledged.'),
    ).toBeVisible();
  });
});
