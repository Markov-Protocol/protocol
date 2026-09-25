'use client';

import type { PerformancePeriod } from '@markov/contracts';
import { useState } from 'react';
import { PerformancePanel, PeriodControl } from '../portfolio/performance-panel';
import { useVersionPerformance } from '../portfolio/queries';

/**
 * The model series of a registered version on its public page: a stated
 * hypothesis (bought once, held without costs), never a personal outcome.
 * Personal series live on the portfolio pages under their own label.
 */
export function ModelPerformanceSection({
  strategyId,
  versionNumber,
}: {
  readonly strategyId: string;
  readonly versionNumber: number;
}) {
  const [period, setPeriod] = useState<PerformancePeriod>('30d');
  const model = useVersionPerformance(strategyId, versionNumber, period, true);
  return (
    <section aria-labelledby="model-performance-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="model-performance-heading" className="text-heading-sm font-semibold">
          Model performance
        </h2>
        <PeriodControl period={period} onChange={setPeriod} idPrefix="version" />
      </div>
      <PerformancePanel
        title="Model series (buy and hold)"
        testId="model-performance"
        period={period}
        data={model.data}
        error={model.error ?? null}
        loading={model.isPending}
        onRetry={() => void model.refetch()}
        exportSubject={{ kind: 'version', strategyId, versionNumber }}
        exportName={`version-${versionNumber}-model-performance-${period}.json`}
        framing="Hypothetical: whole base units bought at the first priced point after the freeze and held without fees, slippage or rebalancing. Not anyone's account; an incomplete window reports no return."
      />
    </section>
  );
}
