import type { MarkovConfig } from '@markov/config';
import {
  type PlatformHealthInput,
  type PlatformHealthReport,
  platformHealthInputSchema,
  platformHealthReportSchema,
} from '@markov/contracts';
import type { DbClient } from '@markov/db';

export type { PlatformHealthInput, PlatformHealthReport } from '@markov/contracts';

export interface PlatformActivities {
  reportPlatformHealth(input: PlatformHealthInput): Promise<PlatformHealthReport>;
}

export interface ActivityDependencies {
  readonly config: MarkovConfig;
  readonly dbClient: DbClient;
  readonly genesisHash: string;
}

/**
 * Activities are the only place workflow code touches the outside world.
 * Every input is validated against its contract before use.
 */
export function createPlatformActivities(deps: ActivityDependencies): PlatformActivities {
  return {
    async reportPlatformHealth(rawInput) {
      const input = platformHealthInputSchema.parse(rawInput);
      const database = await deps.dbClient.ping();
      return platformHealthReportSchema.parse({
        status: 'ok',
        workerVersion: deps.config.serviceVersion,
        markovEnv: deps.config.markovEnv,
        solanaCluster: deps.config.solana.cluster,
        genesisHash: deps.genesisHash,
        database: { ok: database.ok, detail: database.detail, durationMs: database.durationMs },
        checkedAt: new Date().toISOString(),
        requestedBy: input.requestedBy,
      });
    },
  };
}
