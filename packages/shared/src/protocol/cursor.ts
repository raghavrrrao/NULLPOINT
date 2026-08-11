/**
 * Little-endian byte cursors.
 *
 * Every multi-byte read and write in the protocol goes through these, so
 * endianness is decided in exactly one place. `NETWORK_PROTOCOL.md` §1.1 says
 * little-endian throughout; `DataView` defaults to big-endian, which is the
 * single easiest way to get a wire format silently wrong.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class ByteWriter {
  private view: DataView;
  private bytes: Uint8Array;
  private offset = 0;

  constructor(initialCapacity = 256) {
    this.bytes = new Uint8Array(initialCapacity);
    this.view = new DataView(this.bytes.buffer);
  }

  private reserve(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.bytes.length) return;
    let capacity = this.bytes.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.offset));
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number): void {
    this.reserve(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  u16(value: number): void {
    this.reserve(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  i16(value: number): void {
    this.reserve(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number): void {
    this.reserve(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  f32(value: number): void {
    this.reserve(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  /** `str(n)`: `u16` byte length then UTF-8 bytes. */
  str(value: string): void {
    const encoded = encoder.encode(value);
    this.u16(encoded.length);
    this.reserve(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  /** The written bytes. A copy, so later writes cannot mutate a sent frame. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }

  get length(): number {
    return this.offset;
  }
}

/** Thrown only inside the codec, and always converted to a `DecodeFailure`. */
export class ReadOverrunError extends Error {
  constructor(needed: number, remaining: number) {
    super(`read of ${needed} bytes with ${remaining} remaining`);
    this.name = "ReadOverrunError";
  }
}

export class ByteReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(count: number): void {
    if (this.offset + count > this.bytes.byteLength) {
      throw new ReadOverrunError(count, this.bytes.byteLength - this.offset);
    }
  }

  u8(): number {
    this.need(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16(): number {
    this.need(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /**
   * `str(n)`, with a caller-supplied cap.
   *
   * The cap is passed in rather than fixed because each field has its own limit
   * (§6.2), and a length prefix is the classic place to be handed a number that
   * would allocate far more than the frame could possibly contain.
   */
  str(maxBytes: number): string {
    const length = this.u16();
    if (length > maxBytes) throw new ReadOverrunError(length, maxBytes);
    this.need(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    // `fatal: true` — invalid UTF-8 must be a protocol error, not U+FFFD.
    return decoder.decode(slice);
  }

  get consumed(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }
}
