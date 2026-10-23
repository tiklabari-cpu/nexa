/**
 * Builds small MaxMind DB files in memory for tests (GEOIP-COUNTRY · tm 330):
 * the reader is checked against a database whose every record the test wrote,
 * with no download and no licensed file in the repository.
 *
 * Deliberately simple: networks must not overlap, and the tree is always an
 * IPv6 tree with IPv4 at `::a.b.c.d` (as GeoLite2 and DB-IP ship it) unless
 * `ipVersion: 4` is asked for. Strings repeated across records are written
 * once and pointed at afterwards, as real files do — so the reader's pointer
 * path is exercised, not only its inline values.
 */
import type { MmdbValue } from '../../src/services/geo/mmdb.js';

export interface MmdbEntry {
  /** `81.214.0.0/16`, `2a02:e00::/29`. */
  network: string;
  record: MmdbValue;
}

export interface MmdbWriteOptions {
  ipVersion?: 4 | 6;
  recordSize?: 24 | 28 | 32;
  databaseType?: string;
  buildEpoch?: number;
}

type Child = { kind: 'node'; index: number } | { kind: 'empty' } | { kind: 'data'; offset: number };

export function writeMmdb(entries: MmdbEntry[], options: MmdbWriteOptions = {}): Buffer {
  const ipVersion = options.ipVersion ?? 6;
  const recordSize = options.recordSize ?? 24;

  const data = new Encoder(true);
  const nodes: Array<[Child, Child]> = [[{ kind: 'empty' }, { kind: 'empty' }]];

  for (const { network, record } of entries) {
    const { bits, prefix } = networkBits(network, ipVersion);
    const offset = data.encode(record);
    let node = 0;
    for (let i = 0; i < prefix; i++) {
      const bit = bits[i]!;
      if (i === prefix - 1) {
        nodes[node]![bit] = { kind: 'data', offset };
        break;
      }
      const child = nodes[node]![bit];
      if (child.kind === 'node') {
        node = child.index;
      } else {
        nodes.push([{ kind: 'empty' }, { kind: 'empty' }]);
        nodes[node]![bit] = { kind: 'node', index: nodes.length - 1 };
        node = nodes.length - 1;
      }
    }
  }

  const nodeCount = nodes.length;
  const recordValue = (child: Child): number =>
    child.kind === 'node'
      ? child.index
      : child.kind === 'empty'
        ? nodeCount
        : nodeCount + 16 + child.offset;

  const nodeBytes = (recordSize * 2) / 8;
  const tree = Buffer.alloc(nodeBytes * nodeCount);
  nodes.forEach(([left, right], index) => {
    const at = index * nodeBytes;
    const l = recordValue(left);
    const r = recordValue(right);
    if (recordSize === 24) {
      tree.writeUIntBE(l, at, 3);
      tree.writeUIntBE(r, at + 3, 3);
    } else if (recordSize === 28) {
      tree.writeUIntBE(l & 0xffffff, at, 3);
      tree[at + 3] = ((l >> 24) << 4) | (r >> 24);
      tree.writeUIntBE(r & 0xffffff, at + 4, 3);
    } else {
      tree.writeUInt32BE(l, at);
      tree.writeUInt32BE(r, at + 4);
    }
  });

  const metadata = new Encoder(false);
  metadata.encode({
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
    build_epoch: BigInt(options.buildEpoch ?? 1_760_000_000),
    database_type: options.databaseType ?? 'SiyahTus-Test-City',
    description: { en: 'Test database written by mmdb-writer.ts' },
    ip_version: ipVersion,
    languages: ['en'],
    node_count: nodeCount,
    record_size: recordSize,
  });

  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    data.bytes(),
    Buffer.from([0xab, 0xcd, 0xef]),
    Buffer.from('MaxMind.com', 'ascii'),
    metadata.bytes(),
  ]);
}

function networkBits(network: string, ipVersion: 4 | 6): { bits: Array<0 | 1>; prefix: number } {
  const [address, length] = network.split('/') as [string, string];
  const prefix = Number(length);
  const v4 = /^\d+\.\d+\.\d+\.\d+$/.test(address);
  let bytes: number[];
  if (v4) {
    bytes = address.split('.').map(Number);
  } else {
    const [head, tail = ''] = address.split('::') as [string, string?];
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = [...h, ...new Array<string>(8 - h.length - t.length).fill('0'), ...t];
    bytes = groups.flatMap((g) => {
      const n = parseInt(g, 16);
      return [n >> 8, n & 0xff];
    });
  }
  const bits: Array<0 | 1> = [];
  if (v4 && ipVersion === 6) bits.push(...new Array<0 | 1>(96).fill(0));
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) as 0 | 1);
  return { bits, prefix: prefix + (v4 && ipVersion === 6 ? 96 : 0) };
}

class Encoder {
  readonly #chunks: number[] = [];
  readonly #strings = new Map<string, number>();

  constructor(private readonly dedupe: boolean) {}

  bytes(): Buffer {
    return Buffer.from(this.#chunks);
  }

  /** Append `value`; returns the offset it starts at. */
  encode(value: MmdbValue): number {
    const start = this.#chunks.length;
    if (typeof value === 'string') {
      const seen = this.dedupe ? this.#strings.get(value) : undefined;
      if (seen !== undefined) {
        this.#pointer(seen);
      } else {
        const payload = Buffer.from(value, 'utf8');
        this.#header(2, payload.length);
        this.#chunks.push(...payload);
        if (this.dedupe) this.#strings.set(value, start);
      }
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
        const payload = uintBytes(BigInt(value));
        this.#header(6, payload.length);
        this.#chunks.push(...payload);
      } else {
        const payload = Buffer.alloc(8);
        payload.writeDoubleBE(value);
        this.#header(3, 8);
        this.#chunks.push(...payload);
      }
    } else if (typeof value === 'bigint') {
      const payload = uintBytes(value);
      this.#header(9, payload.length);
      this.#chunks.push(...payload);
    } else if (typeof value === 'boolean') {
      this.#header(14, value ? 1 : 0);
    } else if (Buffer.isBuffer(value)) {
      this.#header(4, value.length);
      this.#chunks.push(...value);
    } else if (Array.isArray(value)) {
      this.#header(11, value.length);
      for (const item of value) this.encode(item);
    } else {
      const keys = Object.keys(value);
      this.#header(7, keys.length);
      for (const key of keys) {
        this.encode(key);
        this.encode(value[key]!);
      }
    }
    return start;
  }

  #header(type: number, size: number): void {
    let sizeBits: number;
    const extra: number[] = [];
    if (size < 29) sizeBits = size;
    else if (size < 285) {
      sizeBits = 29;
      extra.push(size - 29);
    } else if (size < 65_821) {
      sizeBits = 30;
      extra.push((size - 285) >> 8, (size - 285) & 0xff);
    } else {
      sizeBits = 31;
      const n = size - 65_821;
      extra.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    }
    if (type <= 7) {
      this.#chunks.push((type << 5) | sizeBits, ...extra);
    } else {
      this.#chunks.push(sizeBits, type - 7, ...extra);
    }
  }

  #pointer(offset: number): void {
    if (offset < 2048) {
      this.#chunks.push(0x20 | (offset >> 8), offset & 0xff);
    } else if (offset < 2048 + 524_288) {
      const v = offset - 2048;
      this.#chunks.push(0x28 | (v >> 16), (v >> 8) & 0xff, v & 0xff);
    } else {
      throw new Error('mmdb-writer: test databases stay under 512 KiB of data');
    }
  }
}

function uintBytes(value: bigint): number[] {
  const bytes: number[] = [];
  for (let v = value; v > 0n; v >>= 8n) bytes.unshift(Number(v & 0xffn));
  return bytes;
}
