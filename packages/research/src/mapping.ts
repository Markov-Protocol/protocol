import { companyKey, type Issuer, type MappingResponse } from '@markov/contracts';

export interface MappableInstrument {
  readonly instrumentId: string;
  readonly issuer: Issuer;
  readonly symbol: string;
  readonly companyName: string;
  readonly status: string;
}

/**
 * Deterministic company → instrument mapping: an exact match on the
 * normalised company name against admitted or paused instruments, sorted
 * by issuer and symbol. A name without a match stays unmatched and is
 * never turned into a mint; there is no fuzzy or model-driven guessing.
 */
export function mapCompanies(
  companies: readonly string[],
  instruments: readonly MappableInstrument[],
): MappingResponse {
  const byKey = new Map<string, MappableInstrument[]>();
  for (const instrument of instruments) {
    if (instrument.status !== 'admitted' && instrument.status !== 'paused') {
      continue;
    }
    const key = companyKey(instrument.companyName);
    const bucket = byKey.get(key) ?? [];
    bucket.push(instrument);
    byKey.set(key, bucket);
  }
  return {
    results: companies.map((company) => {
      const key = companyKey(company);
      const matches = (key === '' ? [] : (byKey.get(key) ?? []))
        .slice()
        .sort((a, b) => a.issuer.localeCompare(b.issuer) || a.symbol.localeCompare(b.symbol))
        .map((instrument) => ({
          instrumentId: instrument.instrumentId,
          issuer: instrument.issuer,
          symbol: instrument.symbol,
          companyName: instrument.companyName,
          status: instrument.status as 'admitted' | 'paused',
        }));
      return { company, companyKey: key, matches, unmatched: matches.length === 0 };
    }),
  };
}
