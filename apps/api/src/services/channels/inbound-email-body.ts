/**
 * What a player wrote, out of the mail that carried it (tm 357 · SiyahTuş
 * analysis HD-02) — the pure half: the reply cut from the quoted mail and the
 * signature under it, the text of an HTML-only mail, and the limits.
 *
 * A mail client answers by quoting everything before: "Yatırımım geçmedi,
 * 2.500 TL, saat 14:42" sits on top of three earlier rounds of the same
 * conversation and a signature. The thread shows what was written *this* time,
 * so the agent reads the new line rather than scrolling to find it. Telling the
 * two apart is a guess — there is no header that marks where a quote begins —
 * so the guess only ever hides: the whole text is kept beside the cut one
 * ("show full message"), and when the guess would leave nothing (a mail that is
 * all quote, or a quote at the very top) nothing is cut.
 *
 * What is recognised, earliest wins:
 *
 *   - an attribution line — Gmail and Apple Mail's "On … wrote:", Turkish
 *     Gmail's "… tarihinde … şunu yazdı:", Apple's "… şunları yazdı:",
 *     Thunderbird's "… yazdı:" — on one line or wrapped over two;
 *   - Outlook's "-----Original Message-----" (and the Turkish "Özgün İleti"),
 *     and its header block ("From: … / Sent: … / To: … / Subject: …",
 *     "Kimden: … / Gönderildi: … / Kime: … / Konu: …");
 *   - a block of `>`-quoted lines that runs to the end of the mail — a quote
 *     with answers written between its lines is a reply, not a quote;
 *   - the RFC 3676 signature delimiter (`-- `) and the mobile signatures
 *     ("Sent from my iPhone", "iPhone'umdan gönderildi", "Get Outlook for …").
 *
 * Masking is not done here: the service masks every text it stores
 * (`recordCustomerMessage`), the cut one and the whole one alike, before it
 * clips them to `INBOUND_EMAIL_TEXT_MAX` — clipped first, a card number cut in
 * half would no longer be recognised.
 */
import { htmlToText, sanitizeInboundHtml } from './inbound-email-html.js';

/** The reply on its own, and the whole text when something was cut from it. */
export interface SplitReply {
  text: string;
  /** Null when nothing was cut — the text is the whole mail. */
  full: string | null;
}

/** An attribution line, matched against one line or two joined by a space. */
const ATTRIBUTION = [
  // "On Mon, 20 Oct 2026 at 14:42, Jane <jane@example.com> wrote:" — Gmail,
  // Apple Mail and most others in English.
  /^\s*On\s.{1,400}\swrote\s*:\s*$/i,
  // Thunderbird and the short forms: "Jane Doe <jane@example.com> wrote:".
  /^.{0,400}[\s>]wrote\s*:\s*$/i,
  // "20 Eki 2026 Pzt, 14:42 tarihinde Ali Veli <ali@example.com> şunu yazdı:"
  // (Gmail), "20 Eki 2026 tarihinde 14:42 saatinde, Ali <…> şunları yazdı:"
  // (Apple Mail), "… tarihinde Ali Veli yazdı:" (Thunderbird).
  /^.{0,400}\s(?:şunu\s+|şunları\s+)?yazdı\s*:\s*$/iu,
];

/** How the first line of a wrapped attribution begins: "On …", or a date "… tarihinde". */
const ATTRIBUTION_OPENING = /^\s*On\s|\starihinde(?:\s|$)/iu;

/** Outlook's separators: "-----Original Message-----" and its translations. */
const ORIGINAL_MESSAGE =
  /^\s*-{2,}\s*(?:original message|forwarded message|orijinal ileti|özgün ileti|iletilen ileti|ileti)\s*-{2,}\s*$/iu;

/** The first line of a quoted header block: who it was from. */
const HEADER_FROM = /^\s*\*?(?:from|kimden|gönderen)\s*:\*?\s+\S/iu;
/** The lines that follow it in Outlook's plain-text quote. */
const HEADER_OTHER =
  /^\s*\*?(?:sent|date|to|cc|subject|gönderildi|gönderilme tarihi|tarih|kime|bilgi|konu)\s*:\*?/iu;

/** A rule Outlook draws above its header block. */
const UNDERSCORE_RULE = /^\s*_{10,}\s*$/;

/** The RFC 3676 delimiter, with or without its trailing space. */
const SIGNATURE_DELIMITER = /^--\s?$/;

/** A mobile client's own last line. */
const MOBILE_SIGNATURE =
  /^\s*(?:sent from my\s.{1,60}|sent from (?:mail|yahoo mail|outlook) for\s.{1,40}|get outlook for\s.{1,40}|iphone'umdan gönderildi|ipad'imden gönderildi|android için outlook'u edinin|.{1,40}\scihazımdan gönderildi|mobil cihazımdan gönderildi)\s*$/iu;

/** How many lines below a header line the rest of its block may sit. */
const HEADER_WINDOW = 5;

/** CR-LF and lone CR to LF, NUL dropped — Postgres refuses a NUL in text. */
export function normalizeNewlines(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/\x00/g, '');
}

function isQuoted(line: string): boolean {
  return /^\s*>/.test(line);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Whether `index` opens a quoted header block (`From:` and two of its fellows). */
function opensHeaderBlock(lines: readonly string[], index: number): boolean {
  if (!HEADER_FROM.test(lines[index]!)) return false;
  let others = 0;
  for (let i = index + 1; i < lines.length && i <= index + HEADER_WINDOW; i += 1) {
    const line = lines[i]!;
    if (line.length <= LINE_MAX && HEADER_OTHER.test(line)) others += 1;
  }
  return others >= 2;
}

/**
 * The longest line any pattern is tried on. An attribution, a separator or a
 * signature is a short line; skipping longer ones keeps every match bounded
 * whatever a two-megabyte single-line body holds.
 */
const LINE_MAX = 800;

/**
 * An attribution line. It also has to carry a date's digits or an address's
 * `@` — every client's does — so "here is what my friend wrote:" in the
 * player's own text is not taken for one.
 */
function isAttribution(line: string): boolean {
  return (
    line.length <= LINE_MAX &&
    /[\d@]/.test(line) &&
    ATTRIBUTION.some((pattern) => pattern.test(line))
  );
}

/**
 * The first line the quote or the signature starts at, or -1. An attribution
 * wrapped over two lines (Gmail breaks a long one) starts at the first of them.
 */
function cutLine(lines: readonly string[]): number {
  // Both read from the end once, so the scan stays linear in the line count.
  let lastText = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isBlank(lines[i]!)) {
      lastText = i;
      break;
    }
  }
  // The first line of the `>`-quoted block that runs to the end of the mail.
  let quotedFrom = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (isBlank(line)) continue;
    if (!isQuoted(line)) break;
    quotedFrom = i;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (i >= quotedFrom && isQuoted(line)) return i;
    if (line.length > LINE_MAX) continue;
    // Something has to follow a quote's opening: an attribution line as the
    // mail's last line is a sentence the player ended on, not a quote.
    const rest = i < lastText;

    if (rest && isAttribution(line)) return i;
    // Wrapped over two lines, the first of which opens like an attribution —
    // so the player's last line above a one-line attribution is never taken
    // for its first half.
    const next = lines[i + 1];
    if (next !== undefined && i + 1 < lastText && ATTRIBUTION_OPENING.test(line)) {
      if (isAttribution(`${line.trimEnd()} ${next.trimStart()}`)) return i;
    }
    if (rest && ORIGINAL_MESSAGE.test(line)) return i;
    if (
      UNDERSCORE_RULE.test(line) &&
      lines.slice(i + 1, i + 3).some((l) => l.length <= LINE_MAX && HEADER_FROM.test(l))
    ) {
      return i;
    }
    if (opensHeaderBlock(lines, i)) return i;
    if (rest && SIGNATURE_DELIMITER.test(line)) return i;
    if (MOBILE_SIGNATURE.test(line)) return i;
  }
  return -1;
}

/**
 * The reply cut from the quote and the signature under it.
 *
 * Nothing is cut when the cut would leave no text — the guess is then more
 * likely wrong than the mail empty — and the text is returned as it came,
 * newlines normalised, trailing blank lines dropped.
 */
export function splitReply(raw: string): SplitReply {
  // `trimEnd`, not a `\s+$` replace: that one backtracks quadratically over a
  // long run of spaces in the middle of a body.
  const whole = normalizeNewlines(raw).trimEnd();
  const lines = whole.split('\n');
  const at = cutLine(lines);
  if (at <= 0) return { text: whole, full: null };

  const reply = lines.slice(0, at).join('\n').trimEnd();
  if (reply.trim() === '') return { text: whole, full: null };
  return { text: reply, full: whole };
}

/** The most of a sanitised HTML body a message keeps; longer, only the text is kept. */
export const INBOUND_EMAIL_HTML_MAX = 500_000;

/** A mail's body, ready for the service to mask and store. */
export interface InboundBody {
  /** What the player wrote this time. Empty when the mail had no body. */
  text: string;
  /** The whole text, when something was cut from {@link text}. */
  full: string | null;
  /** The HTML part after the allow-list sanitiser, or null. */
  html: string | null;
}

/**
 * The body of a received mail: the HTML sanitised, the text taken from the
 * plain part — or, for a mail that has none, from the HTML — and split.
 *
 * The text is derived from the *raw* HTML rather than the sanitised one only in
 * the sense that both read the same parse; nothing the sanitiser drops (a
 * script's source, a style sheet) ever reaches the text.
 */
export function prepareInboundBody(input: {
  text?: string | null;
  html?: string | null;
}): InboundBody {
  const rawHtml = input.html ? normalizeNewlines(input.html) : '';
  const sanitised = rawHtml.trim() ? sanitizeInboundHtml(rawHtml) : '';
  const html = sanitised.trim() && sanitised.length <= INBOUND_EMAIL_HTML_MAX ? sanitised : null;

  const plain = input.text ? normalizeNewlines(input.text) : '';
  const source = plain.trim() ? plain : rawHtml.trim() ? htmlToText(rawHtml) : '';
  const split = splitReply(source);
  return { text: split.text, full: split.full, html };
}
