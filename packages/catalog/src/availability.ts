import type { InstrumentAvailability, InstrumentStatus } from '@markov/contracts';

/**
 * What the catalog alone permits. Trading is never enabled by the catalog:
 * eligibility (B05), planning (B09) and execution (B10) each add their own
 * checks, and execution writes are disabled by configuration until then.
 */
export function availabilityFor(status: InstrumentStatus): InstrumentAvailability {
  switch (status) {
    case 'admitted':
      return { research: true, strategy: true, trade: false, reasons: ['EXECUTION_NOT_ENABLED'] };
    case 'paused':
      return {
        research: true,
        strategy: false,
        trade: false,
        reasons: ['INSTRUMENT_PAUSED', 'EXECUTION_NOT_ENABLED'],
      };
    case 'quarantined':
      return {
        research: false,
        strategy: false,
        trade: false,
        reasons: ['INSTRUMENT_QUARANTINED', 'EXECUTION_NOT_ENABLED'],
      };
    case 'rejected':
      return {
        research: false,
        strategy: false,
        trade: false,
        reasons: ['INSTRUMENT_REJECTED', 'EXECUTION_NOT_ENABLED'],
      };
    case 'delisted':
      return {
        research: false,
        strategy: false,
        trade: false,
        reasons: ['INSTRUMENT_DELISTED', 'EXECUTION_NOT_ENABLED'],
      };
  }
}

/** Only admitted and paused instruments are ever visible without operator scope. */
export function isPubliclyVisible(status: InstrumentStatus): boolean {
  return status === 'admitted' || status === 'paused';
}
