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
 * single-part `text/plain` body and `B` encoded-words — which is also why it is
 * a test helper and not a parser anybody should reuse. Shared with the e2e
 * suite's SMTP stand-in (`scripts/mock-smtp-server.ts`).
 */

export interface ReceivedMail {
  to: string;
  from: string;
  subject: string;
  body: string;
}

export function readReceivedMail(raw: string): ReceivedMail {
  const split = raw.indexOf('\r\n\r\n');
  const head = split < 0 ? raw : raw.slice(0, split);
  const encodedBody = split < 0 ? '' : raw.slice(split + 4);

  const headers = new Map<string, string>();
  // Unfold first: a folded header continues on a line starting with whitespace.
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }

  const quotedPrintable = /quoted-printable/i.test(headers.get('content-transfer-encoding') ?? '');
  const body = quotedPrintable ? decodeQuotedPrintable(encodedBody) : encodedBody;

  return {
    to: headers.get('to') ?? '',
    from: headers.get('from') ?? '',
    subject: decodeEncodedWords(headers.get('subject') ?? ''),
    body: body.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
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
