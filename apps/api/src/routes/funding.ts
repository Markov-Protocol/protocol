import { errorResponseSchema, idSchema, walletFundingResponseSchema } from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { FundingService } from '../funding/service.js';

export interface FundingRoutesOptions {
  readonly funding: FundingService;
}

const errorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};

/** Observed funding of the person's own verified wallets; never a pooled deposit address. */
export const fundingRoutes: FastifyPluginAsyncZod<FundingRoutesOptions> = async (
  app,
  { funding },
) => {
  app.get(
    '/v1/me/wallets/:walletId/funding',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('portfolio:read')],
      schema: {
        tags: ['identity'],
        summary: 'Observed SOL and stablecoin balances of a verified wallet with fee requirements',
        description:
          'Reads the configured RPC endpoint at request time. Reports the network, the stablecoin mint observed, the rent-exempt minimum for a token account and the base fee allowance, and a readiness verdict. 503 when the endpoint cannot be read: balances are unknown, never zero.',
        params: z.object({ walletId: idSchema }),
        response: { 200: walletFundingResponseSchema, ...errorResponses },
      },
    },
    async (request) => funding.walletFunding(principalOf(request), request.params.walletId),
  );
};
