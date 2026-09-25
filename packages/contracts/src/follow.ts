import { z } from 'zod';
import { idSchema } from './identity.js';
import { registryRecordStatusSchema } from './registry.js';

/**
 * Following a public strategy (F08). A follow is bookkeeping on the
 * person's account: it subscribes them to the strategy's registered
 * versions on their pages and lists. It never pins a portfolio instance,
 * never places an order and never changes the strategy. Only a strategy
 * with a registered, unmoderated version can be followed, and a follow
 * never shows the owner's private draft.
 */
export const FOLLOWS_MAX = 500;

export const strategyFollowSchema = z.object({
  strategyId: idSchema,
  followedAt: z.iso.datetime(),
  /** The newest registered, unmoderated version at read time; null when none is public any more. */
  latestVersion: z
    .object({
      versionId: idSchema,
      versionNumber: z.number().int().positive(),
      title: z.string(),
      status: registryRecordStatusSchema,
      registeredAt: z.iso.datetime(),
    })
    .nullable(),
});
export type StrategyFollow = z.infer<typeof strategyFollowSchema>;

export const followListResponseSchema = z.object({
  follows: z.array(strategyFollowSchema).max(FOLLOWS_MAX),
});
export type FollowListResponse = z.infer<typeof followListResponseSchema>;
