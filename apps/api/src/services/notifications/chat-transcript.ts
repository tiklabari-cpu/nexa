/**
 * The end-of-chat transcript e-mail (FR-MOD-08.7.4) — the *decisions*, apart
 * from the effect.
 *
 * When a conversation ends a copy of it is mailed out: to the visitor, so they
 * keep a record of what was said, and to the human who handled it, so the team
 * has one too. Whether either copy goes, and what each one contains, is a set of
 * small rules — is there an address to reach, has the agent kept e-mail on, does
 * an internal note belong in the customer's copy — and they live here, as pure
 * functions, for the same reason `assignee-email`'s guard does: the interesting
 * cases are the negatives (a visitor with no e-mail, an AI-only chat with no
 * assignee, an agent who opted out), and a pure function is the only way to test
 * them without a mailer and a database.
 *
 * The one invariant the whole service protects — an internal note never reaches
 * a customer — is protected here too: the customer's copy is rendered from the
 * `all`-recipient events only, exactly as the live read filters them.
 */

import type { MailLocale, RenderedEmail, TranscriptRole } from '../mail/templates/layout.js';
import {
  customerTranscriptMail,
  teamTranscriptMail,
  type TranscriptMessage,
} from '../mail/templates/messages.js';

/** Which party a transcript is addressed to. */
export type TranscriptParty = 'customer' | 'team';

export interface TranscriptParticipants {
  /**
   * The human who handled the chat, or null when nobody did (it was queued or
   * answered only by the AI) — then there is no team copy to send.
   */
  assignee: { email: string | null; name: string | null; emailEnabled: boolean } | null;
  /**
   * The workspace's forwarding addresses (WG-06 · tm 345,
   * `inbox_settings.transcript_forward_to`) and whether they get the team's
   * copy — which the settings only allow at the workspace's verified domains.
   */
  forward: { to: readonly string[]; includeNotes: boolean };
}

export interface TranscriptRecipient {
  party: TranscriptParty;
  to: string;
  name: string | null;
  /** `assignee` — the agent's own copy; `forward` — one of the workspace's addresses. */
  via: 'assignee' | 'forward';
}

/**
 * Who receives a transcript when a chat ends.
 *
 * Never the player (K26 · tm 345): the player asks for their copy from the
 * widget (`POST /customer/chat/transcript`), so an address someone typed into
 * a pre-chat form is not mailed a conversation unasked. The conversation's
 * own record — its events, the archive, the timeline — is untouched by this;
 * only the outgoing mail stopped.
 *
 * The team copy goes to the assignee, honouring the per-user, per-license
 * e-mail opt-out (FR-MOD-08.2) — an agent who silenced the channel for new
 * messages does not want a transcript in their inbox either — and only when
 * there was a human assignee at all. Each forwarding address gets its own
 * copy: the player's, or the team's when the workspace includes notes. An
 * address already on the list (the assignee's, a repeat) is mailed once.
 */
export function transcriptRecipients(p: TranscriptParticipants): TranscriptRecipient[] {
  const recipients: TranscriptRecipient[] = [];
  const seen = new Set<string>();

  if (p.assignee && p.assignee.emailEnabled && hasAddress(p.assignee.email)) {
    recipients.push({
      party: 'team',
      to: p.assignee.email,
      name: p.assignee.name,
      via: 'assignee',
    });
    seen.add(p.assignee.email.toLowerCase());
  }

  for (const to of p.forward.to) {
    if (!hasAddress(to) || seen.has(to.toLowerCase())) continue;
    seen.add(to.toLowerCase());
    recipients.push({
      party: p.forward.includeNotes ? 'team' : 'customer',
      to,
      name: null,
      via: 'forward',
    });
  }

  return recipients;
}

function hasAddress(email: string | null): email is string {
  return typeof email === 'string' && email.length > 0;
}

export interface TranscriptLine {
  /** 'agent' | 'customer' | 'bot' | 'system'; kept wide to tolerate new kinds. */
  authorType: string;
  /** Resolved display name for an agent author; null when unknown or n/a. */
  authorName: string | null;
  text: string | null;
  type: string;
  /** 'all' reaches the customer; 'agents' is an internal note. */
  recipients: string;
  createdAt: Date;
  /**
   * The name of the file the line carried, when it carried one (AR-04 · tm
   * 338). Only the name: a link would outlive its signature and leave the
   * workspace with the copy.
   */
  attachmentName?: string | null;
}

/**
 * What the transcript is framed with (tm 265): the workspace it came from, the
 * time zone its times are read in, and the reader's language.
 */
export interface TranscriptFrame {
  workspaceName: string;
  /** IANA name — the workspace's own (`organizations.timezone`). */
  timeZone: string;
  locale: MailLocale;
}

/**
 * Render the transcript for one audience, or null when there is nothing worth
 * sending it.
 *
 * The customer's copy is built from the `all`-recipient lines only — an internal
 * note must never leave the team. Either copy is skipped when it would carry no
 * actual conversation (a chat that only ever produced system events), so a chat
 * that opened and closed without a word does not spam two mailboxes.
 *
 * Since tm 265 the result is the full message — subject, plain text and HTML —
 * from the shared templates; in the team's copy an internal note is marked as
 * one rather than left to look like something the visitor saw.
 */
export function renderTranscript(opts: {
  audience: TranscriptParty;
  chatId: string;
  customerName: string | null;
  lines: TranscriptLine[];
  frame: TranscriptFrame;
}): RenderedEmail | null {
  const visible = visibleLines(opts.audience, opts.lines);

  // A transcript of nothing but "chat opened / chat closed" is noise; require at
  // least one real message before mailing anyone.
  if (!visible.some((line) => line.authorType !== 'system')) return null;

  const tr = opts.frame.locale === 'tr';
  const messages = transcriptMessages({
    audience: opts.audience,
    customerName: opts.customerName,
    lines: visible,
    locale: opts.frame.locale,
  });

  if (opts.audience === 'customer') {
    // A visitor gets no link to the agent panel: nothing there is theirs.
    return customerTranscriptMail(
      { locale: opts.frame.locale },
      {
        workspaceName: opts.frame.workspaceName,
        chatId: opts.chatId,
        timeZone: opts.frame.timeZone,
        messages,
      },
    );
  }
  return teamTranscriptMail(
    { locale: opts.frame.locale },
    {
      workspaceName: opts.frame.workspaceName,
      customerName: opts.customerName ?? (tr ? 'Ziyaretçi' : 'Visitor'),
      chatId: opts.chatId,
      timeZone: opts.frame.timeZone,
      messages,
    },
  );
}

/** The lines one audience may read: the customer's copy is the `all`-recipient ones. */
export function visibleLines(audience: TranscriptParty, lines: TranscriptLine[]): TranscriptLine[] {
  return audience === 'customer' ? lines.filter((line) => line.recipients === 'all') : lines;
}

/**
 * The lines as the templates show them — who, in which role, saying what —
 * for one audience. Shared by the closing mail and the on-demand copies
 * (AR-04 · tm 338), so the two cannot word a line differently. `fileNote`
 * adds "open it in the panel" after a file's name, for the copies the team
 * keeps; a player has no panel to open it in.
 */
export function transcriptMessages(opts: {
  audience: TranscriptParty;
  customerName: string | null;
  lines: TranscriptLine[];
  locale: MailLocale;
  fileNote?: boolean;
}): TranscriptMessage[] {
  const tr = opts.locale === 'tr';
  return visibleLines(opts.audience, opts.lines).map((line) => ({
    role: roleOf(line, opts.audience),
    who: authorLabel(line, opts.customerName, tr),
    text: lineText(line, tr, opts.fileNote === true),
    at: line.createdAt,
  }));
}

function lineText(line: TranscriptLine, tr: boolean, fileNote: boolean): string {
  const text = line.text?.trim() ? line.text.trim() : null;
  const name = line.attachmentName?.trim() ? line.attachmentName.trim() : null;
  if (name === null) return text ?? systemText(line.type, tr);
  const note = fileNote ? (tr ? ' — panelde görüntüleyin' : ' — open it in the panel') : '';
  const file = tr ? `(dosya: ${name}${note})` : `(file: ${name}${note})`;
  return text === null ? file : `${text}\n${file}`;
}

function roleOf(line: TranscriptLine, audience: TranscriptParty): TranscriptRole {
  if (line.authorType === 'system') return 'system';
  if (audience === 'team' && line.recipients !== 'all') return 'note';
  if (line.authorType === 'customer') return 'customer';
  if (line.authorType === 'bot') return 'bot';
  return 'agent';
}

/** A line with no text — a file, a rich message, a system event — named by its kind. */
function systemText(type: string, tr: boolean): string {
  if (type === 'file') return tr ? '(dosya gönderildi)' : '(sent a file)';
  return tr ? `(${type})` : `(${type})`;
}

function authorLabel(line: TranscriptLine, customerName: string | null, tr: boolean): string {
  const base = (() => {
    switch (line.authorType) {
      case 'customer':
        return customerName ?? (tr ? 'Ziyaretçi' : 'Visitor');
      case 'agent':
        return line.authorName ?? (tr ? 'Temsilci' : 'Agent');
      case 'bot':
        return line.authorName ?? (tr ? 'Yapay zekâ asistanı' : 'AI Agent');
      case 'system':
        return tr ? 'Sistem' : 'System';
      default:
        return line.authorName ?? (tr ? 'Bilinmiyor' : 'Unknown');
    }
  })();
  // An internal note is the team's alone; say so where it is shown.
  return line.recipients !== 'all' && line.authorType !== 'system'
    ? `${base} · ${tr ? 'dahili not' : 'internal note'}`
    : base;
}
