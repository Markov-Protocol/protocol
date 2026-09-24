import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used only to generate SQL migrations from src/schema.ts.
 * Generated SQL is reviewed and committed under migrations/; runtime
 * migration is performed by `markov db migrate`, never by drizzle-kit push.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
