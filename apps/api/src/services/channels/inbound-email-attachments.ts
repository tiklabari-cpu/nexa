/**
 * The files on a received mail (tm 357 · SiyahTuş analysis HD-02): a dekont, a
 * screenshot of the failed deposit, an ID card.
 *
 * Each file goes through the same four doors, in order, and stops at the first
 * that refuses it:
 *
 *   1. **Readable and countable.** Valid base64, not empty, not past the
 *      tenth file of the mail.
 *   2. **What it says it is.** Only images and PDF are kept (the analysis's
 *      default, 04 HD-02 question 1), and the *bytes* decide: a PNG is a PNG
 *      because it starts like one, whatever the mail's `Content-Type` or the
 *      file's name claimed. The stored type is the sniffed one, so a `.png`
 *      in the store can never be served as anything else.
 *   3. **Not too big.** 10 MiB a file, 25 MiB a mail, counted on the decoded
 *      bytes.
 *   4. **Clean.** The virus scanner every upload goes through
 *      (`virus-scanner.ts`), failing closed: a file it could not scan is not
 *      kept, exactly as `PUT /uploads` refuses one.
 *
 * A refused file is not stored and is reported back with its reason, for the
 * ticket's system line — a refused file never refuses the mail: losing a
 * player's message because one of its files was a `.zip` would be the worse
 * failure. The same holds for the store being down: that file is reported,
 * the message is still written.
 *
 * This runs before the transaction, not inside it: the store may be a bucket
 * across the network, and no row lock should wait on it. A kept file's key is
 * an e-mailed-file key (`buildMailKey`), which `GET /uploads/{key}` does not
 * serve: it opens only through the ticket, where the role and the audit log
 * are checked.
 *
 * Sensitive: a file is marked when its name or the mail's subject names an
 * identity document (kimlik, pasaport, ehliyet, KYC — and "passport"), or when
 * the workspace treats every e-mailed file as sensitive.
 */
import type { TicketMessageAttachment } from '@siyahtus/types';
import type { ObjectStore } from '../storage/object-store.js';
import { buildMailKey } from '../storage/upload-url.js';
import type { VirusScanner } from '../storage/virus-scanner.js';

/** One file as the webhook delivers it (`InboundEmailAttachment`). */
export interface InboundAttachmentInput {
  filename: string;
  content_type: string;
  content_base64: string;
}

/** Why a file was not kept. */
export const INBOUND_ATTACHMENT_REJECTIONS = [
  'too_many',
  'unreadable',
  'type',
  'too_large',
  'over_total',
  'infected',
  'scan_unavailable',
  'store_unavailable',
] as const;
export type InboundAttachmentRejection = (typeof INBOUND_ATTACHMENT_REJECTIONS)[number];

export interface RejectedAttachment {
  name: string;
  reason: InboundAttachmentRejection;
}

export interface ScreenedAttachments {
  stored: TicketMessageAttachment[];
  rejected: RejectedAttachment[];
}

/** A file's ceiling (04 HD-02 question 1). */
export const INBOUND_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** A mail's ceiling, all its kept files together. */
export const INBOUND_ATTACHMENTS_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
/** How many files of one mail are looked at; the rest are reported, not kept. */
export const INBOUND_ATTACHMENTS_MAX = 10;

/** The types kept, each with how its bytes begin. */
const SIGNATURES: ReadonlyArray<{ type: string; matches: (bytes: Buffer) => boolean }> = [
  {
    type: 'image/png',
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { type: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/gif',
    matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  },
  {
    type: 'image/webp',
    matches: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { type: 'application/pdf', matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** The kept type these bytes are, or null. */
export function sniffAttachmentType(bytes: Buffer): string | null {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.type ?? null;
}

/**
 * Base64 once mail's line breaks are out: the alphabet, at most two `=` at the
 * end. Tested on the compacted text, so the class and the padding never
 * compete for a character and a failed match cannot backtrack.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The decoded bytes, or null when the text is not base64. */
export function decodeBase64(text: string): Buffer | null {
  const compact = text.replace(/\s+/g, '');
  if (!BASE64.test(compact) || compact.length % 4 === 1) return null;
  return Buffer.from(compact, 'base64');
}

/**
 * A name fit to show: no path (a mail client may send `C:\fakepath\x.pdf`),
 * no control characters, at most 255 characters. The name is shown and offered
 * as the download's name; it never reaches a path — the key is our own.
 */
export function displayName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (clean || 'attachment').slice(0, 255);
}

/** The words that mark a file as an identity document, folded (see {@link fold}). */
const SENSITIVE_WORDS = ['kimlik', 'pasaport', 'ehliyet', 'kyc', 'passport'];

/**
 * Lower case with the Turkish rules, marks and the dotless ı folded away: so
 * "KİMLİK", "Kimlik", "KIMLIK" and "kimlik" are one word.
 */
function fold(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i');
}

/** Whether a file name or subject names an identity document. */
export function namesIdentityDocument(text: string): boolean {
  const folded = fold(text);
  return SENSITIVE_WORDS.some((word) => folded.includes(word));
}

export interface ScreenOptions {
  store: ObjectStore;
  scanner: VirusScanner;
  licenseId: bigint;
  subject: string;
  /** The workspace's "treat every e-mailed file as sensitive". */
  allSensitive: boolean;
}

/** Every file of the mail, kept or reported (see the module comment). */
export async function screenInboundAttachments(
  files: readonly InboundAttachmentInput[],
  options: ScreenOptions,
): Promise<ScreenedAttachments> {
  const stored: TicketMessageAttachment[] = [];
  const rejected: RejectedAttachment[] = [];
  const subjectSensitive = namesIdentityDocument(options.subject);
  let total = 0;

  for (const [index, file] of files.entries()) {
    const name = displayName(file.filename);
    const refuse = (reason: InboundAttachmentRejection) => rejected.push({ name, reason });

    if (index >= INBOUND_ATTACHMENTS_MAX) {
      refuse('too_many');
      continue;
    }
    const bytes = decodeBase64(file.content_base64);
    if (!bytes || bytes.length === 0) {
      refuse('unreadable');
      continue;
    }
    const type = sniffAttachmentType(bytes);
    if (!type) {
      refuse('type');
      continue;
    }
    if (bytes.length > INBOUND_ATTACHMENT_MAX_BYTES) {
      refuse('too_large');
      continue;
    }
    if (total + bytes.length > INBOUND_ATTACHMENTS_TOTAL_MAX_BYTES) {
      refuse('over_total');
      continue;
    }

    // Fail closed, like every upload: a file nobody could scan is not kept.
    let clean: boolean;
    try {
      clean = (await options.scanner.scan(bytes)).clean;
    } catch {
      refuse('scan_unavailable');
      continue;
    }
    if (!clean) {
      refuse('infected');
      continue;
    }

    const key = buildMailKey(options.licenseId, type);
    try {
      await options.store.put(key, bytes, type);
    } catch {
      refuse('store_unavailable');
      continue;
    }
    total += bytes.length;
    stored.push({
      key,
      name,
      size: bytes.length,
      mime: type,
      scan_status: 'clean',
      sensitive: options.allSensitive || subjectSensitive || namesIdentityDocument(name),
    });
  }
  return { stored, rejected };
}

/** What the system line says about each reason. English, as the chat's system lines are. */
const REASON_TEXT: Record<InboundAttachmentRejection, string> = {
  too_many: 'more than 10 files in one e-mail',
  unreadable: 'the file could not be read',
  type: 'only images and PDF files are kept',
  too_large: 'larger than 10 MB',
  over_total: "the e-mail's files are over 25 MB together",
  infected: 'it did not pass the virus scan',
  scan_unavailable: 'the virus scan could not run, so it was not kept',
  store_unavailable: 'it could not be saved',
};

/** The ticket's system line for the files that were not kept. */
export function rejectedAttachmentsNote(rejected: readonly RejectedAttachment[]): string {
  const items = rejected.map(({ name, reason }) => `“${name}” — ${REASON_TEXT[reason]}`);
  const head =
    rejected.length === 1
      ? "A file on the player's e-mail was not kept"
      : `${rejected.length} files on the player's e-mail were not kept`;
  return `${head}: ${items.join('; ')}.`;
}
