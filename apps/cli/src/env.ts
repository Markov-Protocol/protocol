import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load an env file into process.env when requested, or `.env` from the
 * working directory when present. Explicit variables always win.
 */
export function loadEnvFile(explicit: string | undefined): string | null {
  const candidate = explicit ?? (existsSync(resolve('.env')) ? resolve('.env') : null);
  if (candidate === null) {
    return null;
  }
  const path = resolve(candidate);
  if (!existsSync(path)) {
    throw new Error(`env file not found: ${path}`);
  }
  const before = { ...process.env };
  process.loadEnvFile(path);
  // process.loadEnvFile does not override existing variables; nothing else to do.
  for (const key of Object.keys(before)) {
    if (before[key] !== undefined) {
      process.env[key] = before[key];
    }
  }
  return path;
}
