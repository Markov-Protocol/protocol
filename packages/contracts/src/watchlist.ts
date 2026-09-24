import { z } from 'zod';
import { instrumentSchema } from './catalog.js';
import { idSchema } from './identity.js';

/**
 * Owner-scoped watchlist (F05). A versioned list of catalog instruments a
 * person chose to follow. Saving an instrument implies nothing about
 * eligibility or execution; only admitted or paused instruments can be
 * added, and an item whose instrument was later paused or delisted stays
 * visible with its current status so nobody is surprised.
 */
export const WATCHLIST_CONTRACT_VERSION = 1 as const;
export const WATCHLIST_MAX_ITEMS = 200;

export const watchlistItemSchema = z.object({
  instrumentId: idSchema,
  note: z.string().max(300).nullable(),
  addedAt: z.iso.datetime(),
  /** The instrument's current public projection (any status); null only if the catalog row vanished. */
  instrument: instrumentSchema.nullable(),
});
export type WatchlistItem = z.infer<typeof watchlistItemSchema>;

export const watchlistSchema = z.object({
  contractVersion: z.literal(WATCHLIST_CONTRACT_VERSION),
  /** Increments on every change; send it back as `ifVersion` to detect an edit made on another device. */
  version: z.number().int().nonnegative(),
  items: z.array(watchlistItemSchema).max(WATCHLIST_MAX_ITEMS),
  updatedAt: z.iso.datetime().nullable(),
});
export type Watchlist = z.infer<typeof watchlistSchema>;

export const watchlistItemRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .max(300)
    .refine((text) => !/[<>]/.test(text), 'markup is not allowed')
    .nullable()
    .default(null),
  /** Optimistic concurrency: refused with IDEMPOTENCY_CONFLICT when the list moved on. */
  ifVersion: z.number().int().nonnegative().optional(),
});
export type WatchlistItemRequest = z.infer<typeof watchlistItemRequestSchema>;

export const watchlistRemoveQuerySchema = z.object({
  ifVersion: z.coerce.number().int().nonnegative().optional(),
});
