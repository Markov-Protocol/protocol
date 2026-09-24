/**
 * Encoders for Token-2022 extension data, the inverse of `assessExtensions`'
 * readers, for fixtures and tests. Layouts follow the program sources
 * (SR-TOKEN-02). Never used to build a real transaction.
 */
export type ExtensionFixtureSpec =
  | {
      readonly name: 'MetadataPointer';
      readonly authority: Uint8Array | null;
      readonly metadataAddress: Uint8Array | null;
    }
  | { readonly name: 'MintCloseAuthority'; readonly closeAuthority: Uint8Array | null }
  | {
      readonly name: 'ScaledUiAmount';
      readonly authority: Uint8Array | null;
      readonly multiplier: number;
      readonly newMultiplier: number;
      /** Unix seconds; 0 means none scheduled. */
      readonly newMultiplierEffectiveAt: number;
    }
  | {
      readonly name: 'TransferFeeConfig';
      readonly basisPoints: number;
      readonly maximumFee: bigint;
    }
  | { readonly name: 'InterestBearingConfig'; readonly rateBasisPoints: number }
  | { readonly name: 'Pausable'; readonly authority: Uint8Array | null; readonly paused: boolean }
  | {
      readonly name: 'TransferHook';
      readonly authority: Uint8Array | null;
      readonly programId: Uint8Array | null;
    }
  | { readonly name: 'DefaultAccountState'; readonly frozen: boolean }
  | { readonly name: 'PermanentDelegate'; readonly delegate: Uint8Array | null }
  | { readonly name: 'NonTransferable' };

export const EXTENSION_TYPE_BY_NAME: Readonly<Record<ExtensionFixtureSpec['name'], number>> = {
  MetadataPointer: 18,
  MintCloseAuthority: 3,
  ScaledUiAmount: 25,
  TransferFeeConfig: 1,
  InterestBearingConfig: 10,
  Pausable: 26,
  TransferHook: 14,
  DefaultAccountState: 6,
  PermanentDelegate: 12,
  NonTransferable: 9,
};

function key(target: Uint8Array, offset: number, value: Uint8Array | null): void {
  if (value) {
    target.set(value.subarray(0, 32), offset);
  }
}

export function encodeExtensionData(spec: ExtensionFixtureSpec): Uint8Array {
  switch (spec.name) {
    case 'MetadataPointer': {
      const out = new Uint8Array(64);
      key(out, 0, spec.authority);
      key(out, 32, spec.metadataAddress);
      return out;
    }
    case 'MintCloseAuthority': {
      const out = new Uint8Array(32);
      key(out, 0, spec.closeAuthority);
      return out;
    }
    case 'ScaledUiAmount': {
      const out = new Uint8Array(56);
      const view = new DataView(out.buffer);
      key(out, 0, spec.authority);
      view.setFloat64(32, spec.multiplier, true);
      view.setBigInt64(40, BigInt(spec.newMultiplierEffectiveAt), true);
      view.setFloat64(48, spec.newMultiplier, true);
      return out;
    }
    case 'TransferFeeConfig': {
      const out = new Uint8Array(108);
      const view = new DataView(out.buffer);
      // authorities (64) + withheld (8) + older fee (epoch 8, max 8, bps 2) + newer fee (epoch 8, max 8, bps 2)
      view.setBigUint64(72, 0n, true);
      view.setBigUint64(80, spec.maximumFee, true);
      view.setUint16(88, spec.basisPoints, true);
      view.setBigUint64(90, 1n, true);
      view.setBigUint64(98, spec.maximumFee, true);
      view.setUint16(106, spec.basisPoints, true);
      return out;
    }
    case 'InterestBearingConfig': {
      const out = new Uint8Array(52);
      new DataView(out.buffer).setInt16(50, spec.rateBasisPoints, true);
      return out;
    }
    case 'Pausable': {
      const out = new Uint8Array(33);
      key(out, 0, spec.authority);
      out[32] = spec.paused ? 1 : 0;
      return out;
    }
    case 'TransferHook': {
      const out = new Uint8Array(64);
      key(out, 0, spec.authority);
      key(out, 32, spec.programId);
      return out;
    }
    case 'DefaultAccountState':
      return new Uint8Array([spec.frozen ? 2 : 1]);
    case 'PermanentDelegate': {
      const out = new Uint8Array(32);
      key(out, 0, spec.delegate);
      return out;
    }
    case 'NonTransferable':
      return new Uint8Array(0);
  }
}
