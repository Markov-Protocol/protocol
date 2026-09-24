import 'server-only';
import { validateWebEnv, type WebEnv } from '../config/web-env';

let cached: WebEnv | null = null;

/** Validated web configuration for server components and route handlers. */
export function webEnv(): WebEnv {
  if (cached === null) {
    cached = validateWebEnv(process.env);
  }
  return cached;
}
