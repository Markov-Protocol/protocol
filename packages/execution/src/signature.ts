import {
  isZeroBytes,
  messageHashHex,
  parseTransaction,
  sameMessage,
  type Transaction,
  transactionSignature,
  verifyEd25519,
} from '@markov/solana-codec';

/**
 * A signed submission is accepted only for the stored prepared message:
 * byte-identical message, exactly the one required signature, a valid
 * Ed25519 signature by the expected signer. A different message, a missing
 * or foreign signature or extra signature slots are refused before anything
 * reaches a node.
 */
export type SubmissionCheck =
  | {
      readonly ok: true;
      readonly transaction: Transaction;
      readonly signature: string;
      readonly messageHash: string;
    }
  | { readonly ok: false; readonly code: 'SIGNATURE_MISMATCH'; readonly message: string };

export function checkSignedSubmission(input: {
  readonly signedBytes: Uint8Array;
  readonly preparedMessageBytes: Uint8Array;
  readonly expectedSigner: string;
}): SubmissionCheck {
  let transaction: Transaction;
  try {
    transaction = parseTransaction(input.signedBytes);
  } catch (error) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      message: `the signed transaction does not parse: ${error instanceof Error ? error.message : 'unparseable'}`,
    };
  }
  if (!sameMessage(transaction.messageBytes, input.preparedMessageBytes)) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      message: 'the signed message differs from the prepared transaction; nothing was submitted',
    };
  }
  if (
    transaction.signatures.length !== 1 ||
    transaction.message.header.numRequiredSignatures !== 1
  ) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      message: 'exactly one signature (the owner’s) is expected',
    };
  }
  const signature = transaction.signatures[0] as Uint8Array;
  if (isZeroBytes(signature)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH', message: 'the signature slot is empty' };
  }
  const signer = transaction.message.accountKeys[0] as string;
  if (signer !== input.expectedSigner) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      message: `the fee payer ${signer} is not the expected signer ${input.expectedSigner}`,
    };
  }
  if (!verifyEd25519(signer, transaction.messageBytes, signature)) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      message: 'the signature does not verify against the message under the owner’s key',
    };
  }
  return {
    ok: true,
    transaction,
    signature: transactionSignature(transaction),
    messageHash: messageHashHex(transaction.messageBytes),
  };
}
