import type { Principal } from '@markov/auth';
import { FOLLOWS_MAX, type FollowListResponse } from '@markov/contracts';
import {
  countFollows,
  type Database,
  type FollowRead,
  findPublicStrategy,
  followStrategy,
  listFollows,
  recordAuditEvent,
  unfollowStrategy,
} from '@markov/db';
import { ApiError } from '../errors.js';

export interface FollowServiceDeps {
  readonly db: Database;
  readonly now?: () => Date;
}

export interface FollowService {
  list(principal: Principal): Promise<FollowListResponse>;
  follow(
    principal: Principal,
    strategyId: string,
    requestId: string,
  ): Promise<{ follows: FollowListResponse; created: boolean }>;
  unfollow(
    principal: Principal,
    strategyId: string,
    requestId: string,
  ): Promise<FollowListResponse>;
}

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

function project(rows: readonly FollowRead[]): FollowListResponse {
  return {
    follows: rows.map((row) => ({
      strategyId: row.strategyId,
      followedAt: row.followedAt.toISOString(),
      latestVersion: row.latestVersion
        ? {
            versionId: row.latestVersion.versionId,
            versionNumber: row.latestVersion.versionNumber,
            title: row.latestVersion.title,
            status: row.latestVersion.status,
            registeredAt: row.latestVersion.registeredAt.toISOString(),
          }
        : null,
    })),
  };
}

/**
 * Follows (F08): subscribing to a public strategy's registered versions is
 * bookkeeping on the person's account; it never pins an instance, never
 * places an order and never touches the strategy or its owner's draft.
 */
export function createFollowService(deps: FollowServiceDeps): FollowService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async list(principal) {
      return project(await listFollows(db, ownerOf(principal)));
    },

    async follow(principal, strategyId, requestId) {
      const userId = ownerOf(principal);
      const target = await findPublicStrategy(db, strategyId);
      if (!target) {
        throw new ApiError('NOT_FOUND', 'no strategy with a registered version and that id');
      }
      if (target.strategy.ownerUserId === userId) {
        throw new ApiError('VALIDATION_FAILED', 'you cannot follow your own strategy');
      }
      if ((await countFollows(db, userId)) >= FOLLOWS_MAX) {
        throw new ApiError('VALIDATION_FAILED', `you can follow at most ${FOLLOWS_MAX} strategies`);
      }
      const result = await followStrategy(db, { userId, strategyId, now: now() });
      if (result.created) {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'strategy.follow',
          targetType: 'strategy',
          targetId: strategyId,
          requestId,
          details: {},
        });
      }
      return { follows: project(await listFollows(db, userId)), created: result.created };
    },

    async unfollow(principal, strategyId, requestId) {
      const userId = ownerOf(principal);
      const removed = await unfollowStrategy(db, { userId, strategyId });
      if (removed) {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'strategy.unfollow',
          targetType: 'strategy',
          targetId: strategyId,
          requestId,
          details: {},
        });
      }
      return project(await listFollows(db, userId));
    },
  };
}
