import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type ChainObservation,
  customErrorCode,
  derivePublicationOutcome,
  describeNodeRejection,
  encodeVersionRecord,
  hexToBytes,
  type PublicationExpectation,
  recordAddress,
  registrationArgs,
  registryErrorCode,
  signerFromPrivateKey,
} from '../src/index.js';

const PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const HASH = '8'.repeat(64);
const SIGNATURE = '5'.repeat(88);

const publisher = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey).publicKey;
const binding = {
  manifestHash: HASH,
  contentDigest: '9'.repeat(64),
  legs: [{ mint: MINT_A, tokenProgram: 'spl-token' as const, weightBps: 10_000 }],
  cashWeightBps: 0,
  relation: 'none' as const,
};
const expectation: PublicationExpectation = {
  operation: 'register',
  programId: PROGRAM_ID,
  cluster: 'devnet',
  signature: SIGNATURE,
  lastValidBlockHeight: 5000,
  recordAddress: recordAddress(PROGRAM_ID, hexToBytes(HASH)).address,
  publisherAddress: publisher,
  binding,
};

function recordBytes(overrides: Partial<Parameters<typeof encodeVersionRecord>[0]> = {}) {
  const args = registrationArgs(binding);
  return encodeVersionRecord({
    layoutVersion: 1,
    schemaVersion: 1,
    status: 0,
    bump: 255,
    publisher,
    manifestHash: args.manifestHash,
    contentDigest: args.contentDigest,
    relation: 0,
    parentManifestHash: args.parentManifestHash,
    cashWeightBps: args.cashWeightBps,
    legs: args.legs,
    registeredSlot: 4242n,
    registeredUnixTime: 1_758_800_000n,
    statusUpdatedSlot: 4242n,
    ...overrides,
  });
}

function observation(patch: Partial<ChainObservation>): ChainObservation {
  return {
    signature: null,
    blockHeight: 4300,
    transaction: null,
    account: null,
    observedAt: '2026-09-25T00:00:00.000Z',
    ...patch,
  };
}

describe('derivePublicationOutcome', () => {
  it('is unknown while the network cannot be asked', () => {
    expect(
      derivePublicationOutcome(expectation, observation({ signature: 'unavailable' })).state,
    ).toBe('unknown');
    expect(
      derivePublicationOutcome(expectation, observation({ blockHeight: 'unavailable' })).state,
    ).toBe('unknown');
  });

  it('stays submitted until the blockhash expires, then expires', () => {
    expect(derivePublicationOutcome(expectation, observation({}))).toEqual({
      state: 'submitted',
      confirmationStatus: null,
    });
    const expired = derivePublicationOutcome(expectation, observation({ blockHeight: 5001 }));
    expect(expired.state).toBe('expired');
    expect(expired.state === 'expired' && expired.failure.code).toBe('blockhash_expired');
  });

  it('fails on a landed error with the program code named', () => {
    const outcome = derivePublicationOutcome(
      expectation,
      observation({
        signature: {
          slot: 4250,
          err: { InstructionError: [0, { Custom: registryErrorCode('WeightTotal') }] },
          confirmationStatus: 'confirmed',
        },
      }),
    );
    expect(outcome).toMatchObject({
      state: 'failed',
      failure: { code: 'program_error', programError: 'WeightTotal', programErrorCode: 6008 },
    });
    expect(customErrorCode({ InstructionError: [0, 'InvalidAccountData'] })).toBeNull();
    expect(customErrorCode('AccountInUse')).toBeNull();
  });

  it('waits for finality, then requires a readable, matching record', () => {
    const confirmed = { slot: 4250, err: null, confirmationStatus: 'confirmed' as const };
    expect(derivePublicationOutcome(expectation, observation({ signature: confirmed }))).toEqual({
      state: 'submitted',
      confirmationStatus: 'confirmed',
    });
    const finalized = { ...confirmed, confirmationStatus: 'finalized' as const };
    expect(
      derivePublicationOutcome(expectation, observation({ signature: finalized, account: null }))
        .state,
    ).toBe('unknown');
    expect(
      derivePublicationOutcome(
        expectation,
        observation({ signature: finalized, account: 'unavailable' }),
      ).state,
    ).toBe('unknown');
    const wrongOwner = derivePublicationOutcome(
      expectation,
      observation({ signature: finalized, account: { owner: MINT_A, data: recordBytes() } }),
    );
    expect(wrongOwner).toMatchObject({ state: 'failed', failure: { code: 'record_mismatch' } });
    const garbage = derivePublicationOutcome(
      expectation,
      observation({
        signature: finalized,
        account: { owner: PROGRAM_ID, data: new Uint8Array(832) },
      }),
    );
    expect(garbage).toMatchObject({ state: 'failed', failure: { code: 'record_mismatch' } });
    const otherPublisher = derivePublicationOutcome(
      expectation,
      observation({
        signature: finalized,
        account: { owner: PROGRAM_ID, data: recordBytes({ publisher: PROGRAM_ID }) },
      }),
    );
    expect(otherPublisher).toMatchObject({
      state: 'failed',
      failure: { code: 'record_mismatch', message: expect.stringContaining('publisher') },
    });
    const otherContent = derivePublicationOutcome(
      expectation,
      observation({
        signature: finalized,
        account: { owner: PROGRAM_ID, data: recordBytes({ cashWeightBps: 5 }) },
      }),
    );
    expect(otherContent).toMatchObject({
      state: 'failed',
      failure: { message: expect.stringContaining('cashWeightBps') },
    });

    const registered = derivePublicationOutcome(
      expectation,
      observation({
        signature: finalized,
        transaction: { slot: 4250, blockTime: 1_758_800_100, err: null, logs: [] },
        account: { owner: PROGRAM_ID, data: recordBytes() },
      }),
    );
    expect(registered).toMatchObject({
      state: 'registered',
      confirmationStatus: 'finalized',
      evidence: {
        signature: SIGNATURE,
        slot: 4250,
        blockTime: new Date(1_758_800_100 * 1000).toISOString(),
        publisher,
        status: 'active',
        transactionUrl: `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
      },
    });
  });

  it('checks the status a deprecation or reactivation asked for', () => {
    const finalized = { slot: 4250, err: null, confirmationStatus: 'finalized' as const };
    const deprecate = { ...expectation, operation: 'deprecate' as const };
    expect(
      derivePublicationOutcome(
        deprecate,
        observation({ signature: finalized, account: { owner: PROGRAM_ID, data: recordBytes() } }),
      ),
    ).toMatchObject({ state: 'failed', failure: { message: expect.stringContaining('status') } });
    expect(
      derivePublicationOutcome(
        deprecate,
        observation({
          signature: finalized,
          account: { owner: PROGRAM_ID, data: recordBytes({ status: 1 }) },
        }),
      ),
    ).toMatchObject({ state: 'registered', evidence: { status: 'deprecated' } });
  });

  it('classifies node rejections', () => {
    expect(describeNodeRejection('Transaction simulation failed: Blockhash not found').code).toBe(
      'blockhash_expired',
    );
    expect(
      describeNodeRejection(
        'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1777',
      ),
    ).toMatchObject({
      code: 'program_error',
      programErrorCode: 6007,
      programError: 'LegsNotSorted',
    });
    expect(describeNodeRejection('Node is unhealthy').code).toBe('rejected_by_node');
  });
});
