import type { Mandate, MandateAction, MandateCheckCode, MandateUsage } from '@markov/contracts';

/**
 * Deterministic mandate dry run (B16). A mandate is evaluated against one
 * action and every check is reported, so an owner, a reviewer or an attack
 * fixture sees exactly which bound held. Nothing here is enforcement: the
 * platform keeps unattended execution DISABLED until an independently
 * reviewed mechanism can enforce a mandate outside this process.
 */

export interface MandateCheck {
  readonly code: MandateCheckCode;
  readonly ok: boolean;
  readonly detail: string;
}

export interface MandateEvaluation {
  readonly outcome: 'allow' | 'deny';
  readonly checks: MandateCheck[];
}

export function evaluateMandate(
  mandate: Mandate,
  action: MandateAction,
  usage: MandateUsage,
): MandateEvaluation {
  const at = new Date(action.at).getTime();
  const checks: MandateCheck[] = [];
  const check = (code: MandateCheckCode, ok: boolean, detail: string) => {
    checks.push({ code, ok, detail: detail.slice(0, 300) });
  };

  check(
    'NOT_REVOKED',
    mandate.revokedAt === null || new Date(mandate.revokedAt).getTime() > at,
    mandate.revokedAt === null ? 'the mandate is not revoked' : `revoked at ${mandate.revokedAt}`,
  );
  check(
    'NOT_EXPIRED',
    new Date(mandate.expiresAt).getTime() > at,
    `expires at ${mandate.expiresAt}; action at ${action.at}`,
  );
  check(
    'NONCE_CURRENT',
    action.nonce === mandate.nonce,
    `mandate nonce ${mandate.nonce}, action nonce ${action.nonce}`,
  );
  check(
    'OWNER_MATCHES',
    action.ownerUserId === mandate.ownerUserId,
    action.ownerUserId === mandate.ownerUserId ? 'same owner' : 'the action names another owner',
  );
  check(
    'WALLET_MATCHES',
    action.walletId === mandate.walletId,
    action.walletId === mandate.walletId ? 'same wallet' : 'the action names another wallet',
  );
  check(
    'CHAIN_MATCHES',
    action.chain.cluster === mandate.chain.cluster &&
      action.chain.genesisHash === mandate.chain.genesisHash,
    `mandate ${mandate.chain.cluster}/${mandate.chain.genesisHash.slice(0, 8)}, action ${action.chain.cluster}/${action.chain.genesisHash.slice(0, 8)}`,
  );
  check(
    'VERSION_BOUND',
    action.strategyVersionId === mandate.strategyVersionId,
    action.strategyVersionId === mandate.strategyVersionId
      ? 'the pinned version'
      : 'a different strategy version; approving a new creator version never widens a mandate',
  );
  const disallowed = action.instrumentIds.filter(
    (instrumentId) => !mandate.allowedInstrumentIds.includes(instrumentId),
  );
  check(
    'INSTRUMENTS_ALLOWED',
    disallowed.length === 0,
    disallowed.length === 0
      ? 'every instrument is in the mandate'
      : `${disallowed.length} instrument(s) outside the mandate`,
  );
  check(
    'VENUE_ALLOWED',
    mandate.allowedVenues.includes(action.venue),
    `venue ${action.venue}; allowed ${mandate.allowedVenues.join(', ')}`,
  );
  check(
    'ACTION_PERMITTED',
    mandate.actions.includes(action.kind),
    `action ${action.kind}; permitted ${mandate.actions.join(', ')}`,
  );
  const wantsBuy = action.sides.includes('buy');
  const wantsSell = action.sides.includes('sell');
  const sidesOk =
    (!wantsBuy || (mandate.maintenance.allowBuys && !mandate.maintenance.reduceOnly)) &&
    (!wantsSell || mandate.maintenance.allowSells) &&
    !(mandate.maintenance.reduceOnly && (wantsBuy || action.kind === 'rebalance'));
  check(
    'SIDES_PERMITTED',
    sidesOk,
    mandate.maintenance.reduceOnly
      ? 'reduce-only: sells only, no buys and no two-sided rebalance'
      : `buys ${mandate.maintenance.allowBuys ? 'allowed' : 'not allowed'}, sells ${mandate.maintenance.allowSells ? 'allowed' : 'not allowed'}`,
  );
  const ownDestinations =
    action.destinations.inputWalletId === mandate.destinations.inputWalletId &&
    action.destinations.outputWalletId === mandate.destinations.outputWalletId &&
    mandate.destinations.inputWalletId === mandate.walletId &&
    mandate.destinations.outputWalletId === mandate.walletId;
  check(
    'DESTINATIONS_OWN_WALLET',
    ownDestinations,
    ownDestinations
      ? 'inputs and outputs stay in the owner’s wallet'
      : 'a destination is not the mandate’s own wallet',
  );
  const notional = BigInt(action.notionalRaw);
  check(
    'PER_ORDER_BUDGET',
    notional <= BigInt(mandate.perOrderBudgetRaw),
    `notional ${action.notionalRaw} against per-order ${mandate.perOrderBudgetRaw}`,
  );
  const periodAfter = BigInt(usage.periodSpentRaw) + notional;
  check(
    'PERIOD_BUDGET',
    periodAfter <= BigInt(mandate.periodBudget.rawAmount),
    `${usage.periodSpentRaw} spent this ${mandate.periodBudget.windowDays}-day window plus ${action.notionalRaw} against ${mandate.periodBudget.rawAmount}`,
  );
  const turnoverAfter = BigInt(usage.cumulativeTurnoverRaw) + notional;
  check(
    'CUMULATIVE_TURNOVER',
    turnoverAfter <= BigInt(mandate.cumulativeTurnoverRaw),
    `${usage.cumulativeTurnoverRaw} turned over plus ${action.notionalRaw} against ${mandate.cumulativeTurnoverRaw}`,
  );
  check(
    'FEE_BOUND',
    action.feeBps <= mandate.maxFeeBps,
    `fee ${action.feeBps} bps against ${mandate.maxFeeBps} bps`,
  );
  check(
    'SLIPPAGE_BOUND',
    action.slippageBps <= mandate.maintenance.maxSlippageBps,
    `slippage ${action.slippageBps} bps against ${mandate.maintenance.maxSlippageBps} bps`,
  );
  return { outcome: checks.every((entry) => entry.ok) ? 'allow' : 'deny', checks };
}
