import { BASE58_REGEX } from '@markov/contracts';

/** "5eykt4Us…dw2N9d": the full value must remain available for inspection and copy elsewhere. */
export function shortenAddress(
  address: string,
  options: { readonly head?: number; readonly tail?: number } = {},
): string {
  const head = options.head ?? 4;
  const tail = options.tail ?? 4;
  if (address.length <= head + tail + 1) {
    return address;
  }
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Shape check only: base58 and plausible length. It says nothing about the account existing. */
export function looksLikeSolanaAddress(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && BASE58_REGEX.test(value);
}
