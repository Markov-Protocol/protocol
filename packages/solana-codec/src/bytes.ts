/** Small byte helpers shared by the encoders; every read is bounds-checked. */

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/** Lexicographic comparison of two byte strings (the order Rust's `Pubkey: Ord` uses). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) {
      return diff;
    }
  }
  return a.length - b.length;
}

export function hexToBytes(hex: string, expectedLength?: number): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) {
    throw new Error('not a hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (expectedLength !== undefined && out.length !== expectedLength) {
    throw new Error(`expected ${expectedLength} bytes, got ${out.length}`);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new Error('not a base64 string');
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

export function isZeroBytes(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

/** Sequential little-endian reader that refuses to read past the end. */
export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`truncated: needed ${length} bytes at offset ${this.offset}`);
    }
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  u8(): number {
    return this.take(1)[0] as number;
  }

  u16(): number {
    const b = this.take(2);
    return (b[0] as number) | ((b[1] as number) << 8);
  }

  u32(): number {
    const b = this.take(4);
    return (
      ((b[0] as number) | ((b[1] as number) << 8) | ((b[2] as number) << 16)) +
      (b[3] as number) * 0x1000000
    );
  }

  u64(): bigint {
    const b = this.take(8);
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      value = (value << 8n) | BigInt(b[i] as number);
    }
    return value;
  }

  i64(): bigint {
    return BigInt.asIntN(64, this.u64());
  }
}

export class ByteWriter {
  private readonly parts: Uint8Array[] = [];

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error(`u8 out of range: ${value}`);
    }
    return this.bytes(Uint8Array.of(value));
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`u16 out of range: ${value}`);
    }
    return this.bytes(Uint8Array.of(value & 0xff, value >>> 8));
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`u32 out of range: ${value}`);
    }
    return this.bytes(
      Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24),
    );
  }

  u64(value: bigint): this {
    if (value < 0n || value > 0xffffffffffffffffn) {
      throw new Error(`u64 out of range: ${value}`);
    }
    const out = new Uint8Array(8);
    let rest = value;
    for (let i = 0; i < 8; i += 1) {
      out[i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return this.bytes(out);
  }

  i64(value: bigint): this {
    if (value < -(1n << 63n) || value >= 1n << 63n) {
      throw new Error(`i64 out of range: ${value}`);
    }
    return this.u64(BigInt.asUintN(64, value));
  }

  finish(): Uint8Array {
    return concatBytes(...this.parts);
  }
}
