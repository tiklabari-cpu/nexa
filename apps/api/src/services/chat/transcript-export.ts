/**
 * A connection's transcript, on demand (AR-04 · tm 338): the text download,
 * the printable page and the mail to an allowed address.
 *
 * The closing mail (`chat-service` `#emailTranscript`) already sends a copy
 * when a conversation ends; this is the same conversation, asked for later —
 * for a player's complaint, a regulator's request, the finance team. The line
 * wording is shared (`transcriptMessages`), so a line reads the same in the
 * closing mail, the download and the page; the mailed copy *is* the closing
 * template (`renderTranscript`).
 *
 * Who may (AR-04-S1, the permission matrix's `transcripts.export`, inside the
 * chat's own visibility):
 *
 *   - `own` — a connection the person was assigned, wrote on or joined;
 *   - `team` — that, or one routed to a team of theirs (the connection's own
 *     team, or for one opened before that was recorded, its day's);
 *   - `all` — every connection the person may see.
 *
 * Below the row, anyone who may see a connection they were on may mail the
 * player's copy to the player's own address — the closing mail's recipient,
 * asked for again (AR-04-S1). A chat outside the visibility, or a connection
 * of another chat, is a 404 either way.
 *
 * The copies (AR-04-S2): the player's leaves out every internal note, the
 * team's marks them as notes; only the player's is ever mailed. The
 * recipients (AR-04-S3): the player's registered address and the domains the
 * workspace allows (`inbox_settings.transcript_allowed_domains`). A file is
 * named, never linked — a signed link outlives its signature in someone's
 * mailbox. The stored text is already masked (card numbers), and every
 * masking added later reaches these copies on its own.
 */
import {
  TRANSCRIPT_EXPORTS_PER_MINUTE,
  emailDomain,
  type CapabilityValue,
  type TranscriptAudience,
  type TranscriptExportFormat,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { requireCapability } from '../auth/capability.js';
import type { Principal } from '../auth/principal.js';
import { REDACTED, redactPlayerContact, seesPlayerContact } from '../customers/player-contact.js';
import type { MailLocale } from '../mail/templates/layout.js';
import { formatDateTime, formatDay, formatTime, zoneSentence } from '../mail/templates/messages.js';
import {
  transcriptMessages,
  type TranscriptLine,
  type TranscriptParty,
} from '../notifications/chat-transcript.js';
import { canSeeChat, resolveVisibility } from './access.js';

/** Events read per page while a file streams. */
const PAGE = 500;

const LEVELS = new Set<CapabilityValue>(['none', 'own', 'team', 'all']);

interface EventRow {
  id: string;
  authorType: string;
  authorId: string | null;
  text: string | null;
  type: string;
  recipients: string;
  attachmentUrl: string | null;
  createdAt: Date;
}

/** What an export needs of the connection, loaded once when it is opened. */
export interface TranscriptScope {
  chatId: string;
  threadId: string;
  /** The brand the member came in through; null = the workspace's default. */
  brandId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  assigneeId: string | null;
  customer: {
    name: string | null;
    email: string | null;
    username: string | null;
    locale: string | null;
  };
  /** The caller was assigned the connection, wrote on it or joined the chat. */
  own: boolean;
  /** `transcripts.export` reaches this connection. */
  exportReach: boolean;
  /** The caller's `transcripts.export` level. */
  level: 'none' | 'own' | 'team' | 'all';
  /** Whether the caller may see the player's email and username. */
  contactVisible: boolean;
}

/** The caller's `transcripts.export` level; an unknown value reads as `none`. */
export function transcriptExportLevel(principal: Principal): TranscriptScope['level'] {
  if (principal.kind !== 'agent') return 'none';
  const value = principal.capabilities['transcripts.export'];
  return value !== undefined && LEVELS.has(value) ? (value as TranscriptScope['level']) : 'none';
}

/**
 * Open connection `threadId` of chat `chatId` for `principal`: the chat's
 * visibility and the connection's belonging (a 404 for either), then where
 * the caller stands — whether it is their own, whether the matrix row reaches it.
 */
export async function openTranscript(
  tx: TenantClient,
  principal: Principal,
  chatId: string,
  threadId: string,
): Promise<TranscriptScope> {
  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      customerId: true,
      brandId: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
      customer: { select: { name: true, email: true, username: true, locale: true } },
    },
  });
  if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
  const thread = await tx.thread.findFirst({
    where: { id: threadId, chatId },
    select: {
      id: true,
      createdAt: true,
      closedAt: true,
      assigneeId: true,
      agentIds: true,
      groupId: true,
    },
  });
  if (!thread) throw ApiError.notFound('Thread not found.');

  const me = principal.kind === 'agent' ? principal.accountId.toLowerCase() : null;
  const own =
    me !== null &&
    (thread.assigneeId?.toLowerCase() === me ||
      thread.agentIds.some((id) => id.toLowerCase() === me) ||
      chat.users.some((u) => u.userType === 'agent' && u.userId.toLowerCase() === me));

  const level = transcriptExportLevel(principal);
  let exportReach = level === 'all' || ((level === 'own' || level === 'team') && own);
  if (!exportReach && level === 'team' && principal.kind === 'agent') {
    // Read now, as the chat visibility reads them: leaving a team narrows at once.
    const memberships = await tx.groupAgent.findMany({
      where: { agentId: principal.accountId },
      select: { groupId: true },
    });
    const teams = new Set(memberships.map((m) => String(m.groupId)));
    exportReach =
      thread.groupId !== null
        ? teams.has(String(thread.groupId))
        : chat.access.some((a) => teams.has(String(a.groupId)));
  }

  return {
    chatId: chat.id,
    threadId: thread.id,
    brandId: chat.brandId,
    startedAt: thread.createdAt,
    endedAt: thread.closedAt,
    assigneeId: thread.assigneeId,
    customer: chat.customer,
    own,
    exportReach,
    level,
    contactVisible: seesPlayerContact(principal),
  };
}

/**
 * The download's gate: the row first — before the chat is read, so the
 * refusal says nothing about whether it exists — then its reach (a 404
 * outside it, as for a chat the caller cannot see).
 */
export function requireTranscriptExportRow(principal: Principal): void {
  requireCapability(principal, 'transcripts.export');
}

export function requireTranscriptExportReach(scope: TranscriptScope): void {
  if (!scope.exportReach) throw ApiError.notFound('Chat not found.');
}

/**
 * Downloads, prints and mails, together, at most
 * {@link TRANSCRIPT_EXPORTS_PER_MINUTE} a person a minute — a script walking
 * the archive to copy it out stops here. A limiter that cannot answer lets
 * the export through (and is logged): the row and the audit still hold.
 */
export async function spendTranscriptExport(
  limiter: {
    consume(
      key: string,
      limit: number,
      windowMs: number,
    ): Promise<{ allowed: boolean; resetMs: number }>;
  },
  principal: Principal,
  onUnavailable: (error: unknown) => void,
): Promise<void> {
  const actor = principal.kind === 'agent' ? principal.accountId : 'other';
  let decision: { allowed: boolean; resetMs: number };
  try {
    decision = await limiter.consume(
      `rl:transcript:${principal.licenseId}:${actor}`,
      TRANSCRIPT_EXPORTS_PER_MINUTE,
      60_000,
    );
  } catch (error) {
    onUnavailable(error);
    return;
  }
  if (!decision.allowed) {
    throw ApiError.tooManyRequests(
      Math.max(1, Math.ceil(decision.resetMs / 1000)),
      'Too many transcript exports; try again in a moment.',
    );
  }
}

export interface TranscriptRecipient {
  to: string;
  /** The recipient is the player's registered address. */
  toPlayer: boolean;
  domain: string;
}

/**
 * Who a mailed copy may go to (AR-04-S1/S3), or the refusal. `to` absent is
 * the player's registered address — for a caller who may not see it.
 *
 *   - the player's own address: anyone the row reaches, and anyone on the
 *     connection (`own`) below it;
 *   - an address at an allowed domain: only where the row reaches;
 *   - anything else: `recipient_not_allowed`.
 *
 * A caller neither reached by the row nor on the connection is refused as the
 * download refuses them: a 403 at `none`, a 404 above it.
 */
export function transcriptRecipient(
  principal: Principal,
  scope: TranscriptScope,
  to: string | undefined,
  allowedDomains: readonly string[],
): TranscriptRecipient {
  if (!scope.exportReach && !scope.own) {
    requireTranscriptExportRow(principal);
    throw ApiError.notFound('Chat not found.');
  }
  const player = scope.customer.email?.trim() ? scope.customer.email.trim() : null;
  const address = to?.trim() ? to.trim() : player;
  if (address === null) {
    throw ApiError.validation('This player has no registered e-mail address.', {
      reason: 'no_player_address',
    });
  }
  const domain = emailDomain(address);
  if (domain === null) {
    throw ApiError.validation('to: not an e-mail address.', {
      fields: [{ field: 'to', message: 'not an e-mail address' }],
    });
  }
  const toPlayer = player !== null && address.toLowerCase() === player.toLowerCase();
  if (toPlayer) return { to: address, toPlayer, domain };
  if (!scope.exportReach) {
    throw new ApiError(
      'recipient_not_allowed',
      "Only the player's own address: your role mails the player's copy to the player.",
      { details: { reason: 'player_address_only' } },
    );
  }
  if (!allowedDomains.includes(domain)) {
    throw new ApiError(
      'recipient_not_allowed',
      "The address is neither the player's nor at one of the workspace's allowed domains.",
      { details: { reason: 'domain_not_allowed' } },
    );
  }
  return { to: address, toPlayer, domain };
}

/** The domains a transcript may go to, for the chat's brand (or the default brand's). */
export async function readTranscriptAllowedDomains(
  tx: TenantClient,
  brandId: string | null,
): Promise<string[]> {
  const row = await tx.inboxSettings.findFirst({
    where: brandId !== null ? { brandId } : { brand: { isDefault: true } },
    select: { transcriptAllowedDomains: true },
  });
  return row?.transcriptAllowedDomains ?? [];
}

export function partyOf(audience: TranscriptAudience): TranscriptParty {
  return audience === 'internal' ? 'team' : 'customer';
}

/** The file's frame: everything the header says, read before the first byte. */
export interface TranscriptHeader {
  workspaceName: string;
  timeZone: string;
  locale: MailLocale;
  audience: TranscriptAudience;
  chatId: string;
  threadId: string;
  /** The player as the file names them: username, else name — blanked without contact sight. */
  player: string;
  startedAt: Date;
  endedAt: Date | null;
  agents: string[];
  exportedBy: string;
  exportedAt: Date;
}

/**
 * Read the header of `scope`'s transcript: the workspace and its zone, the
 * agents who were on the connection (in the player's copy, only those the
 * player heard from), the player and who is exporting.
 */
export async function readTranscriptHeader(
  tx: TenantClient,
  principal: Principal,
  scope: TranscriptScope,
  opts: { audience: TranscriptAudience; locale: MailLocale; organizationId: string; now: Date },
): Promise<TranscriptHeader> {
  const organization = await tx.organization.findUnique({
    where: { id: opts.organizationId },
    select: { name: true, timezone: true },
  });
  const authors = await tx.event.findMany({
    where: {
      threadId: scope.threadId,
      authorType: 'agent',
      authorId: { not: null },
      ...(opts.audience === 'customer' ? { recipients: 'all' } : {}),
    },
    distinct: ['authorId'],
    select: { authorId: true },
  });
  const ids = [
    ...new Set(
      [
        ...(scope.assigneeId !== null ? [scope.assigneeId] : []),
        ...authors.map((a) => a.authorId as string),
      ].map((id) => id.toLowerCase()),
    ),
  ];
  const me = principal.kind === 'agent' ? principal.accountId : null;
  const accounts = await tx.account.findMany({
    where: { id: { in: me !== null ? [...ids, me] : ids } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(accounts.map((a) => [a.id.toLowerCase(), a.name]));
  const tr = opts.locale === 'tr';
  const player = scope.contactVisible
    ? (scope.customer.username ?? scope.customer.name ?? (tr ? 'Ziyaretçi' : 'Visitor'))
    : (scope.customer.name ?? REDACTED);
  return {
    workspaceName: organization?.name ?? 'SiyahTuş',
    timeZone: organization?.timezone ?? 'UTC',
    locale: opts.locale,
    audience: opts.audience,
    chatId: scope.chatId,
    threadId: scope.threadId,
    player,
    startedAt: scope.startedAt,
    endedAt: scope.endedAt,
    agents: ids.map((id) => nameOf.get(id) ?? (tr ? 'Temsilci' : 'Agent')),
    exportedBy:
      (me !== null ? nameOf.get(me.toLowerCase()) : null) ?? (tr ? 'Bilinmiyor' : 'Unknown'),
    exportedAt: opts.now,
  };
}

/**
 * The connection's lines for one audience, oldest first, a page at a time —
 * a long conversation never sits in memory whole. The player's copy is
 * filtered in SQL as well as by `transcriptMessages`, belt and braces for
 * the one invariant: an internal note never reaches the player.
 */
export async function* transcriptLines(
  read: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>,
  scope: TranscriptScope,
  audience: TranscriptAudience,
  pageSize: number = PAGE,
): AsyncGenerator<TranscriptLine[]> {
  let after: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const cursor: { createdAt: Date; id: string } | null = after;
    const rows: EventRow[] = await read((tx) =>
      tx.event.findMany({
        where: {
          threadId: scope.threadId,
          ...(audience === 'customer' ? { recipients: 'all' } : {}),
          ...(cursor !== null
            ? {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        select: {
          id: true,
          authorType: true,
          authorId: true,
          text: true,
          type: true,
          recipients: true,
          attachmentUrl: true,
          createdAt: true,
        },
      }),
    );
    if (rows.length === 0) return;
    const agentIds = [
      ...new Set(
        rows.filter((r) => r.authorType === 'agent' && r.authorId).map((r) => r.authorId as string),
      ),
    ];
    const accounts =
      agentIds.length > 0
        ? await read((tx) =>
            tx.account.findMany({
              where: { id: { in: agentIds } },
              select: { id: true, name: true },
            }),
          )
        : [];
    const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
    yield rows.map((r) => ({
      authorType: r.authorType,
      authorName: r.authorType === 'agent' && r.authorId ? (nameOf.get(r.authorId) ?? null) : null,
      // The player's email and username blanked for a caller who may not see
      // them, as every other read of the conversation does.
      text:
        r.text === null
          ? null
          : redactPlayerContact(
              r.text,
              [scope.customer.email, scope.customer.username],
              scope.contactVisible,
            ),
      type: r.type,
      recipients: r.recipients,
      createdAt: r.createdAt,
      attachmentName: attachmentNameOf(r.attachmentUrl),
    }));
    if (rows.length < pageSize) return;
    const last = rows[rows.length - 1]!;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

/** The name a file is shown by — the last segment of its upload path, as the panel shows it. */
export function attachmentNameOf(url: string | null): string | null {
  if (!url) return null;
  const segment = url.split('?')[0]!.split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return segment || null;
  }
}

export const TRANSCRIPT_CONTENT_TYPES: Record<TranscriptExportFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

export function transcriptFileName(
  scope: TranscriptScope,
  header: TranscriptHeader,
  format: TranscriptExportFormat,
): string {
  return `siyahtus-transcript-${scope.chatId}-${scope.threadId}-${header.audience}.${format}`;
}

/**
 * The file, streamed: the header, then the lines a page at a time, a day
 * heading wherever the workspace's calendar day changes.
 */
export async function* transcriptFile(
  format: TranscriptExportFormat,
  header: TranscriptHeader,
  pages: AsyncIterable<TranscriptLine[]>,
  customerName: string | null,
): AsyncGenerator<string> {
  const party = partyOf(header.audience);
  const { locale, timeZone } = header;
  const tr = locale === 'tr';
  yield format === 'txt' ? txtHead(header) : htmlHead(header);
  let day = '';
  let any = false;
  let openList = false;
  for await (const lines of pages) {
    const messages = transcriptMessages({
      audience: party,
      customerName,
      lines,
      locale,
      fileNote: true,
    });
    let out = '';
    for (const message of messages) {
      any = true;
      const today = formatDay(message.at, locale, timeZone);
      if (today !== day) {
        day = today;
        if (format === 'txt') out += `\n${today}\n${'-'.repeat(today.length)}\n`;
        else {
          if (openList) out += '</ol></section>\n';
          out += `<section><h2>${escapeHtml(today)}</h2><ol>\n`;
          openList = true;
        }
      }
      const time = formatTime(message.at, locale, timeZone);
      if (format === 'txt') {
        const [first, ...rest] = message.text.split('\n');
        out += `[${time}] ${message.who}: ${first ?? ''}\n`;
        for (const line of rest) out += `        ${line}\n`;
      } else {
        out +=
          `<li class="line ${message.role}"><span class="time">${escapeHtml(time)}</span>` +
          `<span class="who">${escapeHtml(message.who)}</span>` +
          `<p class="text">${escapeHtml(message.text).replace(/\n/g, '<br>')}</p></li>\n`;
      }
    }
    if (out !== '') yield out;
  }
  const empty = tr ? 'Bu bağlantıda mesaj yok.' : 'This connection has no messages.';
  if (format === 'txt') {
    yield `${any ? '' : `\n${empty}\n`}\n${zoneSentence(locale, timeZone)}\n`;
  } else {
    yield `${openList ? '</ol></section>\n' : ''}${any ? '' : `<p class="empty">${escapeHtml(empty)}</p>\n`}` +
      `<p class="zone">${escapeHtml(zoneSentence(locale, timeZone))}</p>\n</main>\n</body>\n</html>\n`;
  }
}

/** The header's rows, label then value, in the order both formats show them. */
function headerRows(h: TranscriptHeader): Array<[string, string]> {
  const tr = h.locale === 'tr';
  const at = (d: Date): string => formatDateTime(d, h.locale, h.timeZone);
  return [
    [tr ? 'Çalışma alanı' : 'Workspace', h.workspaceName],
    ['Thread ID (chat_id)', h.chatId],
    ['Chat ID (thread_id)', h.threadId],
    [tr ? 'Oyuncu' : 'Player', h.player],
    [tr ? 'Başlangıç' : 'Started', at(h.startedAt)],
    [tr ? 'Bitiş' : 'Ended', h.endedAt !== null ? at(h.endedAt) : tr ? 'Açık' : 'Open'],
    [tr ? 'Temsilciler' : 'Agents', h.agents.length > 0 ? h.agents.join(', ') : '—'],
    [tr ? 'Dışa aktaran' : 'Exported by', `${h.exportedBy} · ${at(h.exportedAt)}`],
  ];
}

function titleOf(h: TranscriptHeader): string {
  const tr = h.locale === 'tr';
  const copy =
    h.audience === 'internal'
      ? tr
        ? 'İç kopya (dahili notlar dahil)'
        : 'Internal copy (internal notes included)'
      : tr
        ? 'Oyuncu kopyası'
        : "Player's copy";
  return `${tr ? 'Sohbet dökümü' : 'Chat transcript'} — ${copy}`;
}

function txtHead(h: TranscriptHeader): string {
  const rows = headerRows(h);
  const width = Math.max(...rows.map(([label]) => label.length));
  const title = titleOf(h);
  return (
    `${title}\n${'='.repeat(title.length)}\n` +
    rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n') +
    '\n'
  );
}

/**
 * A page that prints as it reads: the system's own sans-serif (every one of
 * them draws ğ, ş, ı and İ — the reports' PDF writer cannot, AR-04), no
 * script, no image, nothing fetched.
 */
const PRINT_STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #111; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif; }
main.transcript { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
main.transcript h1 { font-size: 20px; margin: 0 0 16px; }
main.transcript dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 24px; font-size: 13px; }
main.transcript dt { color: #555; }
main.transcript dd { margin: 0; overflow-wrap: anywhere; }
main.transcript h2 { font-size: 14px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
main.transcript ol { list-style: none; margin: 0; padding: 0; }
main.transcript li.line { display: grid; grid-template-columns: 48px 1fr; gap: 0 12px; padding: 6px 0; break-inside: avoid; }
main.transcript .time { color: #555; font-variant-numeric: tabular-nums; grid-row: span 2; }
main.transcript .who { font-weight: 600; }
main.transcript .text { margin: 0; white-space: normal; overflow-wrap: anywhere; }
main.transcript li.note { background: #fff8e1; padding-left: 6px; border-left: 3px solid #f0b400; }
main.transcript li.system { color: #555; font-style: italic; }
main.transcript .zone, main.transcript .empty { color: #555; font-size: 12px; margin-top: 24px; }
@media print {
  @page { margin: 16mm; }
  main.transcript { max-width: none; padding: 0; }
  main.transcript h2 { break-after: avoid; }
}
`;

function htmlHead(h: TranscriptHeader): string {
  const title = titleOf(h);
  const rows = headerRows(h)
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  return (
    `<!doctype html>\n<html lang="${h.locale}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="robots" content="noindex">\n<title>${escapeHtml(title)} · ${escapeHtml(h.threadId)}</title>\n` +
    `<style>${PRINT_STYLE}</style>\n</head>\n<body>\n<main class="transcript">\n` +
    `<h1>${escapeHtml(title)}</h1>\n<dl>${rows}</dl>\n`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
