/**
 * Which strategy instance a fill belongs to. A token cannot count towards
 * two portfolios: a basket investment attributes to the one active
 * instance that pins the same strategy in the same wallet; anything
 * ambiguous or unmatched stays at the wallet level (`unassigned`) and is
 * reported as such rather than guessed. Single buys and sells are wallet
 * holdings.
 */

export interface AttributionIntent {
  readonly kind: 'basket_investment' | 'single_buy' | 'single_sell';
  readonly walletId: string;
  readonly strategyId: string | null;
  readonly versionId: string | null;
}

export interface AttributionInstance {
  readonly instanceId: string;
  readonly walletId: string;
  readonly strategyId: string;
  readonly pinnedVersionId: string;
  readonly status: string;
}

export type AttributionDecision =
  | { readonly attribution: 'instance'; readonly instanceId: string; readonly reason: string }
  | { readonly attribution: 'unassigned'; readonly instanceId: null; readonly reason: string };

export function attributeIntent(
  intent: AttributionIntent,
  instances: readonly AttributionInstance[],
): AttributionDecision {
  if (intent.kind !== 'basket_investment' || intent.strategyId === null) {
    return {
      attribution: 'unassigned',
      instanceId: null,
      reason: 'single buys and sells are wallet holdings, not strategy holdings',
    };
  }
  const candidates = instances.filter(
    (instance) =>
      instance.walletId === intent.walletId &&
      instance.strategyId === intent.strategyId &&
      instance.status === 'active',
  );
  if (candidates.length === 1) {
    const [instance] = candidates as [AttributionInstance];
    return {
      attribution: 'instance',
      instanceId: instance.instanceId,
      reason:
        instance.pinnedVersionId === intent.versionId
          ? 'the one active instance of this strategy in this wallet pins the invested version'
          : 'the one active instance of this strategy in this wallet (it pins another version of the same strategy)',
    };
  }
  return {
    attribution: 'unassigned',
    instanceId: null,
    reason:
      candidates.length === 0
        ? 'no active instance of this strategy exists in this wallet'
        : `${candidates.length} active instances of this strategy share this wallet; attribution needs an explicit choice`,
  };
}
