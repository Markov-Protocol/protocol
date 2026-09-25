import { compareBytes, isZeroBytes } from './bytes.js';
import {
  MAX_LEGS,
  RELATIONS,
  type RegisterVersionArgs,
  SCHEMA_VERSION,
  TOTAL_BPS,
} from './layout.js';
import { pubkeyBytes, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './pubkey.js';

/**
 * The program's `RegistryError` codes in declaration order (Anchor numbers
 * custom errors from 6000) and the argument rules of `check_register_args`,
 * mirrored step for step so a version the API refuses locally is refused
 * by the program for the same reason, and the fixture ledger reports the
 * same code the chain would.
 */
export const REGISTRY_ERRORS = [
  ['UnsupportedSchema', 'unsupported manifest schema version'],
  ['EmptyHash', 'a hash must not be all zeros'],
  ['NoLegs', 'a version needs at least one leg'],
  ['TooManyLegs', 'more legs than the registry accepts'],
  ['ZeroWeight', 'a leg weight must be at least 1 basis point'],
  ['InvalidMint', 'a leg mint must not be the default public key'],
  ['UnsupportedTokenProgram', 'only SPL Token and Token-2022 mints are supported'],
  ['LegsNotSorted', 'legs must be strictly ascending by mint'],
  ['WeightTotal', 'leg weights plus cash must equal exactly 10,000 basis points'],
  ['UnknownRelation', 'unknown relation'],
  ['InvalidParent', 'parent reference does not match the relation'],
  ['UnknownStatus', 'unknown status'],
  ['NotPublisher', 'only the publisher may change the status'],
] as const;
export type RegistryErrorName = (typeof REGISTRY_ERRORS)[number][0];
export const REGISTRY_ERROR_BASE = 6000;

export function registryErrorCode(name: RegistryErrorName): number {
  return REGISTRY_ERROR_BASE + REGISTRY_ERRORS.findIndex(([candidate]) => candidate === name);
}

export function registryErrorName(code: number): RegistryErrorName | null {
  const entry = REGISTRY_ERRORS[code - REGISTRY_ERROR_BASE];
  return entry ? entry[0] : null;
}

export function registryErrorMessage(name: RegistryErrorName): string {
  const entry = REGISTRY_ERRORS.find(([candidate]) => candidate === name);
  return entry ? entry[1] : name;
}

export type RuleCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RegistryErrorName; readonly code: number };

function refuse(error: RegistryErrorName): RuleCheck {
  return { ok: false, error, code: registryErrorCode(error) };
}

const DEFAULT_PUBKEY = '11111111111111111111111111111111';

/** `check_register_args` in TypeScript: same checks, same order, same codes. */
export function checkRegisterArgs(args: RegisterVersionArgs): RuleCheck {
  if (args.schemaVersion !== SCHEMA_VERSION) {
    return refuse('UnsupportedSchema');
  }
  if (isZeroBytes(args.manifestHash) || isZeroBytes(args.contentDigest)) {
    return refuse('EmptyHash');
  }
  if (args.legs.length === 0) {
    return refuse('NoLegs');
  }
  if (args.legs.length > MAX_LEGS) {
    return refuse('TooManyLegs');
  }
  let total = 0;
  for (const leg of args.legs) {
    if (leg.weightBps < 1) {
      return refuse('ZeroWeight');
    }
    if (leg.mint === DEFAULT_PUBKEY) {
      return refuse('InvalidMint');
    }
    if (leg.tokenProgram !== SPL_TOKEN_PROGRAM_ID && leg.tokenProgram !== TOKEN_2022_PROGRAM_ID) {
      return refuse('UnsupportedTokenProgram');
    }
    total += leg.weightBps;
  }
  for (let i = 1; i < args.legs.length; i += 1) {
    const previous = args.legs[i - 1] as (typeof args.legs)[number];
    const current = args.legs[i] as (typeof args.legs)[number];
    if (compareBytes(pubkeyBytes(previous.mint), pubkeyBytes(current.mint)) >= 0) {
      return refuse('LegsNotSorted');
    }
  }
  if (total + args.cashWeightBps !== TOTAL_BPS) {
    return refuse('WeightTotal');
  }
  switch (args.relation) {
    case RELATIONS.none:
      if (!isZeroBytes(args.parentManifestHash)) {
        return refuse('InvalidParent');
      }
      break;
    case RELATIONS.revision:
    case RELATIONS.fork:
      if (
        isZeroBytes(args.parentManifestHash) ||
        compareBytes(args.parentManifestHash, args.manifestHash) === 0
      ) {
        return refuse('InvalidParent');
      }
      break;
    default:
      return refuse('UnknownRelation');
  }
  return { ok: true };
}
