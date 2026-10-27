/**
 * The one ZIP reader (tm 313.2 · SiyahTuş analysis AI-18): the upload's type
 * check (`knowledge-document-type.ts`, in the API process) and the DOCX
 * reader (`docx.ts`, in the worker) both walk the central directory here. Two
 * readers that disagreed about which entries an archive holds would let a
 * file pass the check as one document and be read as another.
 *
 * {@link readZipDirectory} reads names and sizes only — pure, nothing
 * decompressed, every offset checked against the buffer before it is read.
 * {@link openZipArchive} adds what reading a hostile archive needs: limits on
 * the directory before anything is inflated, and an inflate that cannot
 * produce more than the entry declared.
 */
import { crc32, inflateRawSync } from 'node:zlib';
import { DocumentParseError } from './types.js';

export interface ZipEntry {
  /** As stored (UTF-8). OPC part names compare case-insensitively — see {@link ZipArchive.find}. */
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export type ZipDirectory =
  { ok: true; entries: ZipEntry[] } | { ok: false; why: 'unreadable' | 'unsupported' };

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** The end record's fixed part; a comment of up to 65535 bytes may follow it. */
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;
const DEFLATED = 8;
const SATURATED_32 = 0xffffffff;

/**
 * The entries the central directory lists, in order — or why it cannot be
 * read. Multi-disk and ZIP64 archives (the end record's or an entry's
 * saturated fields) are `unsupported`: nothing under the 20 MiB ceiling needs
 * either.
 */
export function readZipDirectory(bytes: Buffer): ZipDirectory {
  const eocd = findEndRecord(bytes);
  if (eocd === null) return { ok: false, why: 'unreadable' };

  const disk = bytes.readUInt16LE(eocd + 4);
  const directoryDisk = bytes.readUInt16LE(eocd + 6);
  const entriesHere = bytes.readUInt16LE(eocd + 8);
  const count = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== count) {
    return { ok: false, why: 'unsupported' };
  }
  if (count === 0xffff || directorySize === SATURATED_32 || directoryOffset === SATURATED_32) {
    return { ok: false, why: 'unsupported' };
  }
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > eocd) return { ok: false, why: 'unreadable' };

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_HEADER_SIZE > directoryEnd) return { ok: false, why: 'unreadable' };
    if (bytes.readUInt32LE(at) !== CENTRAL_FILE_HEADER) return { ok: false, why: 'unreadable' };
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const nameStart = at + CENTRAL_HEADER_SIZE;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > directoryEnd) return { ok: false, why: 'unreadable' };
    const entry: ZipEntry = {
      name: bytes.toString('utf8', nameStart, nameStart + nameLength),
      flags: bytes.readUInt16LE(at + 8),
      method: bytes.readUInt16LE(at + 10),
      crc: bytes.readUInt32LE(at + 16),
      compressedSize: bytes.readUInt32LE(at + 20),
      uncompressedSize: bytes.readUInt32LE(at + 24),
      localHeaderOffset: bytes.readUInt32LE(at + 42),
    };
    if (
      entry.compressedSize === SATURATED_32 ||
      entry.uncompressedSize === SATURATED_32 ||
      entry.localHeaderOffset === SATURATED_32
    ) {
      return { ok: false, why: 'unsupported' };
    }
    entries.push(entry);
    at = next;
  }
  return { ok: true, entries };
}

/**
 * The offset of the end-of-central-directory record: searched backwards over
 * the last 22 + 65535 bytes (the record plus the longest comment), and taken
 * only when its comment ends exactly at the end of the file — a candidate
 * that leaves bytes over is a signature inside the comment, not the record.
 */
function findEndRecord(bytes: Buffer): number | null {
  const last = bytes.length - EOCD_SIZE;
  const first = Math.max(0, last - 0xffff);
  for (let at = last; at >= first; at -= 1) {
    if (bytes.readUInt32LE(at) !== END_OF_CENTRAL_DIRECTORY) continue;
    if (at + EOCD_SIZE + bytes.readUInt16LE(at + 20) === bytes.length) return at;
  }
  return null;
}

/** How much an archive may hold before any of it is inflated. */
export interface ZipLimits {
  maxEntries: number;
  /** The sum of every entry's declared uncompressed size. */
  maxTotalBytes: number;
  /** Uncompressed ÷ compressed, per entry, once the entry is past `ratioGraceBytes`. */
  maxRatio: number;
  /**
   * Below this an entry's ratio is not judged: a few kilobytes of repetitive
   * XML (an empty `settings.xml`) compress past 100:1 and are no bomb. The
   * same grace Apache POI's `ZipSecureFile` gives (100 KiB).
   */
  ratioGraceBytes: number;
}

/** AI-18's DOCX ceilings: at most 2,000 entries, 100 MB unpacked, 100:1 per entry. */
export const DOCX_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_000,
  maxTotalBytes: 100 * 1024 * 1024,
  maxRatio: 100,
  ratioGraceBytes: 100 * 1024,
};

export interface ZipArchive {
  /** The entry named `name`, compared case-insensitively (OPC part names); `null` when absent. */
  find(name: string): ZipEntry | null;
  /**
   * The entry's bytes: stored or deflated only, not encrypted, inflated to
   * exactly its declared size — an entry that would inflate past it is
   * refused mid-inflate, not after — and matching its CRC.
   */
  read(entry: ZipEntry): Buffer;
}

function refuse(detail: string): never {
  throw new DocumentParseError('parse_failed', detail);
}

/**
 * The archive in `bytes`, judged against `limits` before anything is
 * inflated: the entry count, the declared total, every entry's ratio, and no
 * name twice (case-insensitively — the same rule the upload check applies).
 * Throws `parse_failed` with the rule that refused it as the detail.
 */
export function openZipArchive(bytes: Buffer, limits: ZipLimits = DOCX_ZIP_LIMITS): ZipArchive {
  const directory = readZipDirectory(bytes);
  if (!directory.ok) refuse(`zip_${directory.why}`);
  const { entries } = directory;
  if (entries.length > limits.maxEntries) refuse('zip_too_many_entries');

  const byName = new Map<string, ZipEntry>();
  let total = 0;
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (byName.has(key)) refuse('zip_duplicate_name');
    byName.set(key, entry);
    total += entry.uncompressedSize;
    if (total > limits.maxTotalBytes) refuse('zip_too_large');
    if (
      entry.uncompressedSize > limits.ratioGraceBytes &&
      entry.uncompressedSize > entry.compressedSize * limits.maxRatio
    ) {
      refuse('zip_ratio');
    }
  }

  return {
    find: (name) => byName.get(name.toLowerCase()) ?? null,
    read: (entry) => readEntry(bytes, entry),
  };
}

function readEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  if (entry.flags & 0x1) refuse('zip_encrypted');
  const at = entry.localHeaderOffset;
  if (at + LOCAL_HEADER_SIZE > bytes.length || bytes.readUInt32LE(at) !== LOCAL_FILE_HEADER) {
    refuse('zip_unreadable');
  }
  const nameLength = bytes.readUInt16LE(at + 26);
  const extraLength = bytes.readUInt16LE(at + 28);
  const nameStart = at + LOCAL_HEADER_SIZE;
  // The local header must name the entry the directory does: a reader that
  // trusts local headers would otherwise see a different file here.
  if (bytes.toString('utf8', nameStart, nameStart + nameLength) !== entry.name) {
    refuse('zip_unreadable');
  }
  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) refuse('zip_unreadable');
  const data = bytes.subarray(dataStart, dataEnd);

  let out: Buffer;
  if (entry.method === STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) refuse('zip_size_mismatch');
    out = data;
  } else if (entry.method === DEFLATED) {
    try {
      // Inflating past the declared size throws (ERR_BUFFER_TOO_LARGE) as
      // soon as it does, so a lying size cannot make more than it claimed.
      // The floor of 1 is zlib's: a zero limit is out of its range.
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch {
      refuse('zip_inflate');
    }
    if (out.length !== entry.uncompressedSize) refuse('zip_size_mismatch');
  } else {
    refuse('zip_method');
  }
  if (crc32(out) !== entry.crc) refuse('zip_crc');
  return out;
}
