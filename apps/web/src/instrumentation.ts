/**
 * Runs once per server start. The production guard refuses to serve when a
 * development switch (fixtures, internal routes) is enabled in production.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { validateWebEnv } = await import('./config/web-env');
    const env = validateWebEnv(process.env);
    console.info(
      `markov-web: MARKOV_ENV=${env.markovEnv} internalRoutes=${env.internalRoutesEnabled} fixtures=${env.fixturesEnabled}`,
    );
  }
}
