/**
 * A reader for MaxMind DB files (`.mmdb`, format 2.0) — the offline IP
 * database both MaxMind GeoLite2 and DB-IP Lite ship (GEOIP-COUNTRY · tm 330).
 *
 * Written here rather than pulled from npm: the format is small and stable,
 * this needs only lookups, and a file the deployment mounts is the whole of
 * its input — no network, no native module, nothing that could carry a
 * visitor's address anywhere. Specification:
 * https://maxmind.github.io/MaxMind-DB/
 *
 * Layout: a binary search tree over the address bits, sixteen zero bytes,
 * a data section of typed values, and a metadata map after the marker
 * `\xAB\xCD\xEFMaxMind.com` near the end of the file.
 *
 * The file is a deployment artifact, not visitor input, but a truncated or
 * corrupt one must not hang a request: every read is bounds-checked by
 * `Buffer`, and pointer chains are cut off at a fixed depth.
 */

const METADATA_MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from('MaxMind.com', 'ascii')]);
/** The metadata section is at most 128 KiB from the end of the file. */
const METADATA_MAX_SIZE = 128 * 1024;
/** Sixteen zero bytes separate the tree from the data section. */
const DATA_SECTION_SEPARATOR = 16;
/** Nesting deeper than any real record; past it the file is corrupt. */
const MAX_DEPTH = 32;

export type MmdbValue =
  string | number | bigint | boolean | Buffer | MmdbValue[] | { [key: string]: MmdbValue };

export interface MmdbMetadata {
  /** e.g. `GeoLite2-City`, `DBIP-City-Lite`. */
  databaseType: string;
  /** When the file was built — the age the root panel reports (389.14). */
  buildEpoch: number;
  ipVersion: 4 | 6;
  nodeCount: number;
  recordSize: 24 | 28 | 32;
}

export class MmdbError extends Error {
  constructor(message: string) {
    super(`mmdb: ${message}`);
    this.name = 'MmdbError';
  }
}

interface Decoded {
  value: MmdbValue;
  next: number;
}

export class MmdbReader {
  readonly metadata: MmdbMetadata;
  readonly #buffer: Buffer;
  readonly #treeSize: number;
  readonly #dataStart: number;
  /** The node an IPv4 lookup starts from in an IPv6 tree (`::a.b.c.d`). */
  readonly #ipv4Start: number;

  constructor(buffer: Buffer) {
    this.#buffer = buffer;
    const searchFrom = Math.max(0, buffer.length - METADATA_MAX_SIZE);
    const marker = buffer.lastIndexOf(METADATA_MARKER);
    if (marker === -1 || marker < searchFrom) {
      throw new MmdbError('metadata marker not found — not a MaxMind DB file');
    }
    const metadataStart = marker + METADATA_MARKER.length;
    const raw = this.#decode(metadataStart, metadataStart, 0).value;
    this.metadata = parseMetadata(raw);

    const { nodeCount, recordSize } = this.metadata;
    this.#treeSize = ((recordSize * 2) / 8) * nodeCount;
    this.#dataStart = this.#treeSize + DATA_SECTION_SEPARATOR;
    if (this.#dataStart > marker) {
      throw new MmdbError('search tree is larger than the file');
    }

    let node = 0;
    if (this.metadata.ipVersion === 6) {
      for (let i = 0; i < 96 && node < nodeCount; i++) node = this.#record(node, 0);
    }
    this.#ipv4Start = node;
  }

  /**
   * The record for an address given as raw bytes (4 for IPv4, 16 for IPv6),
   * or `null` when the database holds nothing for it.
   */
  lookup(bytes: Uint8Array): MmdbValue | null {
    const { nodeCount, ipVersion } = this.metadata;
    if (bytes.length === 16 && ipVersion === 4) return null;
    if (bytes.length !== 4 && bytes.length !== 16) return null;

    let node = bytes.length === 4 ? this.#ipv4Start : 0;
    const bitCount = bytes.length * 8;
    for (let i = 0; i < bitCount && node < nodeCount; i++) {
      const bit = (bytes[i >> 3]! >> (7 - (i & 7))) & 1;
      node = this.#record(node, bit);
    }

    if (node === nodeCount) return null; // the empty record
    if (node < nodeCount) return null; // ran out of address bits inside the tree
    const offset = node - nodeCount - DATA_SECTION_SEPARATOR;
    if (offset < 0) throw new MmdbError('record points before the data section');
    return this.#decode(this.#dataStart + offset, this.#dataStart, 0).value;
  }

  /** The left (`bit` 0) or right (`bit` 1) record of a tree node. */
  #record(node: number, bit: number): number {
    const buf = this.#buffer;
    switch (this.metadata.recordSize) {
      case 24: {
        const at = node * 6 + bit * 3;
        return buf.readUIntBE(at, 3);
      }
      case 28: {
        const at = node * 7;
        if (bit === 0) return ((buf[at + 3]! & 0xf0) << 20) | buf.readUIntBE(at, 3);
        return ((buf[at + 3]! & 0x0f) << 24) | buf.readUIntBE(at + 4, 3);
      }
      case 32: {
        return buf.readUInt32BE(node * 8 + bit * 4);
      }
    }
  }

  /**
   * Decode one value at `offset`. `base` is where pointers count from: the
   * data section for records, the metadata section for the metadata map.
   */
  #decode(offset: number, base: number, depth: number): Decoded {
    if (depth > MAX_DEPTH) throw new MmdbError('value nested too deep');
    const buf = this.#buffer;
    const ctrl = readByte(buf, offset);
    let at = offset + 1;
    let type = ctrl >> 5;

    if (type === 1) {
      // Pointer: the value lives elsewhere; decoding continues after the pointer.
      const size = (ctrl >> 3) & 0x3;
      const low = ctrl & 0x7;
      let target: number;
      switch (size) {
        case 0:
          target = (low << 8) | readByte(buf, at);
          at += 1;
          break;
        case 1:
          target = ((low << 16) | buf.readUInt16BE(at)) + 2048;
          at += 2;
          break;
        case 2:
          target = ((low << 24) | buf.readUIntBE(at, 3)) + 526_336;
          at += 3;
          break;
        default:
          target = buf.readUInt32BE(at);
          at += 4;
      }
      return { value: this.#decode(base + target, base, depth + 1).value, next: at };
    }

    if (type === 0) {
      type = 7 + readByte(buf, at);
      at += 1;
    }

    let size = ctrl & 0x1f;
    if (size === 29) {
      size = 29 + readByte(buf, at);
      at += 1;
    } else if (size === 30) {
      size = 285 + buf.readUInt16BE(at);
      at += 2;
    } else if (size === 31) {
      size = 65_821 + buf.readUIntBE(at, 3);
      at += 3;
    }

    switch (type) {
      case 2: // UTF-8 string
        return { value: slice(buf, at, size).toString('utf8'), next: at + size };
      case 3: // double
        if (size !== 8) throw new MmdbError('double must be 8 bytes');
        return { value: buf.readDoubleBE(at), next: at + 8 };
      case 4: // bytes
        return { value: Buffer.from(slice(buf, at, size)), next: at + size };
      case 5: // uint16
      case 6: // uint32
        return { value: size === 0 ? 0 : buf.readUIntBE(at, size), next: at + size };
      case 7: {
        // map
        const map: { [key: string]: MmdbValue } = {};
        let cursor = at;
        for (let i = 0; i < size; i++) {
          const key = this.#decode(cursor, base, depth + 1);
          if (typeof key.value !== 'string') throw new MmdbError('map key is not a string');
          const value = this.#decode(key.next, base, depth + 1);
          map[key.value] = value.value;
          cursor = value.next;
        }
        return { value: map, next: cursor };
      }
      case 8: {
        // int32
        if (size > 4) throw new MmdbError('int32 longer than 4 bytes');
        const value = size === 0 ? 0 : buf.readIntBE(at, size);
        return { value, next: at + size };
      }
      case 9: // uint64
      case 10: {
        // uint128
        let value = 0n;
        for (const byte of slice(buf, at, size)) value = (value << 8n) | BigInt(byte);
        return { value, next: at + size };
      }
      case 11: {
        // array
        const items: MmdbValue[] = [];
        let cursor = at;
        for (let i = 0; i < size; i++) {
          const item = this.#decode(cursor, base, depth + 1);
          items.push(item.value);
          cursor = item.next;
        }
        return { value: items, next: cursor };
      }
      case 14: // boolean — the size is the value
        return { value: size !== 0, next: at };
      case 15: // float
        if (size !== 4) throw new MmdbError('float must be 4 bytes');
        return { value: buf.readFloatBE(at), next: at + 4 };
      default:
        // 12 (data cache container) and 13 (end marker) never appear in a
        // record; anything past 15 is not a type.
        throw new MmdbError(`unexpected data type ${type}`);
    }
  }
}

function readByte(buf: Buffer, at: number): number {
  const byte = buf[at];
  if (byte === undefined) throw new MmdbError('read past the end of the file');
  return byte;
}

function slice(buf: Buffer, at: number, size: number): Buffer {
  if (at + size > buf.length) throw new MmdbError('read past the end of the file');
  return buf.subarray(at, at + size);
}

function parseMetadata(raw: MmdbValue): MmdbMetadata {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Buffer.isBuffer(raw)) {
    throw new MmdbError('metadata is not a map');
  }
  const major = toNumber(raw.binary_format_major_version);
  if (major !== 2) throw new MmdbError(`unsupported format version ${String(major)}`);
  const recordSize = toNumber(raw.record_size);
  if (recordSize !== 24 && recordSize !== 28 && recordSize !== 32) {
    throw new MmdbError(`unsupported record size ${String(recordSize)}`);
  }
  const ipVersion = toNumber(raw.ip_version);
  if (ipVersion !== 4 && ipVersion !== 6) {
    throw new MmdbError(`unsupported ip version ${String(ipVersion)}`);
  }
  const nodeCount = toNumber(raw.node_count);
  if (nodeCount === null || nodeCount <= 0) throw new MmdbError('node count missing');
  return {
    databaseType: typeof raw.database_type === 'string' ? raw.database_type : 'unknown',
    buildEpoch: toNumber(raw.build_epoch) ?? 0,
    ipVersion,
    nodeCount,
    recordSize,
  };
}

function toNumber(value: MmdbValue | undefined): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}
