import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/features/execution/sha256';
import {
  checkSignedAgainstPrepared,
  messageHashOf,
} from '../src/features/execution/transaction-check';
import { bytesToBase64 } from '../src/features/wallets/transaction-bytes';

const encoder = new TextEncoder();
const nodeSha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('sha256', () => {
  it('matches the published vectors', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex(encoder.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it("matches Node's implementation across block boundaries and long inputs", () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 4097]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256Hex(bytes), `length ${length}`).toBe(nodeSha(bytes));
    }
  });
});

function wire(message: Uint8Array, signature: Uint8Array | null = null): string {
  const out = new Uint8Array(1 + 64 + message.length);
  out[0] = 1;
  if (signature) {
    out.set(signature, 1);
  }
  out.set(message, 65);
  return bytesToBase64(out);
}

describe('transaction checks', () => {
  const message = encoder.encode('markov-fixture-message');
  const unsigned = wire(message);
  const messageHash = nodeSha(message);

  it('hashes exactly the message part of the unsigned bytes', () => {
    expect(messageHashOf(unsigned)).toBe(messageHash);
    expect(messageHashOf('not base64!')).toBeNull();
    expect(messageHashOf(bytesToBase64(new Uint8Array([1, 2, 3])))).toBeNull();
  });

  it('accepts the same message with the fee-payer slot filled and refuses everything else', () => {
    const prepared = { unsignedTransaction: unsigned, messageHash };
    const signature = new Uint8Array(64).fill(9);
    expect(checkSignedAgainstPrepared(prepared, wire(message, signature))).toEqual({ ok: true });
    expect(checkSignedAgainstPrepared(prepared, unsigned)).toMatchObject({
      ok: false,
      reason: 'the fee-payer signature is missing',
    });
    const mutated = encoder.encode('markov-fixture-messagE');
    expect(checkSignedAgainstPrepared(prepared, wire(mutated, signature))).toMatchObject({
      ok: false,
      reason: 'the wallet changed the message before signing it',
    });
    expect(
      checkSignedAgainstPrepared(
        { ...prepared, messageHash: 'ab'.repeat(32) },
        wire(message, signature),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('does not hash') });
    expect(checkSignedAgainstPrepared(prepared, '%%%')).toMatchObject({ ok: false });
  });
});
