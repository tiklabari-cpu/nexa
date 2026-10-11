/**
 * The one look every SiyahTuş e-mail shares (tm 265).
 *
 * A message is described once, as content blocks (a paragraph, a button, a
 * code, a transcript…), and rendered twice: as the HTML a modern client shows
 * and as the plain text every client can show — the two halves of the
 * `multipart/alternative` `mime.ts` writes. Rendering both from the same blocks
 * is what keeps them saying the same thing; a hand-written text twin drifts.
 *
 * The HTML is written for e-mail clients, not browsers:
 *
 * - **Tables and inline styles.** Outlook on Windows renders with Word and
 *   ignores most CSS; Gmail strips `<style>` in some views. Layout is a
 *   600-pixel table, every style that matters is inline, and the `<style>`
 *   block only adds what degrades gracefully (dark mode, small screens).
 * - **A button that is a link.** The call to action is an `<a>` inside a
 *   coloured cell, so it stays a link in every client — and the same URL is
 *   repeated as text under it, for clients (and people) that do not trust
 *   buttons.
 * - **A preheader.** The hidden first line inbox lists show after the subject.
 * - **Dark mode.** `color-scheme` plus `prefers-color-scheme` overrides, so
 *   Apple Mail and Outlook for Mac switch cleanly instead of half-inverting.
 * - **No images.** The mark is drawn with a table cell, so nothing is blocked,
 *   nothing is tracked and nothing has to be hosted.
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
  | { type: 'transcript'; date: string; entries: readonly TranscriptEntry[] }
  /** Text someone else wrote (a workspace's ticket template) — kept verbatim, line breaks and all. */
  | { type: 'verbatim'; text: string };

export interface EmailContent {
  locale: MailLocale;
  subject: string;
  /** The inbox-list snippet after the subject. One sentence. */
  preheader: string;
  /** Who it is from, above the heading — a workspace name, or omitted for account mail. */
  eyebrow?: string;
  heading: string;
  blocks: readonly EmailBlock[];
  /** Why the reader got this, and where it came from — small print at the bottom. */
  footer: readonly string[];
  /** The panel's address, linked from the mark; empty for no link. */
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

const C = {
  page: '#f2f3f5',
  card: '#ffffff',
  border: '#e3e6eb',
  ink: '#111318',
  body: '#3a404b',
  muted: '#6b7280',
  faint: '#9aa1ad',
  brand: '#111318',
  brandInk: '#ffffff',
  codeBg: '#f5f6f8',
  agentBg: '#f0f4ff',
  noteBg: '#fff8e6',
  link: '#2f54eb',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

// --- HTML ----------------------------------------------------------------------

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:${C.body};">${multiline(block.text)}</p>`;

    case 'note':
      return `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:${C.muted};">${multiline(block.text)}</p>`;

    case 'button': {
      const url = safeUrl(block.url);
      if (!url) return blockHtml({ type: 'paragraph', text: block.url });
      const href = escapeHtml(url);
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr><td class="st-button" bgcolor="${C.brand}" style="border-radius:8px;background:${C.brand};">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${C.brandInk};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>
</td></tr></table>
<p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${C.muted};">${escapeHtml(block.fallback)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" target="_blank" rel="noopener" style="color:${C.link};text-decoration:underline;">${escapeHtml(url)}</a></p>`;
    }

    case 'link': {
      const url = safeUrl(block.url);
      if (!url) return blockHtml({ type: 'paragraph', text: `${block.label} ${block.url}` });
      return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${C.body};"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${C.link};text-decoration:underline;">${escapeHtml(block.label)}</a></p>`;
    }

    case 'code':
      return `<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:${C.muted};">${escapeHtml(block.label)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
<tr><td class="st-code" style="background:${C.codeBg};border:1px solid ${C.border};border-radius:8px;padding:14px 22px;font-family:${MONO};font-size:22px;font-weight:600;letter-spacing:3px;color:${C.ink};">${escapeHtml(block.value)}</td></tr></table>`;

    case 'facts':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-top:1px solid ${C.border};">
${block.rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.border};font-size:14px;line-height:20px;color:${C.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid ${C.border};font-size:14px;line-height:20px;color:${C.ink};vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td></tr>`,
  )
  .join('\n')}
</table>`;

    case 'verbatim':
      return `<div style="margin:0 0 16px;font-size:16px;line-height:26px;color:${C.body};">${multiline(block.text)}</div>`;

    case 'transcript':
      return `<p style="margin:0 0 12px;font-size:13px;line-height:20px;color:${C.muted};text-transform:uppercase;letter-spacing:0.6px;">${escapeHtml(block.date)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
${block.entries.map(transcriptRowHtml).join('\n')}
</table>`;
  }
}

function transcriptRowHtml(entry: TranscriptEntry): string {
  if (entry.role === 'system') {
    return `<tr><td colspan="2" style="padding:6px 0;font-size:13px;line-height:18px;color:${C.faint};text-align:center;">${escapeHtml(entry.text)} · ${escapeHtml(entry.time)}</td></tr>`;
  }
  const background =
    entry.role === 'customer' ? C.codeBg : entry.role === 'note' ? C.noteBg : C.agentBg;
  return `<tr><td style="padding:0 0 10px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="st-bubble-${entry.role}" style="background:${background};border-radius:10px;padding:10px 14px;">
<p style="margin:0 0 4px;font-size:13px;line-height:18px;color:${C.muted};"><strong style="color:${C.ink};font-weight:600;">${escapeHtml(entry.who)}</strong> · ${escapeHtml(entry.time)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${C.body};">${multiline(entry.text)}</p>
</td></tr></table>
</td></tr>`;
}

function renderHtml(content: EmailContent): string {
  const home = safeUrl(content.homeUrl);
  const mark = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="st-mark" bgcolor="${C.brand}" width="28" height="28" style="width:28px;height:28px;border-radius:7px;background:${C.brand};text-align:center;vertical-align:middle;font-family:${FONT};font-size:15px;font-weight:700;line-height:28px;color:${C.brandInk};">S</td>
<td style="padding-left:10px;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.2px;color:${C.ink};" class="st-ink">SiyahTuş</td>
</tr></table>`;
  const brand = home
    ? `<a href="${escapeHtml(home)}" target="_blank" rel="noopener" style="text-decoration:none;">${mark}</a>`
    : mark;

  return `<!doctype html>
<html lang="${content.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:${C.link}; }
  @media (max-width:620px) {
    .st-container { width:100% !important; }
    .st-pad { padding-left:24px !important; padding-right:24px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .st-page { background:#0f1115 !important; }
    .st-card { background:#181b21 !important; border-color:#2a2f38 !important; }
    .st-ink, h1 { color:#f2f4f7 !important; }
    p, td { color:#c9ced8 !important; }
    .st-mark, .st-button { background:#f2f4f7 !important; color:#111318 !important; }
    .st-button a { color:#111318 !important; }
    .st-code, .st-bubble-customer { background:#22262e !important; color:#f2f4f7 !important; border-color:#2a2f38 !important; }
    .st-bubble-agent, .st-bubble-bot { background:#1d2433 !important; }
    .st-bubble-note { background:#2e2817 !important; }
  }
</style>
</head>
<body class="st-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${escapeHtml(content.preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>
<table role="presentation" class="st-page" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="st-container" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
<tr><td class="st-pad" style="padding:0 8px 20px;">${brand}</td></tr>
<tr><td>
<table role="presentation" class="st-card" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;">
<tr><td class="st-pad" style="padding:40px 44px 24px;font-family:${FONT};">
${content.eyebrow ? `<p style="margin:0 0 8px;font-size:13px;line-height:18px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.6px;">${escapeHtml(content.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:${C.ink};">${escapeHtml(content.heading)}</h1>
${content.blocks.map(blockHtml).join('\n')}
</td></tr>
</table>
</td></tr>
<tr><td class="st-pad" style="padding:20px 28px 0;font-family:${FONT};">
${content.footer
  .map(
    (line) =>
      `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${C.faint};">${escapeHtml(line)}</p>`,
  )
  .join('\n')}
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
