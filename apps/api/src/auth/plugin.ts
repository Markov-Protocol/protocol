import { hasScope, type Principal } from '@markov/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { ApiError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export interface AuthPluginOptions {
  readonly authenticate: (bearer: string) => Promise<Principal | null>;
}

/**
 * Derives the principal from the Authorization header on every request. A
 * malformed or unknown bearer token is rejected immediately; a missing
 * header yields an anonymous request that routes may refuse.
 */
export const authPlugin = fp<AuthPluginOptions>(
  async (app: FastifyInstance, options: AuthPluginOptions) => {
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (header === undefined) {
        request.principal = null;
        return;
      }
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      if (!match) {
        throw new ApiError('AUTH_REQUIRED', 'malformed authorization header');
      }
      const principal = await options.authenticate(match[1] as string);
      if (principal === null) {
        throw new ApiError('AUTH_REQUIRED', 'the credential is unknown, expired or revoked');
      }
      request.principal = principal;
    });
  },
);

export function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) {
    throw new ApiError('AUTH_REQUIRED', 'authentication required');
  }
  return request.principal;
}

/** Route guard: the principal must belong to one of the classes. */
export function requireClass(...classes: Principal['class'][]): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const principal = principalOf(request);
    if (!classes.includes(principal.class)) {
      throw new ApiError('FORBIDDEN', 'this credential cannot perform the operation');
    }
  };
}

/** Route guard: the principal must hold the scope (owners hold every owner scope). */
export function requireScope(scope: string): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const principal = principalOf(request);
    if (!hasScope(principal, scope)) {
      throw new ApiError('FORBIDDEN', `missing scope ${scope}`);
    }
  };
}
