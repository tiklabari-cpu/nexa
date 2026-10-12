/**
 * The one look every SiyahTuş e-mail shares (tm 265; the "Graphite + Indigo"
 * theme since tm 266).
 *
 * A message is described once, as content blocks (a paragraph, a button, a
 * code, a transcript…), and rendered twice: as the HTML a modern client shows
 * and as the plain text every client can show — the two halves of the
 * `multipart/alternative` `mime.ts` writes. Rendering both from the same blocks
 * is what keeps them saying the same thing; a hand-written text twin drifts.
 *
 * The theme is the panel's own (`apps/web/src/styles/tokens.css`, the 2026-10
 * redesign): near-neutral greys, one saturated colour — the indigo brand — and
 * a graphite black that is what the name promises. Every message is a card:
 *
 * - **A graphite header** with the indigo→violet "S" tile and the wordmark, the
 *   workspace the message is about on the right, and a thin brand gradient
 *   under it. Mail a workspace sends to its own customers carries the
 *   workspace's name in that place instead (`sender`) — they wrote to that
 *   business, not to us — and a quiet "Sent with SiyahTuş" at the bottom.
 * - **An icon tile** above the heading, so what kind of mail it is reads at a
 *   glance in a busy inbox; the alert tone tints it red.
 * - **One indigo button** per message, the link repeated as text under it.
 * - **Chat bubbles** that read like the panel: the visitor on the left, the
 *   team on the right in indigo, internal notes in amber.
 *
 * It is written for e-mail clients, not browsers:
 *
 * - **Tables and inline styles.** Outlook on Windows renders with Word and
 *   ignores most CSS; Gmail strips `<style>` in some views. Layout is a
 *   600-pixel table, every style that matters is inline, and the `<style>`
 *   block only adds what degrades gracefully (dark mode, small screens).
 *   Gradients always sit on a solid `background-color` of the same hue, so a
 *   client that drops them (Outlook) shows the flat brand colour instead.
 * - **A button that is a link.** The call to action is an `<a>` inside a
 *   coloured cell, padded for Outlook with `mso-padding-alt`, so it stays a
 *   link in every client — and the same URL is repeated as text under it, for
 *   clients (and people) that do not trust buttons.
 * - **A preheader.** The hidden first line inbox lists show after the subject.
 * - **Dark mode.** `color-scheme` plus `prefers-color-scheme` overrides, so
 *   Apple Mail and Outlook for Mac switch to the panel's graphite cleanly
 *   instead of half-inverting.
 * - **No images and no web fonts.** The marks are table cells and the icons
 *   are emoji, so nothing is blocked, nothing is tracked and nothing has to be
 *   hosted; the font stack names Inter first and falls back to each system's
 *   own sans-serif (Outlook is pinned to Segoe UI, which it would otherwise
 *   swap for Times New Roman).
 *
 * Every piece of text is HTML-escaped here — workspace names, customer names
 * and chat messages are written by other people — and a URL is only ever
 * placed in an `href` when it is `http(s)`; anything else is shown as text.
 */

export type MailLocale = 'en' | 'tr';

export const MAIL_LOCALES: readonly MailLocale[] = ['en', 'tr'];

export function isMailLocale(value: unknown): value is MailLocale {
  return value === 'en' || value === 'tr';
}

export type TranscriptRole = 'customer' | 'agent' | 'bot' | 'system' | 'note';

export interface TranscriptEntry {
  who: string;
  role: TranscriptRole;
  /** Already formatted for the reader (`09:14`). */
  time: string;
  text: string;
}

export type EmailBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'button'; label: string; url: string; fallback: string }
  /** A secondary action, shown as a text link rather than a second button. */
  | { type: 'link'; label: string; url: string }
  | { type: 'code'; label: string; value: string }
  | { type: 'facts'; rows: ReadonlyArray<readonly [string, string]> }
  | { type: 'note'; text: string }
  /** What to do if this was not the reader — set apart, in the warning colour. */
  | { type: 'callout'; text: string }
  | { type: 'transcript'; date: string; entries: readonly TranscriptEntry[] }
  /** Text someone else wrote (a workspace's ticket template) — kept verbatim, line breaks and all. */
  | { type: 'verbatim'; text: string };

/** `alert` tints the icon tile red — for mail about something that went wrong. */
export type MailTone = 'brand' | 'alert';

export interface EmailContent {
  locale: MailLocale;
  subject: string;
  /** The inbox-list snippet after the subject. One sentence. */
  preheader: string;
  /**
   * Whose name heads the mail. A workspace's, on mail it sends to its own
   * customers; omitted — SiyahTuş — on mail to the people who use SiyahTuş.
   */
  sender?: string;
  /** What it is about, on the right of the header — a workspace name, or omitted for account mail. */
  eyebrow?: string;
  /** One emoji for the tile above the heading; omitted for no tile. */
  icon?: string;
  tone?: MailTone;
  heading: string;
  blocks: readonly EmailBlock[];
  /** Why the reader got this, and where it came from — small print at the bottom. The last line is the signature. */
  footer: readonly string[];
  /** The panel's address, linked from the wordmark; empty for no link. */
  homeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  /** The `text/plain` part. */
  body: string;
  /** The `text/html` part. */
  html: string;
  locale: MailLocale;
}

// --- Escaping ---------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The URL when it is a plain `http(s)` address, else `null` — never a `javascript:` href. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Escaped text with its line breaks kept. */
function multiline(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}

// --- Palette -----------------------------------------------------------------

/**
 * The panel's tokens (`tokens.css`), as literal values — a mail client reads
 * no custom properties. Text colours keep the panel's AA ratios on the
 * surfaces they sit on.
 */
const C = {
  page: '#f6f6f8',
  card: '#ffffff',
  border: '#e4e4ea',
  hairline: '#ececf1',
  inset: '#f6f6f8',
  ink: '#16161d',
  body: '#4b4b5a',
  muted: '#5f5f6e',
  faint: '#6e6e7c',
  head: '#111116',
  headInk: '#ffffff',
  headMuted: '#b4b4c2',
  brand: '#5b4fe9',
  brandViolet: '#7a3fd9',
  brandOrchid: '#c940b9',
  brandTint: '#eeedfe',
  brandTintInk: '#dcd9fd',
  brandText: '#4a3fd6',
  brandDeep: '#372cb3',
  bubbleCustomer: '#f0f0f4',
  bubbleBot: '#fbeff9',
  botInk: '#a3218f',
  noteBg: '#fff7e6',
  noteBorder: '#f1dcb0',
  noteInk: '#7d6210',
  warnBar: '#f0a020',
  warnInk: '#4a3500',
  alertTint: '#fdecee',
};

const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** A solid brand colour with the gradient over it: clients without gradients keep the solid. */
const BRAND_FILL = `background-color:${C.brand};background-image:linear-gradient(135deg,${C.brand} 0%,${C.brandViolet} 100%);`;

/** Attributes every layout table carries, so no client adds its own spacing. */
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

// --- HTML ----------------------------------------------------------------------

function paragraph(text: string): string {
  return `<p class="st-p" style="margin:0 0 18px;font-size:16px;line-height:26px;color:${C.body};">${multiline(text)}</p>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return paragraph(block.text);

    case 'note':
      return `<p class="st-muted" style="margin:0 0 12px;font-size:14px;line-height:22px;color:${C.muted};">${multiline(block.text)}</p>`;

    case 'callout':
      return `<table ${TABLE} width="100%" style="margin:4px 0 24px;">
<tr><td class="st-callout" bgcolor="${C.noteBg}" style="background:${C.noteBg};border-left:4px solid ${C.warnBar};border-radius:10px;padding:14px 18px;font-size:15px;line-height:23px;color:${C.warnInk};">${multiline(block.text)}</td></tr></table>`;

    case 'button': {
      const url = safeUrl(block.url);
      if (!url) return paragraph(block.url);
      const href = escapeHtml(url);
      return `<table ${TABLE} style="margin:6px 0 22px;">
<tr><td class="st-button" align="center" bgcolor="${C.brand}" style="border-radius:10px;${BRAND_FILL}box-shadow:0 8px 20px -8px rgba(91,79,233,0.65);mso-padding-alt:14px 30px;">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;letter-spacing:0.1px;color:#ffffff;text-decoration:none;border-radius:10px;mso-padding-alt:0;">${escapeHtml(block.label)}</a>
</td></tr></table>
<p class="st-muted" style="margin:0 0 4px;font-size:13px;line-height:20px;color:${C.muted};">${escapeHtml(block.fallback)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a class="st-link" href="${href}" target="_blank" rel="noopener" style="color:${C.brandText};text-decoration:underline;">${escapeHtml(url)}</a></p>`;
    }

    case 'link': {
      const url = safeUrl(block.url);
      if (!url) return paragraph(`${block.label} ${block.url}`);
      return `<p style="margin:0 0 18px;font-size:15px;line-height:24px;"><a class="st-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${C.brandText};font-weight:600;text-decoration:none;">${escapeHtml(block.label)}&nbsp;&rarr;</a></p>`;
    }

    case 'code':
      return `<p class="st-muted" style="margin:0 0 8px;font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};">${escapeHtml(block.label)}</p>
<table ${TABLE} width="100%" style="margin:0 0 24px;">
<tr><td class="st-code" align="center" bgcolor="${C.brandTint}" style="background:${C.brandTint};border:1px dashed #c4befa;border-radius:12px;padding:20px 16px;font-family:${MONO};font-size:30px;line-height:36px;font-weight:700;letter-spacing:6px;color:${C.brandDeep};">${escapeHtml(block.value)}</td></tr></table>`;

    case 'facts':
      return `<table ${TABLE} width="100%" class="st-facts" bgcolor="${C.inset}" style="margin:4px 0 24px;background:${C.inset};border:1px solid ${C.hairline};border-radius:12px;">
<tr><td style="padding:4px 20px;">
<table ${TABLE} width="100%">
${block.rows
  .map(([label, value], index) => {
    const rule = index > 0 ? `border-top:1px solid ${C.border};` : '';
    return `<tr><td class="st-muted st-rule-cell" style="padding:11px 16px 11px 0;${rule}font-size:13px;line-height:20px;color:${C.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td class="st-ink st-rule-cell" style="padding:11px 0;${rule}font-size:14px;line-height:20px;font-weight:500;color:${C.ink};vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td></tr>`;
  })
  .join('\n')}
</table>
</td></tr></table>`;

    case 'verbatim':
      return `<div class="st-p" style="margin:0 0 18px;font-size:16px;line-height:26px;color:${C.body};">${multiline(block.text)}</div>`;

    case 'transcript':
      return `<table ${TABLE} width="100%" style="margin:4px 0 16px;">
<tr><td align="center" style="padding:0 0 14px;"><span class="st-chip" style="display:inline-block;padding:4px 12px;border-radius:999px;background:${C.bubbleCustomer};font-size:12px;line-height:16px;font-weight:600;color:${C.muted};">${escapeHtml(block.date)}</span></td></tr>
${block.entries.map(transcriptRowHtml).join('\n')}
</table>`;
  }
}

const BUBBLE: Record<
  Exclude<TranscriptRole, 'system'>,
  { bg: string; text: string; who: string; meta: string; border: string }
> = {
  customer: { bg: C.bubbleCustomer, text: C.ink, who: C.ink, meta: C.muted, border: '' },
  agent: { bg: C.brand, text: '#ffffff', who: '#ffffff', meta: C.brandTintInk, border: '' },
  bot: { bg: C.bubbleBot, text: C.ink, who: C.botInk, meta: C.muted, border: '' },
  note: {
    bg: C.noteBg,
    text: C.ink,
    who: C.noteInk,
    meta: C.noteInk,
    border: `border:1px dashed ${C.noteBorder};`,
  },
};

/**
 * One message as a bubble: the visitor on the left, the team (agent, bot,
 * internal note) on the right — the side they sit on in the panel. The tail
 * corner points at the speaker's side.
 */
function transcriptRowHtml(entry: TranscriptEntry): string {
  if (entry.role === 'system') {
    return `<tr><td class="st-muted" align="center" style="padding:4px 0 12px;font-size:12px;line-height:18px;color:${C.faint};">${escapeHtml(entry.text)} · ${escapeHtml(entry.time)}</td></tr>`;
  }
  const team = entry.role !== 'customer';
  const look = BUBBLE[entry.role];
  // The agent's indigo bubble keeps its white text in dark mode; the others
  // follow the theme, and a note keeps its amber label.
  const agent = entry.role === 'agent';
  const note = entry.role === 'note';
  const ink = agent ? '' : ' class="st-ink"';
  const meta = agent ? '' : note ? ' class="st-note-meta"' : ' class="st-muted"';
  const who = agent ? '' : note ? ' class="st-note-meta"' : ' class="st-ink"';
  const radius = team ? '16px 16px 4px 16px' : '16px 16px 16px 4px';
  return `<tr><td style="padding:0 0 10px;">
<table ${TABLE} class="st-bubble" align="${team ? 'right' : 'left'}" width="84%"><tr><td class="st-bubble-${entry.role}" bgcolor="${look.bg}" style="background:${look.bg};${look.border}border-radius:${radius};padding:10px 14px;">
<p${meta} style="margin:0 0 3px;font-size:12px;line-height:16px;color:${look.meta};"><strong${who} style="font-weight:600;color:${look.who};">${escapeHtml(entry.who)}</strong> · ${escapeHtml(entry.time)}</p>
<p${ink} style="margin:0;font-size:15px;line-height:22px;color:${look.text};">${multiline(entry.text)}</p>
</td></tr></table>
</td></tr>`;
}

/** The first letter of a name, for the tile beside it. */
function initial(name: string, locale: MailLocale): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase(locale) : 'S';
}

function headerHtml(content: EmailContent): string {
  const name = content.sender ?? 'SiyahTuş';
  const home = content.sender ? null : safeUrl(content.homeUrl);
  const wordmark = home
    ? `<a href="${escapeHtml(home)}" target="_blank" rel="noopener" style="color:${C.headInk};text-decoration:none;">${escapeHtml(name)}</a>`
    : escapeHtml(name);
  // The workspace the mail is about — unless it already heads the mail.
  const about = content.eyebrow && content.eyebrow !== content.sender ? content.eyebrow : null;
  return `<tr><td class="st-head st-pad" bgcolor="${C.head}" style="padding:22px 40px;border-radius:15px 15px 0 0;background-color:${C.head};background-image:linear-gradient(120deg,${C.head} 0%,#17153a 62%,#2a2466 100%);">
<table ${TABLE} width="100%"><tr>
<td valign="middle">
<table ${TABLE}><tr>
<td class="st-mark" width="32" height="32" align="center" valign="middle" bgcolor="${C.brand}" style="width:32px;height:32px;border-radius:9px;${BRAND_FILL}font-family:${FONT};font-size:16px;font-weight:700;line-height:32px;color:#ffffff;text-align:center;">${escapeHtml(initial(name, content.locale))}</td>
<td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:17px;line-height:22px;font-weight:700;letter-spacing:-0.2px;color:${C.headInk};">${wordmark}</td>
</tr></table>
</td>
${about ? `<td align="right" valign="middle" style="padding-left:16px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:600;color:${C.headMuted};">${escapeHtml(about)}</td>` : ''}
</tr></table>
</td></tr>
<tr><td class="st-stripe" height="3" bgcolor="${C.brand}" style="height:3px;line-height:3px;font-size:0;background-color:${C.brand};background-image:linear-gradient(90deg,${C.brand} 0%,${C.brandViolet} 50%,${C.brandOrchid} 100%);">&nbsp;</td></tr>`;
}

function iconHtml(content: EmailContent): string {
  if (!content.icon) return '';
  const alert = content.tone === 'alert';
  const tint = alert ? C.alertTint : C.brandTint;
  return `<table ${TABLE} style="margin:0 0 20px;"><tr><td class="st-tile${alert ? ' st-tile-alert' : ''}" width="48" height="48" align="center" valign="middle" bgcolor="${tint}" style="width:48px;height:48px;border-radius:14px;background:${tint};font-size:24px;line-height:48px;text-align:center;">${escapeHtml(content.icon)}</td></tr></table>`;
}

/**
 * The fine print under an action (how long a link lives, what to do if it was
 * not you) starts below a hairline, so the action is what the eye meets first.
 */
function bodyHtml(blocks: readonly EmailBlock[]): string {
  return blocks
    .map((block, index) => {
      const previous = blocks[index - 1];
      const rule =
        block.type === 'note' && (previous?.type === 'button' || previous?.type === 'link')
          ? `<table ${TABLE} width="100%" style="margin:2px 0 20px;"><tr><td class="st-rule" height="1" bgcolor="${C.hairline}" style="height:1px;line-height:1px;font-size:0;background:${C.hairline};">&nbsp;</td></tr></table>\n`
          : '';
      return rule + blockHtml(block);
    })
    .join('\n');
}

function footerHtml(lines: readonly string[]): string {
  return lines
    .map((line, index) =>
      index === lines.length - 1
        ? `<p class="st-foot" style="margin:14px 0 0;font-size:12px;line-height:18px;font-weight:600;letter-spacing:0.2px;color:${C.faint};">${escapeHtml(line)}</p>`
        : `<p class="st-foot" style="margin:0 0 6px;font-size:12px;line-height:19px;color:${C.faint};">${escapeHtml(line)}</p>`,
    )
    .join('\n');
}

/** The panel's dark theme, for the clients that honour `prefers-color-scheme`. */
const DARK = `
    .st-page { background:#09090c !important; }
    .st-card { background:#111116 !important; border-color:#24242d !important; }
    .st-h1, .st-ink { color:#f2f2f5 !important; }
    .st-p { color:#c4c4d0 !important; }
    .st-muted, .st-foot { color:#9494a3 !important; }
    .st-link { color:#a5a0ff !important; }
    .st-tile { background:#1e1a4a !important; }
    .st-tile-alert { background:#3a1418 !important; }
    .st-facts { background:#18181f !important; border-color:#24242d !important; }
    .st-rule-cell { border-color:#2a2a34 !important; }
    .st-rule { background:#24242d !important; }
    .st-code { background:#1e1a4a !important; border-color:#3a3480 !important; color:#c9c5ff !important; }
    .st-chip, .st-bubble-customer { background:#1c1c24 !important; }
    .st-bubble-bot { background:#2a1328 !important; }
    .st-bubble-note { background:#2b2110 !important; border-color:#4a3a1a !important; }
    .st-note-meta { color:#e8c06a !important; }
    .st-callout { background:#2b2110 !important; color:#f5deb0 !important; }`;

function renderHtml(content: EmailContent): string {
  return `<!doctype html>
<html lang="${content.locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>body,table,td,p,a,h1,span,strong{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:separate; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a { color:${C.brandText}; }
  @media (max-width:620px) {
    .st-container { width:100% !important; }
    .st-outer { padding:16px 8px 28px !important; }
    .st-pad { padding-left:24px !important; padding-right:24px !important; }
    .st-h1 { font-size:22px !important; line-height:30px !important; }
    .st-bubble { width:92% !important; }
  }
  @media (prefers-color-scheme: dark) {${DARK}
  }
</style>
</head>
<body class="st-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${escapeHtml(content.preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>
<table ${TABLE} class="st-page" width="100%" bgcolor="${C.page}" style="background:${C.page};">
<tr><td class="st-outer" align="center" style="padding:40px 12px 48px;">
<table ${TABLE} class="st-container" width="600" style="width:600px;max-width:600px;">
<tr><td>
<table ${TABLE} class="st-card" width="100%" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:16px;box-shadow:0 1px 2px rgba(20,20,40,0.04),0 16px 40px -12px rgba(20,20,40,0.16);">
${headerHtml(content)}
<tr><td class="st-pad" style="padding:36px 40px 30px;font-family:${FONT};">
${iconHtml(content)}
<h1 class="st-h1" style="margin:0 0 18px;font-family:${FONT};font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:${C.ink};">${escapeHtml(content.heading)}</h1>
${bodyHtml(content.blocks)}
</td></tr>
</table>
</td></tr>
<tr><td class="st-pad" align="center" style="padding:26px 40px 0;font-family:${FONT};text-align:center;">
${footerHtml(content.footer)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// --- Plain text --------------------------------------------------------------

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'note':
    case 'callout':
    case 'verbatim':
      return block.text;
    case 'button':
      // The URL alone on its line: clients link it, and tests read it out.
      return `${block.label}:\n${block.url}`;
    case 'link':
      return `${block.label}:\n${block.url}`;
    case 'code':
      // One line: what it is and the value, easy to read out and to copy.
      return `${block.label}: ${block.value}`;
    case 'facts':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'transcript':
      return [
        block.date,
        '',
        ...block.entries.map((entry) =>
          entry.role === 'system'
            ? `[${entry.time}] — ${entry.text}`
            : `[${entry.time}] ${entry.who}: ${entry.text}`,
        ),
      ].join('\n');
  }
}

function renderText(content: EmailContent): string {
  const parts = [
    ...(content.eyebrow ? [content.eyebrow] : []),
    content.heading,
    ...content.blocks.map(blockText),
    '—',
    ...content.footer,
  ];
  return parts.join('\n\n');
}

export function renderEmail(content: EmailContent): RenderedEmail {
  return {
    subject: content.subject,
    body: renderText(content),
    html: renderHtml(content),
    locale: content.locale,
  };
}
