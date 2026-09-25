import { type StrategyDraftContent, strategyDraftContentSchema } from '@markov/contracts';
import { z } from 'zod';

/**
 * A copy of unsaved basket edits kept on this device while the server
 * cannot be reached. Scoped to the account and the draft, versioned by
 * the revision the edits started from, short-lived, and removed for any
 * other account the moment a different principal (or none) is verified.
 * Never a signed message, never a credential.
 */
export const LOCAL_BASKET_PREFIX = 'markov.basket.';
export const LOCAL_BASKET_TTL_MS = 24 * 3600 * 1000;

const localCopySchema = z.object({
  baseRevision: z.number().int().positive(),
  content: strategyDraftContentSchema,
  savedAt: z.iso.datetime(),
});
export type LocalBasketCopy = z.infer<typeof localCopySchema>;

export function localBasketKey(principalKey: string, strategyId: string): string {
  return `${LOCAL_BASKET_PREFIX}${principalKey}.${strategyId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readLocalBasketCopy(key: string, now = Date.now()): LocalBasketCopy | null {
  const store = storage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(key);
    if (raw === null) {
      return null;
    }
    const parsed = localCopySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || now - Date.parse(parsed.data.savedAt) > LOCAL_BASKET_TTL_MS) {
      store.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeLocalBasketCopy(
  key: string,
  copy: { readonly baseRevision: number; readonly content: StrategyDraftContent },
  now = new Date(),
): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.setItem(key, JSON.stringify({ ...copy, savedAt: now.toISOString() }));
  } catch {
    // Storage full or blocked: the edits stay in memory and the status says so.
  }
}

export function clearLocalBasketCopy(key: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/** Remove every copy that does not belong to the principal now verified (all of them when signed out). */
export function purgeLocalBasketCopies(principalKey: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    const keep = principalKey === 'anonymous' ? null : `${LOCAL_BASKET_PREFIX}${principalKey}.`;
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(LOCAL_BASKET_PREFIX) && (keep === null || !key.startsWith(keep))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      store.removeItem(key);
    }
  } catch {
    // ignore
  }
}
