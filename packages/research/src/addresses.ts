import { isIPv4, isIPv6 } from 'node:net';

/**
 * Address classification for safe retrieval. Every resolved address of a
 * source host must be public; anything private, reserved, loopback,
 * link-local, multicast, documentation, benchmarking, carrier NAT, unique
 * local, tunnelled or mapped to such ranges is refused (RFC 1918, 6598,
 * 3927, 4193, 5737, 2544, 4291 and 6890 ranges, plus 0/8 and 240/4).
 */
export type AddressVerdict =
  | { readonly ok: true; readonly family: 4 | 6 }
  | { readonly ok: false; readonly reason: string };

function v4Parts(address: string): [number, number, number, number] | null {
  if (!isIPv4(address)) {
    return null;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function v4Value(parts: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function inV4Range(parts: readonly number[], base: readonly number[], prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (v4Value(parts) & mask) === (v4Value(base) & mask);
}

const V4_REFUSED: readonly (readonly [readonly number[], number, string])[] = [
  [[0, 0, 0, 0], 8, 'this network'],
  [[10, 0, 0, 0], 8, 'private'],
  [[100, 64, 0, 0], 10, 'carrier-grade NAT'],
  [[127, 0, 0, 0], 8, 'loopback'],
  [[169, 254, 0, 0], 16, 'link-local'],
  [[172, 16, 0, 0], 12, 'private'],
  [[192, 0, 0, 0], 24, 'IETF protocol assignments'],
  [[192, 0, 2, 0], 24, 'documentation'],
  [[192, 88, 99, 0], 24, '6to4 relay'],
  [[192, 168, 0, 0], 16, 'private'],
  [[198, 18, 0, 0], 15, 'benchmarking'],
  [[198, 51, 100, 0], 24, 'documentation'],
  [[203, 0, 113, 0], 24, 'documentation'],
  [[224, 0, 0, 0], 4, 'multicast'],
  [[240, 0, 0, 0], 4, 'reserved'],
];

export function classifyIPv4(address: string): AddressVerdict {
  const parts = v4Parts(address);
  if (parts === null) {
    return { ok: false, reason: 'not a canonical IPv4 address' };
  }
  for (const [base, prefix, label] of V4_REFUSED) {
    if (inV4Range(parts, base, prefix)) {
      return { ok: false, reason: `${label} IPv4 range` };
    }
  }
  return { ok: true, family: 4 };
}

/** Expand an IPv6 literal to eight 16-bit groups; null when it is not a valid address. */
export function expandIPv6(address: string): number[] | null {
  if (!isIPv6(address)) {
    return null;
  }
  let text = address;
  const zone = text.indexOf('%');
  if (zone >= 0) {
    return null; // zone identifiers name local interfaces; never a public source
  }
  // Embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const parts = v4Parts(tail);
    if (parts === null) {
      return null;
    }
    text = `${text.slice(0, lastColon + 1)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null;
  }
  const groups = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...rest,
  ];
  if (groups.length !== 8) {
    return null;
  }
  const values = groups.map((group) => Number.parseInt(group === '' ? '0' : group, 16));
  return values.some((value) => Number.isNaN(value) || value < 0 || value > 0xffff) ? null : values;
}

function embeddedV4(groups: readonly number[], offset: number): string {
  const a = groups[offset] ?? 0;
  const b = groups[offset + 1] ?? 0;
  return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
}

export function classifyIPv6(address: string): AddressVerdict {
  const groups = expandIPv6(address);
  if (groups === null) {
    return { ok: false, reason: 'not a canonical IPv6 address' };
  }
  const allZeroPrefix = (count: number) => groups.slice(0, count).every((group) => group === 0);
  if (groups.every((group) => group === 0)) {
    return { ok: false, reason: 'unspecified IPv6 address' };
  }
  if (allZeroPrefix(7) && groups[7] === 1) {
    return { ok: false, reason: 'IPv6 loopback' };
  }
  if (allZeroPrefix(5) && groups[5] === 0xffff) {
    const inner = classifyIPv4(embeddedV4(groups, 6));
    return inner.ok
      ? { ok: true, family: 6 }
      : { ok: false, reason: `IPv4-mapped address in a ${inner.reason}` };
  }
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    allZeroPrefix(2) === false &&
    groups.slice(2, 6).every((g) => g === 0)
  ) {
    const inner = classifyIPv4(embeddedV4(groups, 6));
    return inner.ok
      ? { ok: true, family: 6 }
      : { ok: false, reason: `NAT64 address in a ${inner.reason}` };
  }
  if (groups[0] === 0x2002) {
    const inner = classifyIPv4(embeddedV4(groups, 1));
    return inner.ok
      ? { ok: true, family: 6 }
      : { ok: false, reason: `6to4 address in a ${inner.reason}` };
  }
  if (groups[0] === 0x2001 && groups[1] === 0) {
    return { ok: false, reason: 'Teredo tunnel address' };
  }
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) {
    return { ok: false, reason: 'IPv6 documentation range' };
  }
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
    return { ok: false, reason: 'IPv6 discard range' };
  }
  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) {
    return { ok: false, reason: 'unique local IPv6 range' };
  }
  if ((first & 0xffc0) === 0xfe80) {
    return { ok: false, reason: 'IPv6 link-local range' };
  }
  if ((first & 0xff00) === 0xff00) {
    return { ok: false, reason: 'IPv6 multicast range' };
  }
  return { ok: true, family: 6 };
}

/** Verdict for one address of any family. Non-canonical literals are refused rather than reinterpreted. */
export function classifyAddress(address: string): AddressVerdict {
  if (isIPv4(address)) {
    return classifyIPv4(address);
  }
  if (isIPv6(address)) {
    return classifyIPv6(address);
  }
  return { ok: false, reason: 'not an IP address' };
}

/** Every resolved address must be public; an empty answer is refused too. */
export function classifyResolved(addresses: readonly string[]): AddressVerdict {
  if (addresses.length === 0) {
    return { ok: false, reason: 'the host resolved to no address' };
  }
  let family: 4 | 6 = 4;
  for (const address of addresses) {
    const verdict = classifyAddress(address);
    if (!verdict.ok) {
      return { ok: false, reason: `${address}: ${verdict.reason}` };
    }
    family = verdict.family;
  }
  return { ok: true, family };
}
