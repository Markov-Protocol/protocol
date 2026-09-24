import { decimalsOfDouble, f64FromLeBytes } from '@markov/amounts';
import {
  type ExtensionAssessment,
  type ExtensionCompatibility,
  type ExtensionFindingSchemaType,
  encodeBase58,
} from '@markov/contracts';
import { TOKEN_2022_EXTENSION_NAMES } from './mint.js';

/**
 * Token-2022 extension data, parsed against the layouts in the program
 * sources (see docs/markov/source-register.md, SR-TOKEN-02):
 * ScaledUiAmountConfig 56 bytes, TransferFeeConfig 108, InterestBearingConfig
 * 52, PausableConfig 33, TransferHook 64, DefaultAccountState 1,
 * PermanentDelegate 32, MetadataPointer 64, MintCloseAuthority 32.
 * A `MaybeNull<Address>` is all zeroes when absent.
 */
export interface ExtensionEntry {
  readonly type: number;
  readonly data: Uint8Array;
}

const ZERO_KEY = '11111111111111111111111111111111';

function maybeNullKey(data: Uint8Array, offset: number): string | null {
  const key = encodeBase58(data.subarray(offset, offset + 32));
  return key === ZERO_KEY ? null : key;
}

function u16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function i64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

type Finding = ExtensionFindingSchemaType;

const WORST: Record<ExtensionCompatibility, number> = {
  supported: 0,
  review_required: 1,
  unsupported: 2,
};

function worse(a: ExtensionCompatibility, b: ExtensionCompatibility): ExtensionCompatibility {
  return WORST[a] >= WORST[b] ? a : b;
}

/**
 * Apply Markov's V1 extension policy. Unsupported extensions block admission
 * outright; review-required ones need documented issuer terms in the
 * admission evidence. Two rebasing mechanisms together are always
 * unsupported: quantities would otherwise be scaled twice.
 */
export function assessExtensions(entries: readonly ExtensionEntry[]): ExtensionAssessment {
  const findings: Finding[] = [];
  let compatibility: ExtensionCompatibility = 'supported';
  const assessment: {
    scaledUiAmount: ExtensionAssessment['scaledUiAmount'];
    transferFee: ExtensionAssessment['transferFee'];
    paused: boolean | null;
    defaultAccountState: ExtensionAssessment['defaultAccountState'];
    permanentDelegate: string | null;
    transferHookProgram: string | null;
    interestBearing: ExtensionAssessment['interestBearing'];
  } = {
    scaledUiAmount: null,
    transferFee: null,
    paused: null,
    defaultAccountState: null,
    permanentDelegate: null,
    transferHookProgram: null,
    interestBearing: null,
  };
  const add = (extension: string, verdict: ExtensionCompatibility, detail: string) => {
    findings.push({ extension, verdict, detail });
    compatibility = worse(compatibility, verdict);
  };
  const names = new Set<string>();

  for (const entry of entries) {
    const name = TOKEN_2022_EXTENSION_NAMES.get(entry.type);
    const data = entry.data;
    if (name === undefined) {
      add(
        `type ${entry.type}`,
        'unsupported',
        'unknown extension type; the program revision is newer than the verified sources',
      );
      continue;
    }
    names.add(name);
    switch (name) {
      case 'MetadataPointer':
      case 'TokenMetadata':
      case 'GroupPointer':
      case 'TokenGroup':
      case 'GroupMemberPointer':
      case 'TokenGroupMember':
        add(name, 'supported', 'descriptive only; no effect on balances or transfers');
        break;
      case 'MintCloseAuthority':
        add(
          name,
          'supported',
          data.length >= 32 && maybeNullKey(data, 0)
            ? 'the close authority can close the mint only once supply is zero'
            : 'no close authority set',
        );
        break;
      case 'ImmutableOwner':
      case 'MemoTransfer':
      case 'CpiGuard':
      case 'NonTransferableAccount':
      case 'TransferHookAccount':
      case 'TransferFeeAmount':
      case 'ConfidentialTransferAccount':
      case 'ConfidentialTransferFeeAmount':
      case 'PausableAccount':
        add(name, 'supported', 'token-account extension; irrelevant on a mint');
        break;
      case 'ScaledUiAmount': {
        if (data.length < 56) {
          add(name, 'unsupported', `scaled UI amount config is ${data.length} bytes, expected 56`);
          break;
        }
        const multiplier = decimalsOfDouble(f64FromLeBytes(data, 32));
        const effective = i64(data, 40);
        const newMultiplier = decimalsOfDouble(f64FromLeBytes(data, 48));
        assessment.scaledUiAmount = {
          authority: maybeNullKey(data, 0),
          multiplier: multiplier.shortest,
          multiplierExact: multiplier.exact,
          newMultiplier: newMultiplier.shortest,
          newMultiplierExact: newMultiplier.exact,
          newMultiplierEffectiveAt:
            effective === 0n ? null : new Date(Number(effective) * 1000).toISOString(),
        };
        const positive = !multiplier.shortest.startsWith('-') && multiplier.shortest !== '0';
        add(
          name,
          positive ? 'supported' : 'unsupported',
          positive
            ? `display quantities are raw × ${multiplier.shortest}; the authority can schedule a new multiplier, which the catalog records as corporate-action evidence`
            : `multiplier ${multiplier.shortest} is not positive`,
        );
        break;
      }
      case 'TransferFeeConfig': {
        if (data.length < 108) {
          add(name, 'unsupported', `transfer fee config is ${data.length} bytes, expected 108`);
          break;
        }
        const olderBasisPoints = u16(data, 72 + 16);
        const newerEpoch = u64(data, 90);
        const newerMaximum = u64(data, 98);
        const newerBasisPoints = u16(data, 106);
        assessment.transferFee = {
          basisPoints: newerBasisPoints,
          maximumFee: newerMaximum.toString(),
          newerEpoch: newerEpoch.toString(),
          olderBasisPoints,
        };
        if (newerBasisPoints === 0 && olderBasisPoints === 0) {
          add(
            name,
            'review_required',
            'no fee is charged today, but the fee authority can enable one; accepted only with issuer terms',
          );
        } else {
          add(
            name,
            'unsupported',
            `transfers are taxed ${newerBasisPoints} basis points (max ${newerMaximum.toString()} base units); exact accounting of received amounts is not supported in V1`,
          );
        }
        break;
      }
      case 'InterestBearingConfig': {
        const rate =
          data.length >= 52
            ? new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(50, true)
            : 0;
        assessment.interestBearing = { currentRateBasisPoints: rate };
        add(
          name,
          'unsupported',
          `continuously rebasing display amounts (${rate} basis points) are not modelled in V1`,
        );
        break;
      }
      case 'Pausable': {
        const paused = data.length >= 33 ? data[32] === 1 : null;
        assessment.paused = paused;
        add(
          name,
          'supported',
          paused
            ? 'transfers are paused by the issuer right now; the instrument is halted'
            : 'the issuer can pause all transfers; a pause halts the instrument',
        );
        break;
      }
      case 'DefaultAccountState': {
        const frozen = data.length >= 1 && data[0] === 2;
        assessment.defaultAccountState = frozen ? 'frozen' : 'initialized';
        add(
          name,
          frozen ? 'review_required' : 'supported',
          frozen
            ? 'new token accounts start frozen and need the freeze authority to thaw them before receiving'
            : 'new token accounts start initialized',
        );
        break;
      }
      case 'PermanentDelegate': {
        const delegate = data.length >= 32 ? maybeNullKey(data, 0) : null;
        assessment.permanentDelegate = delegate;
        add(
          name,
          delegate ? 'review_required' : 'supported',
          delegate
            ? `the delegate ${delegate} can transfer or burn any holder's tokens; accepted only with documented issuer terms`
            : 'no permanent delegate set',
        );
        break;
      }
      case 'TransferHook': {
        const program = data.length >= 64 ? maybeNullKey(data, 32) : null;
        assessment.transferHookProgram = program;
        add(
          name,
          program ? 'unsupported' : 'supported',
          program
            ? `every transfer calls program ${program}; hook programs are not evaluated in V1`
            : 'no hook program set',
        );
        break;
      }
      case 'NonTransferable':
        add(name, 'unsupported', 'tokens cannot be transferred, so they cannot be traded');
        break;
      case 'ConfidentialTransferMint':
      case 'ConfidentialTransferFeeConfig':
      case 'ConfidentialMintBurn':
        add(
          name,
          'review_required',
          'confidential balances are not used by Markov; public transfers still settle normally',
        );
        break;
      case 'PermissionedBurn':
        add(
          name,
          'review_required',
          'the issuer can burn tokens under its own permission rules; accepted only with documented issuer terms',
        );
        break;
      case 'Uninitialized':
        break;
      default:
        add(name, 'unsupported', 'no policy exists for this extension');
    }
  }

  if (names.has('ScaledUiAmount') && names.has('InterestBearingConfig')) {
    add(
      'ScaledUiAmount+InterestBearingConfig',
      'unsupported',
      'two rebasing mechanisms on one mint; quantities cannot be scaled twice',
    );
  }

  return { compatibility, findings, ...assessment };
}
