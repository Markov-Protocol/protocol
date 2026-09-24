import 'server-only';
import { forwardedFor, markovApi } from '../api';
import { webEnv } from '../web-env';
import type { AuthHandlerDeps } from './handlers';

/** Production wiring for the auth route handlers. */
export function authDeps(): AuthHandlerDeps {
  return {
    env: webEnv(),
    api: (bearer, context) => markovApi(bearer, context),
    fetch: (request) => fetch(request),
    forwardedFor,
  };
}
