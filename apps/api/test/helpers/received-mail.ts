/**
 * A message as the fake SMTP server received it, read back into what a person
 * would see (tm 255.4).
 *
 * `FakeSmtpServer` records the raw DATA — headers, a quoted-printable body, a
 * subject that may be RFC 2047 encoded — because the carrier's tests assert on
 * the wire. A test that wants the reset link out of a mail needs the opposite:
 * the text after decoding, the way a mail client shows it. Quoted-printable is
 * not optional here: it turns `token=` into `token=3D` and soft-wraps any line
 * over 76 characters, so a link read straight off the wire is a broken link.
 *
 * Decodes exactly what `src/services/mail/mime.ts` writes and nothing more — a
 * single `text/plain` part, or since tm 265 a `multipart/alternative` (text +
 * HTML) possibly inside a `multipart/mixed` with base64 attachments — and `B`
 * encoded-words. `body` is always the plain-text part, so a test that reads a
 * link out of it works whatever else the message carries. Which is also why it
 * is a test helper and not a parser anybody should reuse. Shared with the e2e
 * suite's SMTP stand-in (`scripts/mock-smtp-server.ts`).
 */

export interface ReceivedAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface ReceivedMail {
  to: string;
  from: string;
  subject: string;
  /** The plain-text part. */
  body: string;
  /** The HTML part, when the message had one. */
  html?: string;
  attachments?: ReceivedAttachment[];
  /** `Content-Language`, when set. */
  language?: string;
  /** `Reply-To`, when set (tm 358 — a ticket's reply address). */
  replyTo?: string;
  /** `Message-ID`, brackets off — what an answer's `In-Reply-To` names. */
  messageId?: string;
}

interface Part {
  headers: Map<string, string>;
  body: string;
}

function splitPart(raw: string): Part {
  const split = raw.indexOf('\r\n\r\n');
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? '' : raw.slice(split + 4);
  const headers = new Map<string, string>();
  // Unfold first: a folded header continues on a line starting with whitespace.
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body };
}

function decodePartBody(part: Part): string {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '').toLowerCase();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(part.body);
  if (encoding === 'base64') {
    return Buffer.from(part.body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  return part.body;
}

/** The leaf parts of a (possibly nested) multipart body, in order. */
function leaves(part: Part): Part[] {
  const type = part.headers.get('content-type') ?? 'text/plain';
  const boundary = /boundary="([^"]+)"/i.exec(type)?.[1];
  if (!/^multipart\//i.test(type) || !boundary) return [part];
  const sections = part.body.split(`--${boundary}`);
  // [0] is the preamble, the last one starts with `--` (the close delimiter).
  return sections
    .slice(1)
    .filter((section) => !section.startsWith('--'))
    .map((section) => splitPart(section.replace(/^\r\n/, '').replace(/\r\n$/, '')))
    .flatMap(leaves);
}

export function readReceivedMail(raw: string): ReceivedMail {
  const top = splitPart(raw);
  const parts = leaves(top);

  let body = '';
  let html: string | undefined;
  const attachments: ReceivedAttachment[] = [];
  for (const part of parts) {
    const type = part.headers.get('content-type') ?? 'text/plain';
    const disposition = part.headers.get('content-disposition') ?? '';
    if (/^attachment/i.test(disposition)) {
      attachments.push({
        filename: /filename="([^"]*)"/i.exec(disposition)?.[1] ?? '',
        contentType: type.split(';')[0]!.trim(),
        content: decodePartBody(part),
      });
    } else if (/^text\/html/i.test(type)) {
      html = decodePartBody(part).replace(/\r\n/g, '\n');
    } else if (/^text\/plain/i.test(type)) {
      body = decodePartBody(part);
    }
  }

  const language = top.headers.get('content-language');
  const replyTo = top.headers.get('reply-to');
  const messageId = top.headers.get('message-id')?.replace(/^<(.*)>$/, '$1');
  return {
    to: top.headers.get('to') ?? '',
    from: top.headers.get('from') ?? '',
    subject: decodeEncodedWords(top.headers.get('subject') ?? ''),
    body: body.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
    ...(html !== undefined ? { html } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(language ? { language } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

/**
 * The first link in a body whose path is `path` (`/join`, `/reset-password`).
 * By path rather than by origin, so a reader need not know which `WEB_APP_URL`
 * the server that wrote it was given.
 */
export function linkIn(body: string, path: string): string | null {
  for (const candidate of body.match(/https?:\/\/\S+/g) ?? []) {
    if (new URL(candidate).pathname === path) return candidate;
  }
  return null;
}

/** The `token` query parameter of the first link in `body` whose path is `path`. */
export function tokenIn(body: string, path: string): string | null {
  const link = linkIn(body, path);
  return link ? new URL(link).searchParams.get('token') : null;
}

function decodeQuotedPrintable(text: string): string {
  const unfolded = text.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i += 1) {
    const char = unfolded[i]!;
    const hex = unfolded.slice(i + 1, i + 3);
    if (char === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeEncodedWords(value: string): string {
  // Whitespace between two adjacent encoded-words is not part of the text.
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, base64: string) =>
      Buffer.from(base64, 'base64').toString('utf8'),
    );
}
