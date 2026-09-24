import {
  companyKey,
  type Disclosures,
  type FrozenLeg,
  type StrategyDraftContent,
} from '@markov/contracts';
import type { KnownInstrument } from './validate.js';

/** Catalog evidence captured for every leg at freeze time. */
export interface FreezeEvidence {
  readonly admittedAt: string | null;
  readonly verificationId: number | null;
  readonly verifiedAt: string | null;
  readonly decimals: number;
  readonly genesisHash: string;
}

/**
 * Immutable legs: the draft's instruments with the admission facts of the
 * moment. Legs are sorted by instrument id so two freezes of the same
 * content produce identical versions.
 */
export function freezeLegs(
  content: StrategyDraftContent,
  instruments: ReadonlyMap<string, KnownInstrument>,
  evidence: ReadonlyMap<string, FreezeEvidence>,
): FrozenLeg[] {
  return [...content.legs]
    .sort((a, b) =>
      a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0,
    )
    .map((leg) => {
      const instrument = instruments.get(leg.instrumentId);
      const facts = evidence.get(leg.instrumentId);
      if (!instrument || !facts) {
        throw new Error(`cannot freeze: instrument ${leg.instrumentId} is unknown`);
      }
      return {
        instrumentId: leg.instrumentId,
        weightBps: leg.weightBps,
        note: leg.note,
        issuer: instrument.issuer,
        symbol: instrument.symbol,
        companyName: instrument.companyName,
        admission: {
          status: instrument.status as FrozenLeg['admission']['status'],
          admittedAt: facts.admittedAt,
          verificationId: facts.verificationId,
          verifiedAt: facts.verifiedAt,
          mint: instrument.mint,
          tokenProgram: instrument.tokenProgram as FrozenLeg['admission']['tokenProgram'],
          decimals: facts.decimals,
          genesisHash: facts.genesisHash,
        },
      };
    });
}

/** Exposure by issuer and by underlying company (two issuers' tokens for one company add up). */
export function disclosuresOf(legs: readonly FrozenLeg[]): Disclosures {
  const issuers = new Map<FrozenLeg['issuer'], number>();
  const companies = new Map<string, { name: string; weight: number; ids: string[] }>();
  for (const leg of legs) {
    issuers.set(leg.issuer, (issuers.get(leg.issuer) ?? 0) + leg.weightBps);
    const key = companyKey(leg.companyName);
    const company = companies.get(key) ?? { name: leg.companyName, weight: 0, ids: [] };
    company.weight += leg.weightBps;
    company.ids.push(leg.instrumentId);
    companies.set(key, company);
  }
  return {
    issuers: [...issuers]
      .map(([issuer, weightBps]) => ({ issuer, weightBps }))
      .sort((a, b) => b.weightBps - a.weightBps || a.issuer.localeCompare(b.issuer)),
    companies: [...companies]
      .map(([key, company]) => ({
        companyKey: key,
        companyName: company.name,
        weightBps: company.weight,
        instrumentIds: [...company.ids].sort(),
      }))
      .sort((a, b) => b.weightBps - a.weightBps || a.companyKey.localeCompare(b.companyKey)),
  };
}
