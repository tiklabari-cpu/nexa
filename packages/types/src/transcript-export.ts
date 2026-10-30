/**
 * A connection's transcript, on demand (AR-04 · tm 338): downloaded as plain
 * text, opened as a printable page (the browser saves it as a PDF, with the
 * Turkish letters the reports' PDF writer cannot draw), or mailed out.
 *
 *   - `GET /chats/{chatId}/threads/{threadId}/transcript?format=&audience=`
 *   - `POST /chats/{chatId}/threads/{threadId}/transcript/email`
 *
 * Two copies (AR-04-S2): the player's (`customer`) leaves out every internal
 * note, the team's (`internal`) carries them marked as notes. Only the
 * player's copy is ever mailed; the internal one is downloaded or printed.
 * Mail goes to the player's own address or to one of the workspace's allowed
 * domains (AR-04-S3, `inbox_settings.transcript_allowed_domains`).
 *
 * Plain literals and functions only: this module reaches the widget loader
 * through the barrel, and a top-level call would keep it in that bundle.
 */

export const TRANSCRIPT_EXPORT_FORMATS = ['txt', 'html'] as const;
export type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_FORMATS)[number];

/** `customer` = the player's copy, no internal notes; `internal` = the team's, notes marked. */
export const TRANSCRIPT_AUDIENCES = ['customer', 'internal'] as const;
export type TranscriptAudience = (typeof TRANSCRIPT_AUDIENCES)[number];

/**
 * Downloads, prints and mails one person may ask for in a minute, together.
 * A person reading conversations one by one stays far below it; a script
 * walking the archive to copy it out does not.
 */
export const TRANSCRIPT_EXPORTS_PER_MINUTE = 10;

/** How many domains a workspace may allow transcripts to be mailed to. */
export const TRANSCRIPT_ALLOWED_DOMAINS_MAX = 20;

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * A domain as the settings store it: trimmed, lower-case, without a leading
 * `@` — or null when it is not a domain name (`sirket.com`, not `sirket` or
 * `*.sirket.com`).
 */
export function normaliseTranscriptDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/^@/, '');
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

/** The part of an address after the last `@`, lower-case; null without one. */
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return null;
  return address
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/*
 * A player's own copy, and the copies a workspace forwards (WG-06 · tm 345).
 *
 * K26: a closing chat no longer mails the player. The player asks for their
 * copy from the widget (`POST /customer/chat/transcript`), and a workspace may
 * forward every closed connection to up to five addresses of its own
 * (`inbox_settings.transcript_forward_to`) — the player's copy, or with
 * `transcript_forward_include_notes` the team's, which only addresses at the
 * workspace's verified domains may receive.
 */

/** How many addresses every closed connection may be forwarded to. */
export const TRANSCRIPT_FORWARD_MAX = 5;

/** How many times a player may have one connection mailed to them. */
export const TRANSCRIPT_REQUESTS_PER_CHAT = 3;

/** How many copies one player may ask for in an hour, across connections. */
export const TRANSCRIPT_REQUESTS_PER_HOUR = 5;

/**
 * A forwarding address as the settings store it: trimmed, its domain
 * lower-case — or null when it is not an address at a domain name.
 */
export function normaliseForwardAddress(input: string): string | null {
  const address = input.trim();
  const at = address.lastIndexOf('@');
  if (at <= 0 || address.length > 254) return null;
  const local = address.slice(0, at);
  if (/[\s@<>,;"]/.test(local)) return null;
  const domain = normaliseTranscriptDomain(address.slice(at + 1));
  return domain === null ? null : `${local}@${domain}`;
}

/**
 * The first forwarding address whose domain is not one the workspace has
 * verified, or null when every one is — the rule for forwarding internal
 * notes (WG-06 Q2). Without notes any address may be forwarded to.
 */
export function unverifiedForwardAddress(
  addresses: readonly string[],
  verifiedDomains: readonly string[],
): string | null {
  for (const address of addresses) {
    const domain = emailDomain(address);
    if (domain === null || !verifiedDomains.includes(domain)) return address;
  }
  return null;
}
