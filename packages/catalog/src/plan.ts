import type { IngestionReport, InstrumentStatus, IssuerFeedProduct } from '@markov/contracts';
import { type NormalizedProduct, normalizeProduct, productFingerprint } from './feed.js';

export interface ExistingInstrument {
  readonly instrumentId: string;
  readonly issuerProductId: string;
  readonly symbol: string;
  readonly mint: string;
  readonly decimals: number;
  readonly status: InstrumentStatus;
  /** `productFingerprint` of the stored fields. */
  readonly fingerprint: string;
}

export type PlannedAction =
  | {
      readonly kind: 'insert';
      readonly product: NormalizedProduct;
      readonly status: 'quarantined' | 'rejected';
      readonly reasons: string[];
    }
  | {
      readonly kind: 'update';
      readonly instrumentId: string;
      readonly product: NormalizedProduct;
      /** Null keeps the current status. */
      readonly newStatus: InstrumentStatus | null;
      readonly reasons: string[];
    }
  | {
      readonly kind: 'unchanged';
      readonly instrumentId: string;
      readonly productId: string;
      readonly reasons: string[];
    }
  | {
      readonly kind: 'invalid';
      readonly productId: string;
      readonly symbol: string | null;
      /** Existing instrument fed by this product, which is paused or rejected by the store. */
      readonly instrumentId: string | null;
      readonly currentStatus: InstrumentStatus | null;
      readonly reasons: string[];
    };

export interface IngestionPlan {
  readonly actions: PlannedAction[];
  readonly products: IngestionReport['products'];
  readonly counts: IngestionReport['counts'];
}

const ACTIVE: ReadonlySet<InstrumentStatus> = new Set(['quarantined', 'admitted', 'paused']);

/**
 * Decide what a feed does to the catalog without touching storage. Rules:
 * products start quarantined; a symbol already used by another live
 * instrument with a different mint is a counterfeit and is rejected; a mint
 * already bound to another product is rejected; an admitted or paused
 * instrument whose mint or decimals changed upstream is paused for review;
 * a delisted instrument ignores upstream; a rejected one is re-quarantined
 * only when its record became valid again.
 */
export function planIngestion(
  existing: readonly ExistingInstrument[],
  feedProducts: readonly IssuerFeedProduct[],
  now: Date,
): IngestionPlan {
  const byProductId = new Map(existing.map((item) => [item.issuerProductId, item]));
  const actions: PlannedAction[] = [];
  const products: IngestionReport['products'] = [];
  const counts = { inserted: 0, updated: 0, unchanged: 0, rejected: 0, paused: 0 };
  const seenProductIds = new Set<string>();
  const seenSymbols = new Map<string, { productId: string; mint: string }>();
  const seenMints = new Map<string, string>();

  const record = (
    productId: string,
    symbol: string | null,
    outcome: IngestionReport['products'][number]['outcome'],
    reasons: string[],
  ) => {
    products.push({ issuerProductId: productId, symbol, outcome, reasons });
    counts[outcome] += 1;
  };

  for (const raw of feedProducts) {
    const normalized = normalizeProduct(raw, now);
    const productId = normalized.ok ? normalized.product.productId : normalized.productId;
    const current = byProductId.get(productId) ?? null;
    const reasons: string[] = normalized.ok ? [] : [...normalized.reasons];

    // A repeated productId never writes: the first occurrence owns the id.
    if (seenProductIds.has(productId)) {
      const why = ['duplicate productId in feed', ...reasons];
      actions.push({
        kind: 'invalid',
        productId,
        symbol: normalized.ok ? normalized.product.symbol : normalized.symbol,
        instrumentId: null,
        currentStatus: null,
        reasons: why,
      });
      record(
        productId,
        normalized.ok ? normalized.product.symbol : normalized.symbol,
        'rejected',
        why,
      );
      continue;
    }
    seenProductIds.add(productId);

    if (normalized.ok) {
      const { symbol, mint } = normalized.product;
      const symbolSeen = seenSymbols.get(symbol);
      if (symbolSeen && symbolSeen.productId !== productId && symbolSeen.mint !== mint) {
        reasons.push(`symbol ${symbol} already used in this feed by ${symbolSeen.productId}`);
      } else {
        seenSymbols.set(symbol, { productId, mint });
      }
      const mintSeen = seenMints.get(mint);
      if (mintSeen && mintSeen !== productId) {
        reasons.push(`mint already used in this feed by ${mintSeen}`);
      } else {
        seenMints.set(mint, productId);
      }
      for (const other of existing) {
        if (other.issuerProductId === productId || other.status === 'rejected') {
          continue;
        }
        if (other.symbol === symbol && other.mint !== mint) {
          reasons.push(
            `symbol ${symbol} belongs to instrument ${other.instrumentId} with a different mint`,
          );
        }
        if (other.mint === mint) {
          reasons.push(`mint already bound to instrument ${other.instrumentId}`);
        }
      }
    }

    if (!normalized.ok || reasons.length > 0) {
      if (current === null) {
        if (normalized.ok) {
          actions.push({
            kind: 'insert',
            product: normalized.product,
            status: 'rejected',
            reasons,
          });
        } else {
          actions.push({
            kind: 'invalid',
            productId,
            symbol: normalized.ok ? null : normalized.symbol,
            instrumentId: null,
            currentStatus: null,
            reasons,
          });
        }
        record(
          productId,
          normalized.ok ? normalized.product.symbol : normalized.symbol,
          'rejected',
          reasons,
        );
        continue;
      }
      if (current.status === 'delisted') {
        actions.push({
          kind: 'unchanged',
          instrumentId: current.instrumentId,
          productId,
          reasons: ['delisted'],
        });
        record(productId, current.symbol, 'unchanged', ['delisted; upstream ignored']);
        continue;
      }
      const pauses = current.status === 'admitted' || current.status === 'paused';
      actions.push({
        kind: 'invalid',
        productId,
        symbol: current.symbol,
        instrumentId: current.instrumentId,
        currentStatus: current.status,
        reasons,
      });
      record(productId, current.symbol, pauses ? 'paused' : 'rejected', reasons);
      continue;
    }

    const product = normalized.product;
    if (current === null) {
      actions.push({ kind: 'insert', product, status: 'quarantined', reasons: [] });
      record(productId, product.symbol, 'inserted', []);
      continue;
    }
    if (current.status === 'delisted') {
      actions.push({
        kind: 'unchanged',
        instrumentId: current.instrumentId,
        productId,
        reasons: ['delisted'],
      });
      record(productId, current.symbol, 'unchanged', ['delisted; upstream ignored']);
      continue;
    }
    if (current.fingerprint === productFingerprint(product) && ACTIVE.has(current.status)) {
      actions.push({
        kind: 'unchanged',
        instrumentId: current.instrumentId,
        productId,
        reasons: [],
      });
      record(productId, product.symbol, 'unchanged', []);
      continue;
    }
    const changes: string[] = [];
    if (current.mint !== product.mint) {
      changes.push('upstream changed the mint');
    }
    if (current.decimals !== product.decimals) {
      changes.push('upstream changed the decimals');
    }
    if (changes.length > 0 && (current.status === 'admitted' || current.status === 'paused')) {
      actions.push({
        kind: 'update',
        instrumentId: current.instrumentId,
        product,
        newStatus: 'paused',
        reasons: changes,
      });
      record(productId, product.symbol, 'paused', changes);
      continue;
    }
    if (current.status === 'rejected') {
      const why = ['record valid again after upstream change; re-review required'];
      actions.push({
        kind: 'update',
        instrumentId: current.instrumentId,
        product,
        newStatus: 'quarantined',
        reasons: why,
      });
      record(productId, product.symbol, 'updated', why);
      continue;
    }
    actions.push({
      kind: 'update',
      instrumentId: current.instrumentId,
      product,
      newStatus: null,
      reasons: changes,
    });
    record(productId, product.symbol, 'updated', changes);
  }

  return { actions, products, counts };
}
