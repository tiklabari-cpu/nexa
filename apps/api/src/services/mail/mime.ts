/**
 * The bytes of one outgoing message — RFC 5322 headers, one `text/plain` part
 * (tm 255.3).
 *
 * Every message Nexa sends is a plain-text body with a subject (`Message` in
 * `mailer.ts`; turning the templates into HTML is out of scope), so the MIME
 * this needs is one part and seven headers. What has to be right is the
 * encoding, because both halves routinely carry Turkish and every other
 * non-ASCII script:
 *
 * - **Subject** — RFC 2047 `B` encoded-words when it is not plain ASCII. Each
 *   word holds whole characters (§5: a word must not split one), and each line
 *   of the header stays within the 76 characters §2 allows a line that carries
 *   an encoded word.
 * - **Body** — UTF-8 in quoted-printable (RFC 2045 §6.7), which keeps every line
 *   within 76 characters and every octet 7-bit. That works on any server,
 *   8BITMIME or not, and leaves the ASCII text of a body readable on the wire.
 *
 * Header injection is closed here rather than trusted to callers: a
 * `ticket_notice` subject is text a workspace wrote (FR-MOD-08.7.5). A CR or LF
 * in it would end the header and start a new one — a `Bcc:` of the author's
 * choosing — so line breaks in a subject become a space before anything is
 * encoded. Addresses are validated by the carrier before this runs.
 *
 * Dot-stuffing is not this module's job: it is a property of the SMTP DATA
 * stream, not of the message, so `smtp-session.ts` applies it on the way out.
 */

const CRLF = '\r\n';

/** A line of a header that carries an encoded word may be at most this long (RFC 2047 §2). */
const ENCODED_LINE_LIMIT = 76;
/** A quoted-printable line may be at most this long, soft break included (RFC 2045 §6.7). */
const QP_LINE_LIMIT = 76;

export interface ComposeInput {
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  /** Without the angle brackets. */
  messageId: string;
}

export function composeMessage(input: ComposeInput): string {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    foldSubject(input.subject),
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: <${input.messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${encodeQuotedPrintable(input.body)}${CRLF}`;
}

/**
 * `Tue, 22 Sep 2026 21:54:00 +0000`. `toUTCString` already produces RFC 5322's
 * layout; only its zone is the obsolete `GMT` form (§4.3), so that is swapped.
 */
export function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, '+0000');
}

/**
 * Printable ASCII, not something a decoder could mistake for an encoded word,
 * and short enough that `Subject: ` plus the text stays within RFC 5322's
 * 998-character line (§2.1.1). Anything longer is encoded, which folds it.
 */
function isPlainHeaderText(text: string): boolean {
  return (
    /^[\x20-\x7e]*$/.test(text) && !text.includes('=?') && text.length <= 998 - 'Subject: '.length
  );
}

/**
 * The whole `Subject:` header, folded.
 *
 * Plain ASCII goes out as written. Anything else becomes a run of encoded
 * words, 39 bytes of UTF-8 at most in each: 52 base64 characters plus the 12 of
 * `=?UTF-8?B?…?=` is 64, which keeps the first line (`Subject: ` is 9) and every
 * continuation (a leading space) under {@link ENCODED_LINE_LIMIT}.
 */
export function foldSubject(subject: string): string {
  const text = subject.replace(/[\r\n]+/g, ' ');
  if (isPlainHeaderText(text)) return `Subject: ${text}`;
  const words = encodedWords(text, 39);
  return `Subject: ${words.join(`${CRLF} `)}`;
}

/** RFC 2047 `B` encoded words, each holding at most `maxBytes` of UTF-8 and only whole characters. */
export function encodedWords(text: string, maxBytes: number): string[] {
  const words: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (chunkBytes + size > maxBytes && chunk) {
      words.push(encodedWord(chunk));
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += size;
  }
  if (chunk || words.length === 0) words.push(encodedWord(chunk));
  for (const word of words) {
    // A structural claim, checked rather than trusted: the arithmetic above is
    // what keeps a folded line legal.
    if (word.length + 9 > ENCODED_LINE_LIMIT) {
      throw new Error('encoded word exceeds the RFC 2047 line limit');
    }
  }
  return words;
}

function encodedWord(chunk: string): string {
  return `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`;
}

/**
 * RFC 2045 §6.7 quoted-printable over the UTF-8 bytes of `text`.
 *
 * Line breaks in the input — CRLF, LF or a lone CR — become the CRLF hard
 * breaks of the encoded body. Within a line: printable ASCII other than `=`
 * stays literal (rule 2), space and tab stay literal except at the end of a
 * line, where they would be stripped in transit (rule 3), and every other octet
 * becomes `=XX` (rule 1). A line longer than 76 characters is cut with a soft
 * break `=` (rule 5) — never inside an `=XX` triplet.
 */
export function encodeQuotedPrintable(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => encodeQuotedPrintableLine(line))
    .join(CRLF);
}

function encodeQuotedPrintableLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  const tokens: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    const last = i === bytes.length - 1;
    if ((byte === 0x20 || byte === 0x09) && !last) {
      tokens.push(String.fromCharCode(byte));
    } else if (byte >= 33 && byte <= 126 && byte !== 61) {
      tokens.push(String.fromCharCode(byte));
    } else {
      tokens.push(`=${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  }

  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    // Room is left for the soft break's own `=`.
    if (current.length + token.length > QP_LINE_LIMIT - 1) {
      lines.push(`${current}=`);
      current = '';
    }
    current += token;
  }
  lines.push(current);
  return lines.join(CRLF);
}
