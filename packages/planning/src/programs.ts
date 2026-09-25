import type { PlanMode } from '@markov/contracts';

/**
 * The reviewed route/program compatibility matrix. A quote may only build
 * a plan when every program on its route is listed for the plan's mode.
 * Nothing is reviewed for live use yet: the venue's current interface and
 * its programs are unverified from this environment (OD-21), so a live
 * quote fails closed until an entry with `status: 'reviewed'` and its
 * review evidence exists.
 */
export type RouteProgramStatus = 'fixture_only' | 'reviewed' | 'quarantined';

export interface RouteProgramReview {
  readonly programId: string;
  readonly label: string;
  readonly status: RouteProgramStatus;
  readonly note: string;
}

/** base58(sha256("markov-fixture-route-program")): a synthetic program id that exists on no network. */
export const FIXTURE_ROUTE_PROGRAM_ID = 'Gb8BHynqtw8bVGTmRAuCD5iJqqBdRamwW9n4XR2cEvvq';

export const ROUTE_PROGRAM_MATRIX: readonly RouteProgramReview[] = [
  {
    programId: FIXTURE_ROUTE_PROGRAM_ID,
    label: 'fixture-amm',
    status: 'fixture_only',
    note: 'Synthetic route of the fixture venue for local and test modes; never a live program.',
  },
];

export type RouteProgramVerdict = 'allowed' | 'not_reviewed' | 'quarantined' | 'fixture_only';

export function routeProgramVerdict(programId: string, mode: PlanMode): RouteProgramVerdict {
  const entry = ROUTE_PROGRAM_MATRIX.find((row) => row.programId === programId);
  if (!entry) {
    return 'not_reviewed';
  }
  if (entry.status === 'quarantined') {
    return 'quarantined';
  }
  if (entry.status === 'fixture_only') {
    return mode === 'fixture' ? 'allowed' : 'fixture_only';
  }
  return 'allowed';
}
