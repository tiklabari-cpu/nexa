/**
 * Whether an attachment's bytes are the type its grant was for (tm 446 ·
 * audit F42).
 *
 * `POST /uploads` vets a *declared* type against the licence's allow-list,
 * and until this check the declaration was all there was: a grant for
 * `application/pdf` stored whatever bytes arrived, so a renamed `setup.exe`
 * went into a conversation as a PDF. With file sharing on in the pilot and no
 * virus scanner behind it (owner S9, S12), this and the single-use grant are
 * the only content gate a visitor's upload passes.
 *
 * **This reads signatures, it does not parse files.** Pure, no dependency,
 * nothing decompressed; every read is a fixed offset checked against the
 * buffer first. Three rules, chosen by the granted type:
 *
 * 1. **A type with a known signature** — the images, PDF, the Office formats,
 *    the archives, common audio and video — must open with it. PDF and the
 *    Office Open XML packages (Word, Excel, PowerPoint) use the knowledge
 *    base's own readers (`knowledge-document-type.ts`): `%PDF-` at the first
 *    byte, and a ZIP whose central directory lists `[Content_Types].xml`, the
 *    format's main part, no VBA project and no name twice. An attachment and
 *    a knowledge document cannot disagree about what a `.docx` is.
 * 2. **A text type** (`text/*`, JSON, XML, `+xml`/`+json`) must look like
 *    text: no strong binary signature at the first byte and no NUL in the
 *    first 8,000 bytes — git's own test for a binary file — unless a UTF-16
 *    or UTF-32 byte-order mark says the NULs are the encoding. Text has no
 *    signature, and a legacy-encoded CSV (Windows-1254) is not UTF-8, so
 *    "valid UTF-8" would refuse files people really send.
 * 3. **Any other type** — one this table does not know, which an admin may
 *    still allow — may not be a native executable (PE/`MZ`, ELF, Mach-O).
 *    Nothing stronger is claimed: a ZIP-based format nobody listed here
 *    (EPUB, ODF, a JAR) is a ZIP, and refusing every ZIP under an unknown
 *    name would refuse real files.
 *
 * A knowledge document is not checked here: `identifyKnowledgeDocument`
 * already decides its type from its bytes in the same PUT.
 */
import { isPdf, readOfficePackage } from '../ai/knowledge-document-type.js';

/** The verdict; `why` goes to the log only (the caller sees `content_type_mismatch`). */
export type DeclaredTypeCheck =
  { ok: true } | { ok: false; why: 'signature_mismatch' | 'binary_as_text' | 'executable' };

type Test = (bytes: Buffer) => boolean;

const hex = (value: string): Buffer => Buffer.from(value, 'hex');
const ascii = (value: string): Buffer => Buffer.from(value, 'latin1');

/** `signature` at `offset`, with the buffer long enough to hold it. */
function at(bytes: Buffer, signature: Buffer, offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    bytes.subarray(offset, offset + signature.length).equals(signature)
  );
}

const startsWith =
  (...signatures: Buffer[]): Test =>
  (bytes) =>
    signatures.some((signature) => at(bytes, signature));

const PNG = startsWith(hex('89504e470d0a1a0a'));
const JPEG = startsWith(hex('ffd8ff'));
const GIF = startsWith(ascii('GIF87a'), ascii('GIF89a'));
const RIFF = ascii('RIFF');
const WEBP: Test = (bytes) => at(bytes, RIFF) && at(bytes, ascii('WEBP'), 8);
const WAVE: Test = (bytes) => at(bytes, RIFF) && at(bytes, ascii('WAVE'), 8);
const BMP = startsWith(ascii('BM'));
const TIFF = startsWith(hex('49492a00'), hex('4d4d002a'));
const ICON = startsWith(hex('00000100'));
const ZIP = startsWith(hex('504b0304'), hex('504b0506'));
const OLE = startsWith(hex('d0cf11e0a1b11ae1'));
const GZIP = startsWith(hex('1f8b08'));
const SEVEN_ZIP = startsWith(hex('377abcaf271c'));
const RAR = startsWith(ascii('Rar!\x1a\x07'));
const OGG = startsWith(ascii('OggS'));
const EBML = startsWith(hex('1a45dfa3'));
const RTF = startsWith(ascii('{\\rtf'));
/** An ISO base media file (MP4, M4A, 3GP): its first box is `ftyp`. */
const ISO_MEDIA: Test = (bytes) => at(bytes, ascii('ftyp'), 4);
/** An ID3 tag, or an MPEG audio frame's sync bits. */
const MP3: Test = (bytes) =>
  at(bytes, ascii('ID3')) ||
  (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
const PE = startsWith(ascii('MZ'));
const ELF = startsWith(hex('7f454c46'));
const MACH_O = startsWith(
  hex('feedface'),
  hex('feedfacf'),
  hex('cefaedfe'),
  hex('cffaedfe'),
  hex('cafebabe'),
);

/** An Office Open XML package carrying `mainPart` (lower-case, as OPC compares). */
const office =
  (mainPart: string): Test =>
  (bytes) => {
    const read = readOfficePackage(bytes);
    return read.ok && read.parts.has(mainPart);
  };

const DOCX = office('word/document.xml');
const XLSX = office('xl/workbook.xml');
const PPTX = office('ppt/presentation.xml');

/** Rule 1: the declared type, and what its bytes must open with. */
const SIGNATURES: ReadonlyMap<string, Test> = new Map(
  Object.entries({
    'image/png': PNG,
    'image/jpeg': JPEG,
    'image/jpg': JPEG,
    'image/gif': GIF,
    'image/webp': WEBP,
    'image/bmp': BMP,
    'image/tiff': TIFF,
    'image/x-icon': ICON,
    'image/vnd.microsoft.icon': ICON,
    'application/pdf': isPdf,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DOCX,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': XLSX,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': PPTX,
    'application/msword': OLE,
    'application/vnd.ms-excel': OLE,
    'application/vnd.ms-powerpoint': OLE,
    'application/rtf': RTF,
    'text/rtf': RTF,
    'application/zip': ZIP,
    'application/x-zip-compressed': ZIP,
    'application/gzip': GZIP,
    'application/x-gzip': GZIP,
    'application/x-7z-compressed': SEVEN_ZIP,
    'application/vnd.rar': RAR,
    'application/x-rar-compressed': RAR,
    'audio/mpeg': MP3,
    'audio/ogg': OGG,
    'video/ogg': OGG,
    'application/ogg': OGG,
    'audio/wav': WAVE,
    'audio/x-wav': WAVE,
    'audio/wave': WAVE,
    'audio/vnd.wave': WAVE,
    'audio/mp4': ISO_MEDIA,
    'audio/x-m4a': ISO_MEDIA,
    'video/mp4': ISO_MEDIA,
    'video/3gpp': ISO_MEDIA,
    'audio/webm': EBML,
    'video/webm': EBML,
    'video/x-matroska': EBML,
    // An admin who allows a program's own type gets programs — and only those.
    'application/x-msdownload': PE,
    'application/vnd.microsoft.portable-executable': PE,
    'application/x-dosexec': PE,
    'application/x-executable': ELF,
    'application/x-elf': ELF,
    'application/x-mach-binary': MACH_O,
  }),
);

/** Rule 2: the types whose bytes are text. */
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/csv']);

function isTextType(type: string): boolean {
  return (
    type.startsWith('text/') ||
    TEXT_TYPES.has(type) ||
    type.endsWith('+xml') ||
    type.endsWith('+json')
  );
}

/**
 * Signatures a text file never opens with. Only ones of three bytes or more —
 * a CSV may well start `MZ,` or `BM;` — since the NUL scan already catches
 * every binary format whose header holds a zero (an executable's does).
 */
const BINARY_OPENINGS: readonly Test[] = [
  PNG,
  JPEG,
  GIF,
  isPdf,
  ZIP,
  OLE,
  GZIP,
  SEVEN_ZIP,
  RAR,
  OGG,
  EBML,
  ELF,
  MACH_O,
];

/** A UTF-32 or UTF-16 byte-order mark: the NULs that follow are the encoding, not binary. */
const WIDE_TEXT = startsWith(hex('0000feff'), hex('fffe'), hex('feff'));

/** How far into a text file a NUL is looked for — git's `buffer_is_binary` window. */
const TEXT_SNIFF_BYTES = 8000;

function looksLikeText(bytes: Buffer): boolean {
  if (WIDE_TEXT(bytes)) return true;
  if (BINARY_OPENINGS.some((test) => test(bytes))) return false;
  return !bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0);
}

/** Rule 3: the native executable formats. */
const EXECUTABLES: readonly Test[] = [PE, ELF, MACH_O];

/**
 * Whether `bytes` may be stored as `declaredType` — the type the grant signed,
 * already lower-cased and checked against the allow-list.
 */
export function checkDeclaredType(bytes: Buffer, declaredType: string): DeclaredTypeCheck {
  const type = declaredType.toLowerCase();
  const signature = SIGNATURES.get(type);
  if (signature) return signature(bytes) ? { ok: true } : { ok: false, why: 'signature_mismatch' };
  if (isTextType(type))
    return looksLikeText(bytes) ? { ok: true } : { ok: false, why: 'binary_as_text' };
  return EXECUTABLES.some((test) => test(bytes)) ? { ok: false, why: 'executable' } : { ok: true };
}
