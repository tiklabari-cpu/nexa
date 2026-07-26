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

/** Which party a transcript is addressed to. */
export type TranscriptParty = 'customer' | 'team';

export interface TranscriptParticipants {
  /** The visitor. `email` is null when we never captured one — nobody to write to. */
  customer: { email: string | null; name: string | null };
  /**
   * The human who handled the chat, or null when nobody did (it was queued or
   * answered only by the AI) — then there is no team copy to send.
   */
  assignee: { email: string | null; name: string | null; emailEnabled: boolean } | null;
}

export interface TranscriptRecipient {
  party: TranscriptParty;
  to: string;
  name: string | null;
}

/**
 * Who receives a transcript when a chat ends.
 *
 * The visitor gets their conversation whenever we can reach them. The team copy
 * goes to the assignee, honouring the per-user, per-license e-mail opt-out
 * (FR-MOD-08.2) — an agent who silenced the channel for new messages does not
 * want a transcript in their inbox either — and only when there was a human
 * assignee at all.
 */
export function transcriptRecipients(p: TranscriptParticipants): TranscriptRecipient[] {
  const recipients: TranscriptRecipient[] = [];

  if (hasAddress(p.customer.email)) {
    recipients.push({ party: 'customer', to: p.customer.email, name: p.customer.name });
  }

  if (p.assignee && p.assignee.emailEnabled && hasAddress(p.assignee.email)) {
    recipients.push({ party: 'team', to: p.assignee.email, name: p.assignee.name });
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
}

export interface TranscriptContent {
  subject: string;
  body: string;
}

/**
 * Render the transcript for one audience, or null when there is nothing worth
 * sending it.
 *
 * The customer's copy is built from the `all`-recipient lines only — an internal
 * note must never leave the team. Either copy is skipped when it would carry no
 * actual conversation (a chat that only ever produced system events), so a chat
 * that opened and closed without a word does not spam two mailboxes.
 */
export function renderTranscript(opts: {
  audience: TranscriptParty;
  chatId: string;
  customerName: string | null;
  lines: TranscriptLine[];
}): TranscriptContent | null {
  const visible =
    opts.audience === 'customer'
      ? opts.lines.filter((line) => line.recipients === 'all')
      : opts.lines;

  // A transcript of nothing but "chat opened / chat closed" is noise; require at
  // least one real message before mailing anyone.
  if (!visible.some((line) => line.authorType !== 'system')) return null;

  const who = opts.customerName ?? 'Visitor';
  const rendered = visible.map((line) => formatLine(line, opts.customerName)).join('\n');

  if (opts.audience === 'customer') {
    return {
      subject: `Your chat transcript (${opts.chatId})`,
      body: `Here is a copy of your conversation (${opts.chatId}):\n\n${rendered}\n`,
    };
  }

  return {
    subject: `Chat transcript — ${who} (${opts.chatId})`,
    body: `Transcript of the conversation with ${who} (${opts.chatId}):\n\n${rendered}\n`,
  };
}

function formatLine(line: TranscriptLine, customerName: string | null): string {
  const content = line.text?.trim() ? line.text.trim() : `(${line.type})`;
  return `[${line.createdAt.toISOString()}] ${authorLabel(line, customerName)}: ${content}`;
}

function authorLabel(line: TranscriptLine, customerName: string | null): string {
  switch (line.authorType) {
    case 'customer':
      return customerName ?? 'Visitor';
    case 'agent':
      return line.authorName ?? 'Agent';
    case 'bot':
      return line.authorName ?? 'AI Agent';
    case 'system':
      return 'System';
    default:
      return line.authorName ?? 'Unknown';
  }
}
