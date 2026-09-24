import type { Principal } from '@markov/auth';
import {
  type Instrument,
  WATCHLIST_CONTRACT_VERSION,
  WATCHLIST_MAX_ITEMS,
  type Watchlist,
  type WatchlistItemRequest,
} from '@markov/contracts';
import {
  addWatchlistItem,
  countWatchlistItems,
  type Database,
  findInstrument,
  type InstrumentRow,
  readWatchlist,
  recordAuditEvent,
  removeWatchlistItem,
  type WatchlistRead,
} from '@markov/db';
import type { CatalogService } from '../catalog/service.js';
import { ApiError } from '../errors.js';

export interface WatchlistServiceDeps {
  readonly db: Database;
  readonly catalog: CatalogService;
  readonly now?: () => Date;
}

export interface WatchlistService {
  get(principal: Principal): Promise<Watchlist>;
  add(
    principal: Principal,
    instrumentId: string,
    request: WatchlistItemRequest,
    requestId: string,
  ): Promise<Watchlist>;
  remove(
    principal: Principal,
    instrumentId: string,
    ifVersion: number | null,
    requestId: string,
  ): Promise<Watchlist>;
}

const SAVEABLE = new Set(['admitted', 'paused']);

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

/** Personal, versioned watchlists: saving an instrument is bookkeeping, never eligibility or execution. */
export function createWatchlistService(deps: WatchlistServiceDeps): WatchlistService {
  const { db, catalog } = deps;
  const now = deps.now ?? (() => new Date());

  const project = async (read: WatchlistRead): Promise<Watchlist> => {
    const rows = read.items
      .map((item) => item.instrument)
      .filter((row): row is InstrumentRow => row !== null);
    const projected = new Map<string, Instrument>(
      (await catalog.projectInstruments(rows)).map((instrument) => [
        instrument.instrumentId,
        instrument,
      ]),
    );
    return {
      contractVersion: WATCHLIST_CONTRACT_VERSION,
      version: read.version,
      updatedAt: read.updatedAt?.toISOString() ?? null,
      items: read.items.map((item) => ({
        instrumentId: item.instrumentId,
        note: item.note,
        addedAt: item.addedAt.toISOString(),
        instrument: projected.get(item.instrumentId) ?? null,
      })),
    };
  };

  const conflict = (version: number): ApiError =>
    new ApiError('IDEMPOTENCY_CONFLICT', 'the watchlist changed on another device', [
      { path: 'ifVersion', message: `the current version is ${version}` },
    ]);

  return {
    async get(principal) {
      return project(await readWatchlist(db, ownerOf(principal)));
    },

    async add(principal, instrumentId, request, requestId) {
      const userId = ownerOf(principal);
      const instrument = await findInstrument(db, instrumentId);
      if (!instrument) {
        throw new ApiError('NOT_FOUND', 'instrument not found');
      }
      if (!SAVEABLE.has(instrument.status)) {
        throw new ApiError(
          'ASSET_NOT_ADMITTED',
          `only admitted or paused instruments can be saved; this one is ${instrument.status}`,
        );
      }
      if ((await countWatchlistItems(db, userId)) >= WATCHLIST_MAX_ITEMS) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `a watchlist holds at most ${WATCHLIST_MAX_ITEMS} instruments`,
        );
      }
      const result = await addWatchlistItem(db, {
        userId,
        instrumentId,
        note: request.note,
        ifVersion: request.ifVersion ?? null,
        now: now(),
      });
      if (result.outcome === 'conflict') {
        throw conflict(result.watchlist.version);
      }
      if (result.outcome === 'applied') {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'watchlist.item.add',
          targetType: 'instrument',
          targetId: instrumentId,
          requestId,
          details: { version: result.watchlist.version },
        });
      }
      return project(result.watchlist);
    },

    async remove(principal, instrumentId, ifVersion, requestId) {
      const userId = ownerOf(principal);
      const result = await removeWatchlistItem(db, {
        userId,
        instrumentId,
        ifVersion,
        now: now(),
      });
      if (result.outcome === 'conflict') {
        throw conflict(result.watchlist.version);
      }
      if (result.outcome === 'applied') {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'watchlist.item.remove',
          targetType: 'instrument',
          targetId: instrumentId,
          requestId,
          details: { version: result.watchlist.version },
        });
      }
      return project(result.watchlist);
    },
  };
}
