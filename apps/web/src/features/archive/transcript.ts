/**
 * A connection's transcript on demand (AR-04 · tm 338): the addresses the
 * archive's actions call, and the printable page read back into data.
 *
 * The page is the server's `format=html` file — the one a download would
 * save — so what is printed and what is audited are the same bytes. It is
 * not mounted as HTML: its header, day headings and lines are read out of it
 * with `textContent` and drawn by React, which escapes them again. Only its
 * stylesheet (CSS, no markup) is used as it came.
 */
import type { TranscriptAudience } from '@siyahtus/types';

export function transcriptPath(chatId: string, threadId: string): string {
  return `/chats/${encodeURIComponent(chatId)}/threads/${encodeURIComponent(threadId)}/transcript`;
}

/** The download: plain text or the printable page, one copy. */
export function transcriptFileUrl(
  chatId: string,
  threadId: string,
  format: 'txt' | 'html',
  audience: TranscriptAudience,
): string {
  const params = new URLSearchParams({ format, audience });
  return `${transcriptPath(chatId, threadId)}?${params.toString()}`;
}

/** The panel's print page for one connection and copy (outside the shell). */
export function transcriptPrintAddress(
  chatId: string,
  threadId: string,
  audience: TranscriptAudience,
): string {
  const params = new URLSearchParams({ thread: threadId, copy: audience });
  return `/app/archive/${encodeURIComponent(chatId)}/print?${params.toString()}`;
}

export interface TranscriptPageLine {
  /** `customer` · `agent` · `bot` · `system` · `note`. */
  role: string;
  time: string;
  who: string;
  /** One entry a line of the message. */
  text: string[];
}

export interface TranscriptPage {
  lang: string;
  title: string;
  style: string;
  rows: Array<[string, string]>;
  days: Array<{ heading: string; lines: TranscriptPageLine[] }>;
  empty: string | null;
  zone: string;
}

const ROLES = new Set(['customer', 'agent', 'bot', 'system', 'note']);

/** The server's printable page as data, or null when it is not one. */
export function parseTranscriptPage(html: string): TranscriptPage | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main.transcript');
  if (!main) return null;
  const text = (element: Element | null): string => element?.textContent?.trim() ?? '';

  const rows: Array<[string, string]> = [];
  for (const dt of Array.from(main.querySelectorAll('dl > dt'))) {
    const dd = dt.nextElementSibling;
    rows.push([text(dt), dd?.tagName === 'DD' ? text(dd) : '']);
  }

  const days = Array.from(main.querySelectorAll('section')).map((section) => ({
    heading: text(section.querySelector('h2')),
    lines: Array.from(section.querySelectorAll('li.line')).map((li) => {
      const role = Array.from(li.classList).find((name) => ROLES.has(name)) ?? 'agent';
      return {
        role,
        time: text(li.querySelector('.time')),
        who: text(li.querySelector('.who')),
        text: messageLines(li.querySelector('.text')),
      };
    }),
  }));

  return {
    lang: doc.documentElement.lang || 'en',
    title: text(main.querySelector('h1')),
    style: doc.querySelector('style')?.textContent ?? '',
    rows,
    days,
    empty: main.querySelector('.empty') ? text(main.querySelector('.empty')) : null,
    zone: text(main.querySelector('.zone')),
  };
}

/** A message's text, split where the page broke it (`<br>`). */
function messageLines(element: Element | null): string[] {
  if (!element) return [];
  const lines: string[] = [''];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeName === 'BR') lines.push('');
    else lines[lines.length - 1] += node.textContent ?? '';
  }
  return lines;
}
