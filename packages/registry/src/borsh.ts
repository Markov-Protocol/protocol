import { ByteReader, ByteWriter } from '@markov/solana-codec';

/**
 * The subset of Borsh the registry program uses (`anchor_lang`'s default
 * serde): little-endian integers, fixed byte arrays written verbatim,
 * vectors as a u32 length followed by the items. Field order is the Rust
 * declaration order; there is no schema evolution inside a layout version.
 */
export class BorshWriter extends ByteWriter {
  fixedBytes(value: Uint8Array, length: number): this {
    if (value.length !== length) {
      throw new Error(`expected ${length} bytes, got ${value.length}`);
    }
    return this.bytes(value);
  }

  vec<T>(items: readonly T[], write: (writer: this, item: T) => void): this {
    this.u32(items.length);
    for (const item of items) {
      write(this, item);
    }
    return this;
  }
}

export class BorshReader extends ByteReader {
  fixedBytes(length: number): Uint8Array {
    return this.take(length);
  }

  vec<T>(read: (reader: this) => T, maxLength: number): T[] {
    const length = this.u32();
    if (length > maxLength) {
      throw new Error(`vector of ${length} items exceeds the maximum of ${maxLength}`);
    }
    const out: T[] = [];
    for (let i = 0; i < length; i += 1) {
      out.push(read(this));
    }
    return out;
  }
}
