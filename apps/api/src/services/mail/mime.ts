/**
 * The bytes of one outgoing message — RFC 5322 headers, one `text/plain` part
 * (tm 255.3).
 *
 * A message is a plain-text body with a subject, and since tm 265 optionally an
 * HTML alternative and file attachments (`Message` in `mailer.ts`):
 *
 * - text only — one `text/plain` part, byte for byte what it always was;
 * - text + HTML — `multipart/alternative`, plain text first (RFC 2046 §5.1.4:
 *   the last part is the preferred one, so a client that renders HTML shows it
 *   and every other shows the text);
 * - with attachments — `multipart/mixed` around the above, each attachment
 *   base64 in its own part.
 *
 * What has to be right is the encoding, because every part routinely carries
 * Turkish and every other non-ASCII script:
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

/** A file carried with a message (tm 265 — the scheduled report's CSV). */
export interface MailAttachment {
  /** Shown to the reader; quotes and line breaks are removed before it reaches a header. */
  filename: string;
  /** e.g. `text/csv; charset=utf-8`. */
  contentType: string;
  /** The file's text; sent as its UTF-8 bytes, base64 encoded. */
  content: string;
}

export interface ComposeInput {
  from: string;
  to: string;
  subject: string;
  body: string;
  /** The HTML alternative of `body`, when there is one (tm 265). */
  html?: string | undefined;
  attachments?: readonly MailAttachment[] | undefined;
  /** `Content-Language` (RFC 3282), e.g. `tr`. */
  language?: string | undefined;
  date: Date;
  /** Without the angle brackets. */
  messageId: string;
  /** Shown beside `from` (tm 356.3) — a workspace's name, so text a workspace wrote. */
  fromName?: string | undefined;
  /** `In-Reply-To` and `References` (tm 356.3), without brackets; an invalid id is left out. */
  inReplyTo?: string | undefined;
  references?: readonly string[] | undefined;
}

export function composeMessage(input: ComposeInput): string {
  const headers = [
    fromHeader(input.from, input.fromName),
    `To: ${input.to}`,
    foldSubject(input.subject),
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: <${input.messageId}>`,
  ];
  // The thread (RFC 5322 §3.6.4). Each id is checked here rather than trusted:
  // the ids a reply threads on are partly ones a player's mail server chose,
  // and a line break in one would be a header of the sender's choosing.
  if (input.inReplyTo !== undefined && isMessageId(input.inReplyTo)) {
    headers.push(`In-Reply-To: <${input.inReplyTo}>`);
  }
  const references = (input.references ?? []).filter(isMessageId);
  if (references.length > 0) {
    // One id per line, so no line grows with the thread.
    headers.push(`References: ${references.map((id) => `<${id}>`).join(`${CRLF} `)}`);
  }
  headers.push('MIME-Version: 1.0');
  if (input.language && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language)) {
    headers.push(`Content-Language: ${input.language}`);
  }

  const textPart: MimePart = {
    headers: [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
    ],
    body: encodeQuotedPrintable(input.body),
  };
  let content: MimePart = textPart;
  if (input.html !== undefined) {
    content = multipart('alternative', `alt-${input.messageId}`, [
      textPart,
      {
        headers: [
          'Content-Type: text/html; charset=utf-8',
          'Content-Transfer-Encoding: quoted-printable',
        ],
        body: encodeQuotedPrintable(input.html),
      },
    ]);
  }
  if (input.attachments && input.attachments.length > 0) {
    content = multipart('mixed', `mix-${input.messageId}`, [
      content,
      ...input.attachments.map(attachmentPart),
    ]);
  }

  return `${[...headers, ...content.headers].join(CRLF)}${CRLF}${CRLF}${content.body}${CRLF}`;
}

interface MimePart {
  headers: string[];
  body: string;
}

/**
 * A boundary no part can contain: derived from the message id (unique per
 * message) and limited to RFC 2046's safe characters. Every part's body is
 * quoted-printable or base64, and neither can produce a line starting `--`
 * followed by this string, because `=` is the only character QP adds and the
 * boundary carries none.
 */
function boundaryFor(seed: string): string {
  return `=_siyahtus_${seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 48)}`;
}

function multipart(subtype: 'alternative' | 'mixed', seed: string, parts: MimePart[]): MimePart {
  const boundary = boundaryFor(seed);
  const body = [
    ...parts.map(
      (part) => `--${boundary}${CRLF}${part.headers.join(CRLF)}${CRLF}${CRLF}${part.body}`,
    ),
    `--${boundary}--`,
  ].join(CRLF);
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`], body };
}

function attachmentPart(attachment: MailAttachment): MimePart {
  const filename = attachment.filename.replace(/[\r\n"\\]+/g, '_').trim() || 'attachment';
  const contentType = attachment.contentType.replace(/[\r\n]+/g, ' ');
  const base64 = Buffer.from(attachment.content, 'utf8').toString('base64');
  return {
    headers: [
      `Content-Type: ${contentType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
    ],
    // 76-character lines (RFC 2045 §6.8).
    body: (base64.match(/.{1,76}/g) ?? ['']).join(CRLF),
  };
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

/**
 * A message id as RFC 5322 §3.6.4 writes it inside the brackets, in the
 * `dot-atom@dot-atom` form every mail server produces — no space, no line
 * break, no bracket, one `@`. Anything else is not written into a header.
 */
export function isMessageId(id: string): boolean {
  return (
    id.length <= 250 &&
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(id)
  );
}

/** At most this many characters of a display name — a name, not a paragraph. */
const FROM_NAME_MAX = 100;

/**
 * `From:` with a display name when there is one (tm 356.3): `"Acme" <a@b>`.
 *
 * The name is a workspace's, so it is treated like a `ticket_notice` subject —
 * line breaks and other control characters become a space before anything
 * else, which is what keeps it from ending the header. Printable ASCII goes
 * out as a quoted string (RFC 5322 §3.2.4, `"` and `\` escaped); anything else
 * as encoded words (RFC 2047 §5(3) allows them in a display name), folded like
 * the subject.
 */
function fromHeader(address: string, name: string | undefined): string {
  // By code point, so the cut never splits a character.
  const display = [
    ...(name ?? '')
      // eslint-disable-next-line no-control-regex -- control characters are what is removed
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, FROM_NAME_MAX)
    .join('')
    .trim();
  if (!display) return `From: ${address}`;
  if (/^[\x20-\x7e]*$/.test(display) && !display.includes('=?')) {
    return `From: "${display.replace(/["\\]/g, (c) => `\\${c}`)}" <${address}>`;
  }
  return `From: ${encodedWords(display, 39).join(`${CRLF} `)}${CRLF} <${address}>`;
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
