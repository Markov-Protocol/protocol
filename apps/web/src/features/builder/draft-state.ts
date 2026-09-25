import {
  BASIS_POINTS_TOTAL,
  type DraftIssue,
  type DraftIssueCode,
  type StrategyDraftContent,
  type StrategyLegInput,
} from '@markov/contracts';

/**
 * Pure basket arithmetic in integer basis points. Nothing here normalises
 * a weight on its own: every change is the person's explicit action, and
 * the backend's validation stays the authority on every rule.
 */
export type Stage = 'research' | 'assemble' | 'rules' | 'activate';
export const STAGES: readonly {
  readonly key: Stage;
  readonly number: string;
  readonly label: string;
  readonly copy: string;
}[] = [
  {
    key: 'research',
    number: '01',
    label: 'Research',
    copy: 'Find the companies and exposures behind your idea.',
  },
  {
    key: 'assemble',
    number: '02',
    label: 'Assemble',
    copy: 'Turn your thesis into a portfolio you can explain.',
  },
  {
    key: 'rules',
    number: '03',
    label: 'Set Rules',
    copy: 'Choose your budget, limits, and approval preferences.',
  },
  {
    key: 'activate',
    number: '04',
    label: 'Activate',
    copy: 'Review your plan and follow the result.',
  },
];

export function parseStage(value: string | null): Stage {
  return STAGES.some((stage) => stage.key === value) ? (value as Stage) : 'assemble';
}

export interface Totals {
  readonly legsBps: number;
  readonly cashBps: number;
  readonly totalBps: number;
  /** Positive when under-allocated, negative when over 10,000. */
  readonly remainingBps: number;
}

export function totalsOf(content: Pick<StrategyDraftContent, 'legs' | 'cashWeightBps'>): Totals {
  const legsBps = content.legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  const totalBps = legsBps + content.cashWeightBps;
  return {
    legsBps,
    cashBps: content.cashWeightBps,
    totalBps,
    remainingBps: BASIS_POINTS_TOTAL - totalBps,
  };
}

export function addLeg(content: StrategyDraftContent, instrumentId: string): StrategyDraftContent {
  if (content.legs.some((leg) => leg.instrumentId === instrumentId)) {
    return content;
  }
  return { ...content, legs: [...content.legs, { instrumentId, weightBps: 0, note: null }] };
}

/** Removing a constituent leaves every other weight exactly as it was; the remainder is shown, never redistributed. */
export function removeLeg(
  content: StrategyDraftContent,
  instrumentId: string,
): StrategyDraftContent {
  return { ...content, legs: content.legs.filter((leg) => leg.instrumentId !== instrumentId) };
}

export function setLegWeight(
  content: StrategyDraftContent,
  instrumentId: string,
  weightBps: number,
): StrategyDraftContent {
  return {
    ...content,
    legs: content.legs.map((leg) =>
      leg.instrumentId === instrumentId ? { ...leg, weightBps } : leg,
    ),
  };
}

export function setLegNote(
  content: StrategyDraftContent,
  instrumentId: string,
  note: string | null,
): StrategyDraftContent {
  return {
    ...content,
    legs: content.legs.map((leg) => (leg.instrumentId === instrumentId ? { ...leg, note } : leg)),
  };
}

export function moveLeg(
  content: StrategyDraftContent,
  instrumentId: string,
  direction: -1 | 1,
): StrategyDraftContent {
  const index = content.legs.findIndex((leg) => leg.instrumentId === instrumentId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= content.legs.length) {
    return content;
  }
  const legs = [...content.legs];
  const [moved] = legs.splice(index, 1);
  legs.splice(target, 0, moved as StrategyLegInput);
  return { ...content, legs };
}

/** Explicit action: equal integer weights per leg, the exact remainder as cash. */
export function equalWeights(content: StrategyDraftContent): StrategyDraftContent {
  if (content.legs.length === 0) {
    return content;
  }
  const weightBps = Math.floor(BASIS_POINTS_TOTAL / content.legs.length);
  return {
    ...content,
    legs: content.legs.map((leg) => ({ ...leg, weightBps })),
    cashWeightBps: BASIS_POINTS_TOTAL - weightBps * content.legs.length,
  };
}

/** Explicit action: whatever the legs leave becomes cash (zero when the legs already fill or exceed the total). */
export function fillCashRemainder(content: StrategyDraftContent): StrategyDraftContent {
  const legsBps = content.legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  return { ...content, cashWeightBps: Math.max(0, BASIS_POINTS_TOTAL - legsBps) };
}

export const ISSUE_LABELS: Readonly<Record<DraftIssueCode, string>> = {
  NO_LEGS: 'No constituent',
  TOO_MANY_LEGS: 'Too many constituents',
  ZERO_WEIGHT: 'Constituent without a weight',
  WEIGHTS_TOTAL: 'Total is not 100.00%',
  DUPLICATE_INSTRUMENT: 'Duplicate constituent',
  DUPLICATE_MINT: 'Two constituents share one mint',
  UNKNOWN_INSTRUMENT: 'Unknown instrument',
  INSTRUMENT_NOT_ADMITTED: 'Instrument not admitted',
  ISSUER_CONCENTRATION: 'Issuer concentration',
  COMPANY_CONCENTRATION: 'Company concentration',
};

/**
 * The obvious rules, checked before a round trip so the person sees them
 * as they type; the backend re-validates on every save and its issues
 * replace these.
 */
export function localIssues(
  content: StrategyDraftContent,
  limits: { readonly maxLegs: number } | null,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const totals = totalsOf(content);
  if (content.legs.length === 0) {
    issues.push({
      code: 'NO_LEGS',
      severity: 'error',
      path: 'legs',
      message: 'Add at least one admitted instrument; cash alone is not a strategy.',
      limit: null,
      observed: 0,
    });
  }
  if (limits && content.legs.length > limits.maxLegs) {
    issues.push({
      code: 'TOO_MANY_LEGS',
      severity: 'error',
      path: 'legs',
      message: `At most ${limits.maxLegs} constituents are allowed in this deployment.`,
      limit: limits.maxLegs,
      observed: content.legs.length,
    });
  }
  const seen = new Set<string>();
  content.legs.forEach((leg, index) => {
    if (seen.has(leg.instrumentId)) {
      issues.push({
        code: 'DUPLICATE_INSTRUMENT',
        severity: 'error',
        path: `legs/${index}`,
        message: 'This instrument appears twice.',
        limit: null,
        observed: null,
      });
    }
    seen.add(leg.instrumentId);
  });
  if (totals.totalBps !== BASIS_POINTS_TOTAL) {
    issues.push({
      code: 'WEIGHTS_TOTAL',
      severity: 'error',
      path: 'cashWeightBps',
      message:
        totals.remainingBps > 0
          ? `${formatBps(totals.remainingBps)} is still unallocated; assign it to a constituent or to cash.`
          : `The allocations exceed 100.00% by ${formatBps(-totals.remainingBps)}.`,
      limit: BASIS_POINTS_TOTAL,
      observed: totals.totalBps,
    });
  }
  return issues;
}

function formatBps(bps: number): string {
  const digits = Math.abs(bps).toString().padStart(3, '0');
  return `${bps < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}%`;
}

export function contentEquals(a: StrategyDraftContent, b: StrategyDraftContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ContentDiff {
  readonly legs: {
    readonly added: readonly StrategyLegInput[];
    readonly removed: readonly StrategyLegInput[];
    readonly changed: readonly {
      readonly instrumentId: string;
      readonly fromBps: number;
      readonly toBps: number;
    }[];
  };
  readonly cash: { readonly from: number; readonly to: number } | null;
  readonly titleChanged: boolean;
  readonly thesisChanged: boolean;
  readonly rulesChanged: boolean;
  readonly same: boolean;
}

/** What differs between two contents (this device's edits vs. the server's draft) for the conflict view. */
export function diffContent(mine: StrategyDraftContent, theirs: StrategyDraftContent): ContentDiff {
  const theirLegs = new Map(theirs.legs.map((leg) => [leg.instrumentId, leg]));
  const myLegs = new Map(mine.legs.map((leg) => [leg.instrumentId, leg]));
  const added = mine.legs.filter((leg) => !theirLegs.has(leg.instrumentId));
  const removed = theirs.legs.filter((leg) => !myLegs.has(leg.instrumentId));
  const changed = mine.legs.flatMap((leg) => {
    const other = theirLegs.get(leg.instrumentId);
    return other && other.weightBps !== leg.weightBps
      ? [{ instrumentId: leg.instrumentId, fromBps: other.weightBps, toBps: leg.weightBps }]
      : [];
  });
  const cash =
    mine.cashWeightBps === theirs.cashWeightBps
      ? null
      : { from: theirs.cashWeightBps, to: mine.cashWeightBps };
  const rulesChanged =
    JSON.stringify(mine.maintenance) !== JSON.stringify(theirs.maintenance) ||
    JSON.stringify(mine.references) !== JSON.stringify(theirs.references) ||
    mine.thesisId !== theirs.thesisId;
  const diff = {
    legs: { added, removed, changed },
    cash,
    titleChanged: mine.title !== theirs.title,
    thesisChanged: mine.thesis !== theirs.thesis,
    rulesChanged,
  };
  return { ...diff, same: contentEquals(mine, theirs) };
}

/**
 * Per-leg estimate of a budget in raw stablecoin units: floor(budget × bps / 10,000),
 * the exact remainder staying as cash. An estimate for orientation only; the
 * review (F09) quotes real outputs, fees and minimums.
 */
export function splitBudget(
  budgetRaw: bigint,
  legs: readonly { readonly instrumentId: string; readonly weightBps: number }[],
): {
  readonly perLeg: readonly { readonly instrumentId: string; readonly raw: bigint }[];
  readonly cashRaw: bigint;
} {
  const perLeg = legs.map((leg) => ({
    instrumentId: leg.instrumentId,
    raw: (budgetRaw * BigInt(leg.weightBps)) / BigInt(BASIS_POINTS_TOTAL),
  }));
  const spent = perLeg.reduce((sum, leg) => sum + leg.raw, 0n);
  return { perLeg, cashRaw: budgetRaw - spent };
}
