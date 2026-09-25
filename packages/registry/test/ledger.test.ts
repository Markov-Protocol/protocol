import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BLOCKHASH_VALIDITY,
  bytesToBase64,
  compileLegacyMessage,
  decodeVersionRecord,
  FixtureLedger,
  hexToBytes,
  LAMPORTS_PER_SIGNATURE,
  RECORD_SPACE,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  registryErrorCode,
  rentExemptMinimum,
  setStatusInstruction,
  signerFromPrivateKey,
  signTransaction,
  unsignedTransaction,
  versionRecordFilter,
} from '../src/index.js';

const PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const MINT_B = '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL';

function signer() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return signerFromPrivateKey(privateKey);
}

function args(
  hash: string,
  legs = [
    { mint: MINT_A, tokenProgram: 'spl-token' as const, weightBps: 6000 },
    { mint: MINT_B, tokenProgram: 'token-2022' as const, weightBps: 3000 },
  ],
) {
  return registrationArgs({
    manifestHash: hash,
    contentDigest: 'c'.repeat(64),
    legs,
    cashWeightBps: 10_000 - legs.reduce((sum, leg) => sum + leg.weightBps, 0),
    relation: 'none',
  });
}

function ledgerWithPublisher() {
  const ledger = new FixtureLedger({
    programId: PROGRAM_ID,
    genesisHash: GENESIS,
    now: () => 1_758_800_000,
  });
  const publisher = signer();
  ledger.fund(publisher.publicKey, 1_000_000_000n);
  return { ledger, publisher };
}

function registrationTx(
  ledger: FixtureLedger,
  publisher: ReturnType<typeof signer>,
  registration = args('a'.repeat(64)),
  feePayer = publisher,
) {
  const instruction = registerVersionInstruction({
    programId: PROGRAM_ID,
    publisher: publisher.publicKey,
    args: registration,
  });
  const message = compileLegacyMessage({
    feePayer: feePayer.publicKey,
    instructions: [instruction],
    recentBlockhash: ledger.latestBlockhash().blockhash,
  });
  return signTransaction(unsignedTransaction(message), publisher);
}

describe('FixtureLedger', () => {
  it('lands a registration, confirms it with slots and serves the record and its transaction', () => {
    const { ledger, publisher } = ledgerWithPublisher();
    const registration = args('a'.repeat(64));
    const signed = registrationTx(ledger, publisher, registration);
    const signature = ledger.send(bytesToBase64(signed.bytes));
    expect(signature).toBe(signed.signature);
    expect(ledger.signatureStatus(signature)).toMatchObject({
      err: null,
      confirmationStatus: 'processed',
    });
    ledger.advance(1);
    expect(ledger.signatureStatus(signature)?.confirmationStatus).toBe('confirmed');
    ledger.finalize();
    expect(ledger.signatureStatus(signature)?.confirmationStatus).toBe('finalized');

    const address = recordAddress(PROGRAM_ID, registration.manifestHash).address;
    const account = ledger.account(address);
    expect(account?.owner).toBe(PROGRAM_ID);
    expect(account?.data.length).toBe(RECORD_SPACE);
    expect(account?.lamports).toBe(rentExemptMinimum(RECORD_SPACE));
    const record = decodeVersionRecord(account?.data as Uint8Array);
    expect(record.publisher).toBe(publisher.publicKey);
    expect(record.legs).toEqual(registration.legs);
    expect(record.registeredSlot).toBe(4242n);
    expect(record.registeredUnixTime).toBe(1_758_800_000n);
    expect(ledger.account(publisher.publicKey)?.lamports).toBe(
      1_000_000_000n - rentExemptMinimum(RECORD_SPACE) - LAMPORTS_PER_SIGNATURE,
    );
    expect(ledger.transaction(signature)).toMatchObject({
      slot: 4242,
      err: null,
      blockTime: 1_758_800_000,
    });
    expect(ledger.programAccounts().map((entry) => entry.pubkey)).toEqual([address]);

    // The same signed bytes again are idempotent; a second registration of the hash is refused.
    expect(ledger.send(bytesToBase64(signed.bytes))).toBe(signature);
    const twin = registrationTx(
      ledger,
      publisher,
      args('a'.repeat(64), [{ mint: MINT_A, tokenProgram: 'spl-token', weightBps: 10_000 }]),
    );
    expect(() => ledger.send(bytesToBase64(twin.bytes))).toThrow(/custom program error: 0x0/);
    expect(ledger.account(address)?.data).toEqual(account?.data);
  });

  it('answers JSON-RPC methods in agave shapes', () => {
    const { ledger, publisher } = ledgerWithPublisher();
    const signed = registrationTx(ledger, publisher);
    const blockhash = ledger.handle('getLatestBlockhash', [{ commitment: 'confirmed' }]) as {
      value: { blockhash: string; lastValidBlockHeight: number };
    };
    expect(blockhash.value.lastValidBlockHeight).toBe(
      ledger.currentBlockHeight + BLOCKHASH_VALIDITY,
    );
    expect(
      ledger.handle('sendTransaction', [bytesToBase64(signed.bytes), { encoding: 'base58' }]),
    ).toMatchObject({
      rpcError: { code: -32602 },
    });
    const signature = ledger.handle('sendTransaction', [
      bytesToBase64(signed.bytes),
      { encoding: 'base64' },
    ]);
    expect(signature).toBe(signed.signature);
    expect(ledger.handle('getSignatureStatuses', [[signed.signature, 'unknown']])).toMatchObject({
      value: [
        { slot: 4242, err: null, confirmationStatus: 'processed', status: { Ok: null } },
        null,
      ],
    });
    const address = recordAddress(PROGRAM_ID, hexToBytes('a'.repeat(64))).address;
    expect(ledger.handle('getAccountInfo', [address, { encoding: 'base64' }])).toMatchObject({
      value: { owner: PROGRAM_ID, space: RECORD_SPACE },
    });
    const listed = ledger.handle('getProgramAccounts', [
      PROGRAM_ID,
      {
        encoding: 'base64',
        filters: [{ dataSize: RECORD_SPACE }, { memcmp: versionRecordFilter() }],
      },
    ]) as { pubkey: string }[];
    expect(listed.map((entry) => entry.pubkey)).toEqual([address]);
    expect(
      ledger.handle('getProgramAccounts', [PROGRAM_ID, { filters: [{ dataSize: 1 }] }]),
    ).toEqual([]);
    expect(ledger.handle('getTransaction', [signed.signature, { encoding: 'json' }])).toMatchObject(
      {
        slot: 4242,
        meta: { err: null },
      },
    );
    expect(ledger.handle('getTransaction', ['nope', {}])).toBeNull();
    expect(ledger.handle('getGenesisHash', [])).toBe(GENESIS);
    expect(ledger.handle('nonexistent', [])).toMatchObject({ rpcError: { code: -32601 } });
  });

  it('refuses unsigned, expired, unfunded and rule-breaking transactions the way a node would', () => {
    const { ledger, publisher } = ledgerWithPublisher();
    const message = compileLegacyMessage({
      feePayer: publisher.publicKey,
      instructions: [
        registerVersionInstruction({
          programId: PROGRAM_ID,
          publisher: publisher.publicKey,
          args: args('b'.repeat(64)),
        }),
      ],
      recentBlockhash: ledger.latestBlockhash().blockhash,
    });
    expect(() => ledger.send(bytesToBase64(unsignedTransaction(message)))).toThrow(
      /signature verification/,
    );

    const stale = registrationTx(ledger, publisher);
    ledger.advance(BLOCKHASH_VALIDITY + 1);
    expect(() => ledger.send(bytesToBase64(stale.bytes))).toThrow(/Blockhash not found/);

    const poor = signer();
    const unfunded = registrationTx(ledger, poor);
    expect(() => ledger.send(bytesToBase64(unfunded.bytes))).toThrow(/no record of a prior credit/);
    ledger.fund(poor.publicKey, 10_000n);
    const underfunded = registrationTx(ledger, poor);
    expect(() => ledger.send(bytesToBase64(underfunded.bytes))).toThrow(
      /custom program error: 0x1/,
    );

    const unsorted = registrationTx(ledger, publisher, {
      ...args('d'.repeat(64)),
      legs: [...args('d'.repeat(64)).legs].reverse(),
    });
    try {
      ledger.send(bytesToBase64(unsorted.bytes));
      throw new Error('should have thrown');
    } catch (error) {
      expect(
        (error as { rpcError: { code: number; data: { err: unknown } } }).rpcError,
      ).toMatchObject({
        code: -32002,
        data: { err: { InstructionError: [0, { Custom: registryErrorCode('LegsNotSorted') }] } },
      });
    }
    expect(ledger.programAccounts()).toHaveLength(0);
  });

  it('models dropped submissions, landed failures and outages', () => {
    const { ledger, publisher } = ledgerWithPublisher();
    ledger.dropNext = true;
    const dropped = registrationTx(ledger, publisher, args('e'.repeat(64)));
    expect(ledger.send(bytesToBase64(dropped.bytes))).toBe(dropped.signature);
    expect(ledger.signatureStatus(dropped.signature)).toBeNull();
    expect(ledger.programAccounts()).toHaveLength(0);

    ledger.landNextWithError = 0;
    const failed = registrationTx(ledger, publisher, args('f'.repeat(64)));
    ledger.send(bytesToBase64(failed.bytes));
    expect(ledger.signatureStatus(failed.signature)?.err).toEqual({
      InstructionError: [0, { Custom: 0 }],
    });
    expect(ledger.programAccounts()).toHaveLength(0);

    ledger.outage = true;
    expect(ledger.handle('getSignatureStatuses', [[failed.signature]])).toMatchObject({
      rpcError: { code: -32005 },
    });
    expect(() => ledger.send(bytesToBase64(failed.bytes))).toThrow(/unhealthy/);
    ledger.outage = false;
    expect(ledger.handle('getHealth', [])).toBe('ok');
  });

  it('applies the status marker for the publisher only and leaves the content untouched', () => {
    const { ledger, publisher } = ledgerWithPublisher();
    const registration = args('a'.repeat(64));
    ledger.send(bytesToBase64(registrationTx(ledger, publisher, registration).bytes));
    const address = recordAddress(PROGRAM_ID, registration.manifestHash).address;
    const before = ledger.account(address)?.data as Uint8Array;

    const stranger = signer();
    ledger.fund(stranger.publicKey, 100_000n);
    const strangerMessage = compileLegacyMessage({
      feePayer: stranger.publicKey,
      instructions: [
        setStatusInstruction({
          programId: PROGRAM_ID,
          publisher: stranger.publicKey,
          record: address,
          status: 1,
        }),
      ],
      recentBlockhash: ledger.latestBlockhash().blockhash,
    });
    const strangerTx = signTransaction(unsignedTransaction(strangerMessage), stranger);
    expect(() => ledger.send(bytesToBase64(strangerTx.bytes))).toThrow(
      new RegExp(`0x${registryErrorCode('NotPublisher').toString(16)}`),
    );

    ledger.advance(10);
    const deprecate = compileLegacyMessage({
      feePayer: publisher.publicKey,
      instructions: [
        setStatusInstruction({
          programId: PROGRAM_ID,
          publisher: publisher.publicKey,
          record: address,
          status: 1,
        }),
      ],
      recentBlockhash: ledger.latestBlockhash().blockhash,
    });
    ledger.send(bytesToBase64(signTransaction(unsignedTransaction(deprecate), publisher).bytes));
    const after = decodeVersionRecord(ledger.account(address)?.data as Uint8Array);
    expect(after.status).toBe(1);
    expect(after.statusUpdatedSlot).toBe(4252n);
    expect(after.legs).toEqual(decodeVersionRecord(before).legs);
    expect(after.registeredSlot).toBe(4242n);

    const unknownStatus = compileLegacyMessage({
      feePayer: publisher.publicKey,
      instructions: [
        setStatusInstruction({
          programId: PROGRAM_ID,
          publisher: publisher.publicKey,
          record: address,
          status: 2,
        }),
      ],
      recentBlockhash: ledger.latestBlockhash().blockhash,
    });
    expect(() =>
      ledger.send(
        bytesToBase64(signTransaction(unsignedTransaction(unknownStatus), publisher).bytes),
      ),
    ).toThrow(new RegExp(`0x${registryErrorCode('UnknownStatus').toString(16)}`));
  });
});
