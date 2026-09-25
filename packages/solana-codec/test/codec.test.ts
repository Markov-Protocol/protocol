import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  BLOCKHASH_VALIDITY,
  base64ToBytes,
  bytesToBase64,
  COMPUTE_BUDGET_PROGRAM_ID,
  compileLegacyMessage,
  decodeAddressLookupTable,
  decodeTokenAccount,
  encodeAddressLookupTable,
  encodeTokenAccount,
  FINALITY_DEPTH,
  FixtureChain,
  isZeroBytes,
  LAMPORTS_PER_SIGNATURE,
  type Message,
  messageHashHex,
  parseMessage,
  parseTransaction,
  rentExemptMinimum,
  resolveInstructions,
  resolveMessageAccounts,
  SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  sameMessage,
  serializeMessage,
  serializeTransaction,
  signerFromPrivateKey,
  signTransaction,
  TOKEN_ACCOUNT_LENGTH,
  transactionSignature,
  unsignedTransaction,
  verifyEd25519,
  verifyTransactionSignatures,
} from '../src/index.js';

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MINT = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const OTHER = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';

const signer = () => signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);

function transfer(from: string, to: string, lamports: bigint) {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  return {
    programId: SYSTEM_PROGRAM_ID,
    accounts: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
}

function computeLimit(units: number) {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data };
}

describe('messages and transactions', () => {
  it('round-trips a legacy message and binds the signature to its exact bytes', () => {
    const owner = signer();
    const chain = new FixtureChain({ genesisHash: GENESIS });
    const { blockhash } = chain.latestBlockhash();
    const message = compileLegacyMessage({
      feePayer: owner.publicKey,
      instructions: [computeLimit(200_000), transfer(owner.publicKey, OTHER, 1_000n)],
      recentBlockhash: blockhash,
    });
    expect(message.version).toBe('legacy');
    expect(message.accountKeys[0]).toBe(owner.publicKey);
    expect(message.header.numRequiredSignatures).toBe(1);
    const bytes = serializeMessage(message);
    const parsed = parseMessage(bytes);
    expect(parsed).toEqual(message);
    expect(sameMessage(serializeMessage(parsed), bytes)).toBe(true);
    expect(messageHashHex(bytes)).toMatch(/^[0-9a-f]{64}$/);

    const unsigned = unsignedTransaction(message);
    const parsedUnsigned = parseTransaction(unsigned);
    expect(parsedUnsigned.signatures).toHaveLength(1);
    expect(isZeroBytes(parsedUnsigned.signatures[0] as Uint8Array)).toBe(true);
    const signed = signTransaction(unsigned, owner);
    const transaction = parseTransaction(signed.bytes);
    expect(verifyTransactionSignatures(transaction).allValid).toBe(true);
    expect(transactionSignature(transaction)).toBe(signed.signature);
    expect(
      verifyEd25519(
        owner.publicKey,
        transaction.messageBytes,
        transaction.signatures[0] as Uint8Array,
      ),
    ).toBe(true);
    // A stranger's key does not verify, and a flipped message byte breaks the signature.
    const stranger = signer();
    expect(
      verifyEd25519(
        stranger.publicKey,
        transaction.messageBytes,
        transaction.signatures[0] as Uint8Array,
      ),
    ).toBe(false);
    const altered = Uint8Array.from(transaction.messageBytes);
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 0x01;
    expect(verifyEd25519(owner.publicKey, altered, transaction.signatures[0] as Uint8Array)).toBe(
      false,
    );
    expect(() => signTransaction(unsigned, stranger)).toThrow(/not a required signer/);
    expect(() => serializeTransaction([new Uint8Array(3)], bytes)).toThrow(/64 bytes/);
  });

  it('decodes a v0 message with lookup tables, resolves its accounts and refuses unresolved tables', () => {
    const owner = signer();
    const loaded = [OTHER, MINT];
    const table = encodeAddressLookupTable({ addresses: loaded, authority: owner.publicKey });
    const decoded = decodeAddressLookupTable(table);
    expect(decoded.addresses).toEqual(loaded);
    expect(decoded.authority).toBe(owner.publicKey);
    const tableKey = signer().publicKey;
    const message: Message = {
      version: 0,
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
      },
      accountKeys: [owner.publicKey, SYSTEM_PROGRAM_ID],
      recentBlockhash: new FixtureChain({ genesisHash: GENESIS }).latestBlockhash().blockhash,
      // transfer: from = static 0, to = loaded writable 0 (index 2 after static keys)
      instructions: [
        {
          programIdIndex: 1,
          accountIndexes: [0, 2],
          data: transfer(owner.publicKey, OTHER, 5n).data,
        },
      ],
      addressTableLookups: [{ accountKey: tableKey, writableIndexes: [0], readonlyIndexes: [1] }],
    };
    const bytes = serializeMessage(message);
    expect(bytes[0]).toBe(0x80);
    const parsed = parseMessage(bytes);
    expect(parsed).toEqual(message);
    const accounts = resolveMessageAccounts(parsed, new Map([[tableKey, loaded]]));
    expect(accounts.map((entry) => [entry.pubkey, entry.isWritable, entry.source])).toEqual([
      [owner.publicKey, true, 'static'],
      [SYSTEM_PROGRAM_ID, false, 'static'],
      [OTHER, true, 'lookup'],
      [MINT, false, 'lookup'],
    ]);
    const instructions = resolveInstructions(parsed, accounts);
    expect(instructions[0]?.accounts.map((entry) => entry.pubkey)).toEqual([
      owner.publicKey,
      OTHER,
    ]);
    expect(() => resolveMessageAccounts(parsed, new Map())).toThrow(/lookup table/i);
    expect(() => parseMessage(Uint8Array.from([0x81, ...bytes.subarray(1)]))).toThrow(
      /unsupported version/,
    );
    expect(() => decodeAddressLookupTable(table.subarray(0, 40))).toThrow();
  });
});

describe('token layouts', () => {
  it('encodes and decodes token accounts and derives associated addresses', () => {
    const owner = signer().publicKey;
    const data = encodeTokenAccount({ mint: MINT, owner, amount: 12_345n });
    expect(data).toHaveLength(TOKEN_ACCOUNT_LENGTH);
    expect(decodeTokenAccount(data)).toMatchObject({ mint: MINT, owner, amount: 12_345n });
    const ata = associatedTokenAddress(owner, MINT, SPL_TOKEN_PROGRAM_ID);
    expect(ata.address).not.toBe(owner);
    expect(associatedTokenAddress(owner, MINT, SPL_TOKEN_PROGRAM_ID).address).toBe(ata.address);
    expect(associatedTokenAddress(owner, OTHER, SPL_TOKEN_PROGRAM_ID).address).not.toBe(
      ata.address,
    );
    expect(rentExemptMinimum(TOKEN_ACCOUNT_LENGTH)).toBe(2_039_280n);
  });
});

describe('fixture chain', () => {
  function chainWith(owner: ReturnType<typeof signer>) {
    const chain = new FixtureChain({ genesisHash: GENESIS });
    chain.registerMint(MINT, { decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM_ID });
    chain.setLamports(owner.publicKey, 10_000_000n);
    chain.setTokenBalance(owner.publicKey, MINT, 500n);
    return chain;
  }

  it('executes a signed transfer with agave-shaped answers, balance changes and confirmation depth', () => {
    const owner = signer();
    const chain = chainWith(owner);
    const receiver = signer().publicKey;
    const { blockhash, lastValidBlockHeight } = chain.latestBlockhash();
    expect(lastValidBlockHeight).toBe(chain.currentBlockHeight + BLOCKHASH_VALIDITY);
    const message = compileLegacyMessage({
      feePayer: owner.publicKey,
      instructions: [transfer(owner.publicKey, receiver, 1_000n)],
      recentBlockhash: blockhash,
    });
    const signed = signTransaction(unsignedTransaction(message), owner);
    const base64 = bytesToBase64(signed.bytes);
    // Unsigned bytes are refused by preflight; simulation of the same bytes without sigVerify passes.
    const unsignedAnswer = chain.handle('sendTransaction', [
      bytesToBase64(unsignedTransaction(message)),
      { encoding: 'base64' },
    ]) as { rpcError: { code: number } };
    expect(unsignedAnswer.rpcError.code).toBe(-32003);
    const simulated = chain.handle('simulateTransaction', [
      bytesToBase64(unsignedTransaction(message)),
      { encoding: 'base64', sigVerify: false },
    ]) as { value: { err: unknown; unitsConsumed: number } };
    expect(simulated.value.err).toBeNull();
    expect(simulated.value.unitsConsumed).toBeGreaterThan(0);

    const signature = chain.handle('sendTransaction', [base64, { encoding: 'base64' }]);
    expect(signature).toBe(signed.signature);
    expect(chain.handle('sendTransaction', [base64, { encoding: 'base64' }])).toBe(signature);
    const status = chain.handle('getSignatureStatuses', [[signature]]) as {
      value: ({ confirmationStatus: string } | null)[];
    };
    expect(status.value[0]?.confirmationStatus).toBe('processed');
    chain.advance(1);
    expect(
      (
        chain.handle('getSignatureStatuses', [[signature]]) as {
          value: { confirmationStatus: string }[];
        }
      ).value[0]?.confirmationStatus,
    ).toBe('confirmed');
    chain.advance(FINALITY_DEPTH);
    expect(
      (
        chain.handle('getSignatureStatuses', [[signature]]) as {
          value: { confirmationStatus: string }[];
        }
      ).value[0]?.confirmationStatus,
    ).toBe('finalized');
    const landed = chain.handle('getTransaction', [signature, { commitment: 'finalized' }]) as {
      meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[] };
      transaction: { message: { accountKeys: string[] } };
    };
    expect(landed.meta.err).toBeNull();
    expect(landed.meta.fee).toBe(Number(LAMPORTS_PER_SIGNATURE));
    expect(landed.transaction.message.accountKeys[0]).toBe(owner.publicKey);
    expect((landed.meta.preBalances[0] ?? 0) - (landed.meta.postBalances[0] ?? 0)).toBe(
      1_000 + Number(LAMPORTS_PER_SIGNATURE),
    );
    expect(chain.account(receiver)?.lamports).toBe(1_000n);
    expect(chain.handle('getSignatureStatuses', [['1'.repeat(87)]])).toMatchObject({
      value: [null],
    });
  });

  it('refuses an expired blockhash, an unfunded fee payer and unmodelled instructions', () => {
    const owner = signer();
    const chain = chainWith(owner);
    const { blockhash } = chain.latestBlockhash();
    chain.advance(BLOCKHASH_VALIDITY + 1);
    const expired = compileLegacyMessage({
      feePayer: owner.publicKey,
      instructions: [transfer(owner.publicKey, OTHER, 1n)],
      recentBlockhash: blockhash,
    });
    const expiredAnswer = chain.handle('sendTransaction', [
      bytesToBase64(signTransaction(unsignedTransaction(expired), owner).bytes),
      { encoding: 'base64' },
    ]) as { rpcError: { code: number; message: string } };
    expect(expiredAnswer.rpcError).toMatchObject({ code: -32002 });
    expect(expiredAnswer.rpcError.message).toMatch(/Blockhash not found/);
    expect((chain.handle('isBlockhashValid', [blockhash]) as { value: boolean }).value).toBe(false);

    const poor = signer();
    const fresh = chain.latestBlockhash().blockhash;
    const unfunded = compileLegacyMessage({
      feePayer: poor.publicKey,
      instructions: [transfer(poor.publicKey, OTHER, 1n)],
      recentBlockhash: fresh,
    });
    const unfundedAnswer = chain.handle('sendTransaction', [
      bytesToBase64(signTransaction(unsignedTransaction(unfunded), poor).bytes),
      { encoding: 'base64' },
    ]) as { rpcError: { message: string } };
    expect(unfundedAnswer.rpcError.message).toMatch(/no record of a prior credit/);

    // A token approval is not modelled: the program fails, nothing lands, balances are unchanged.
    const ata = chain.tokenAccountAddress(owner.publicKey, MINT);
    const approve = new Uint8Array(9);
    approve[0] = 4;
    const refused = compileLegacyMessage({
      feePayer: owner.publicKey,
      instructions: [
        {
          programId: SPL_TOKEN_PROGRAM_ID,
          accounts: [
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: OTHER, isSigner: false, isWritable: false },
            { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          ],
          data: approve,
        },
      ],
      recentBlockhash: fresh,
    });
    const refusedAnswer = chain.handle('sendTransaction', [
      bytesToBase64(signTransaction(unsignedTransaction(refused), owner).bytes),
      { encoding: 'base64' },
    ]) as { rpcError: { code: number; data: { err: unknown } } };
    expect(refusedAnswer.rpcError.code).toBe(-32002);
    expect(chain.tokenBalance(owner.publicKey, MINT)).toBe(500n);
  });

  it('scopes one-shot faults to one fee payer so parallel callers never receive them', () => {
    const alice = signer();
    const bob = signer();
    const chain = chainWith(alice);
    chain.setLamports(bob.publicKey, 5_000_000n);
    const send = (who: typeof alice) => {
      const { blockhash } = chain.latestBlockhash();
      const message = compileLegacyMessage({
        feePayer: who.publicKey,
        instructions: [transfer(who.publicKey, OTHER, 1n)],
        recentBlockhash: blockhash,
      });
      return chain.handle('sendTransaction', [
        bytesToBase64(signTransaction(unsignedTransaction(message), who).bytes),
        { encoding: 'base64' },
      ]) as string;
    };
    chain.scheduleFault(alice.publicKey, { kind: 'land-error', code: 6008 });
    // Bob submits first: his transaction is untouched, and Alice's fault waits for her.
    expect(chain.transaction(send(bob))?.err).toBeNull();
    expect(chain.transaction(send(alice))?.err).toEqual({
      InstructionError: [0, { Custom: 6008 }],
    });
    expect(chain.transaction(send(alice))?.err).toBeNull();
    chain.scheduleFault(alice.publicKey, { kind: 'drop' });
    expect(chain.transaction(send(bob))).not.toBeNull();
    expect(chain.transaction(send(alice))).toBeNull();
    chain.scheduleFault(bob.publicKey, { kind: 'lose-response' });
    send(alice);
    expect(chain.takeLostResponse()).toBe(false);
    const lost = send(bob);
    expect(chain.takeLostResponse()).toBe(true);
    expect(chain.takeLostResponse()).toBe(false);
    expect(chain.transaction(lost)).not.toBeNull();
    // Global controls still apply to whoever submits next.
    expect(chain.dropNext).toBe(false);
    expect(chain.landNextWithError).toBeNull();
  });

  it('models fault controls: drop, land with an error, lost response and outage', () => {
    const owner = signer();
    const chain = chainWith(owner);
    const send = () => {
      const { blockhash } = chain.latestBlockhash();
      const message = compileLegacyMessage({
        feePayer: owner.publicKey,
        instructions: [transfer(owner.publicKey, OTHER, 1n)],
        recentBlockhash: blockhash,
      });
      return bytesToBase64(signTransaction(unsignedTransaction(message), owner).bytes);
    };
    chain.dropNext = true;
    const dropped = chain.handle('sendTransaction', [send(), { encoding: 'base64' }]) as string;
    expect(chain.transaction(dropped)).toBeNull();
    expect(chain.dropNext).toBe(false);
    chain.landNextWithError = 6000;
    const errored = chain.handle('sendTransaction', [send(), { encoding: 'base64' }]) as string;
    expect(chain.transaction(errored)?.err).toEqual({ InstructionError: [0, { Custom: 6000 }] });
    chain.outage = true;
    expect(chain.handle('getBlockHeight', [])).toMatchObject({ rpcError: { code: -32005 } });
    chain.outage = false;
    expect(typeof chain.handle('getBlockHeight', [])).toBe('number');
    // Idempotent creation of an associated token account pays rent once and is a no-op the second time.
    const receiver = signer().publicKey;
    chain.setLamports(receiver, 5_000_000n);
    const ata = associatedTokenAddress(receiver, MINT, SPL_TOKEN_PROGRAM_ID).address;
    const create = () => {
      const { blockhash } = chain.latestBlockhash();
      return bytesToBase64(
        signTransaction(
          unsignedTransaction(
            compileLegacyMessage({
              feePayer: receiver,
              instructions: [
                {
                  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
                  accounts: [
                    { pubkey: receiver, isSigner: true, isWritable: true },
                    { pubkey: ata, isSigner: false, isWritable: true },
                    { pubkey: receiver, isSigner: false, isWritable: false },
                    { pubkey: MINT, isSigner: false, isWritable: false },
                    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                  ],
                  data: Uint8Array.of(1),
                },
              ],
              recentBlockhash: blockhash,
            }),
          ),
          signerFromKey(receiver),
        ).bytes,
      );
    };
    const keys = new Map<string, ReturnType<typeof signer>>();
    function signerFromKey(address: string) {
      return keys.get(address) as ReturnType<typeof signer>;
    }
    const receiverSigner = signer();
    keys.set(receiverSigner.publicKey, receiverSigner);
    chain.setLamports(receiverSigner.publicKey, 5_000_000n);
    const ata2 = associatedTokenAddress(
      receiverSigner.publicKey,
      MINT,
      SPL_TOKEN_PROGRAM_ID,
    ).address;
    const createFor = () => {
      const { blockhash } = chain.latestBlockhash();
      return bytesToBase64(
        signTransaction(
          unsignedTransaction(
            compileLegacyMessage({
              feePayer: receiverSigner.publicKey,
              instructions: [
                {
                  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
                  accounts: [
                    { pubkey: receiverSigner.publicKey, isSigner: true, isWritable: true },
                    { pubkey: ata2, isSigner: false, isWritable: true },
                    { pubkey: receiverSigner.publicKey, isSigner: false, isWritable: false },
                    { pubkey: MINT, isSigner: false, isWritable: false },
                    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                  ],
                  data: Uint8Array.of(1),
                },
              ],
              recentBlockhash: blockhash,
            }),
          ),
          receiverSigner,
        ).bytes,
      );
    };
    void create;
    void ata;
    chain.handle('sendTransaction', [createFor(), { encoding: 'base64' }]);
    const afterFirst = chain.account(receiverSigner.publicKey)?.lamports as bigint;
    expect(afterFirst).toBe(
      5_000_000n - rentExemptMinimum(TOKEN_ACCOUNT_LENGTH) - LAMPORTS_PER_SIGNATURE,
    );
    chain.handle('sendTransaction', [createFor(), { encoding: 'base64' }]);
    expect(chain.account(receiverSigner.publicKey)?.lamports).toBe(
      afterFirst - LAMPORTS_PER_SIGNATURE,
    );
    expect(decodeTokenAccount(chain.account(ata2)?.data as Uint8Array).amount).toBe(0n);
    expect(base64ToBytes(bytesToBase64(Uint8Array.of(1, 2, 3)))).toEqual(Uint8Array.of(1, 2, 3));
  });
});
