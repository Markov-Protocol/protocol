/**
 * @markov/api-client
 *
 * The one client for the Markov API: path and body types generated from the
 * frozen OpenAPI document, runtime validation with the shared contracts,
 * typed error envelopes and the route-to-contract matrix the app is tested
 * against. No financial type is hand-written here.
 */

export type { FetchOutcome, MarkovApiClient, MarkovApiClientOptions } from './client';
export { attempt, createMarkovApiClient, expect } from './client';
export {
  MarkovApiError,
  MarkovApiUnreachableError,
  MarkovContractMismatchError,
  toApiError,
} from './errors';
export type { paths } from './generated/openapi';
export { CONTRACT_MATRIX, type ContractMatrixEntry } from './matrix';
