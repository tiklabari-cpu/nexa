/**
 * The context loader (tm 292.3 · SiyahTuş analysis AI-01 §1–§4, §8–§9).
 *
 * Before this, every message reached the model alone: the AI answered the
 * third message of a conversation as if it were the first. This file is what a
 * turn knows of the conversation it is in — the connection's transcript, read
 * once, mapped to the roles a model reads, cut to a budget — and the one place
 * the AI side reads the event model (05 §1.0.1: the AI reaches the ID model
 * through `loadConnectionEvents` and, with AI-02, `loadDailyDigests`; if the
 * mapping of connections changes, these change and nothing else).
 *
 * **What goes in.** The connection's `message` and `file` events, oldest first,
 * as `customer → user`, `bot → assistant` and `agent → assistant` behind an
 * `[Agent]` marker (a person said it, not the AI — AI-11's hand-back makes that
 * matter). A few system events — the connection opening, a transfer, a resume
 * — go in as short timed notes, not as messages. Consecutive messages of one
 * role are merged into one, a line apiece. An attachment is a placeholder
 * naming its kind, never its bytes. The text is the stored text, which the
 * customer route masked before it was written (AI-26); nothing here unmasks it.
 *
 * **What never goes in.** An internal note (`recipients = 'agents'`) — filtered
 * in SQL, so no code below could pass one on if it tried; the copilot's
 * output, which reaches a conversation only as a note or as an agent's own
 * message; any other connection's events, the day's other connections
 * included (that is AI-02's digest, not a transcript).
 *
 * **The budget.** The newest `maxMessages` events, plus the visitor's first
 * message when it fell outside them — the topic the conversation is about,
 * which a long exchange must not lose. No model summarises what was cut: what
 * the conversation has settled lives in its state (`slots`, the procedure
 * step) and goes in as the deterministic state digest. Over `maxChars`, the
 * oldest messages go first; the opening message is kept, shortened if it has
 * to be. Where messages were left out the transcript says so.
 *
 * **The query.** One statement over `events_thread_id_event_sequence_idx`,
 * walked backwards from the newest event, `LIMIT N+1` — the extra row says
 * whether anything older exists, and only then is the opening message looked
 * up, by the same index from the other end with a `bigint` bound, which row
 * level security lets ride into the index (the measurement is
 * `ChatService.listEvents`'s, which pages the same index). The window's own
 * bound on visitor messages is a row filter: it skips at most the messages the
 * visitor wrote after the one being answered.
 * `test/integration/ai-context-loader.test.ts` explains both statements.
 */
import { Prisma } from '@prisma/client';
import type { TenantClient } from '../../../lib/tenant.js';
import type { LlmMessage } from '../provider/llm-provider.js';
import type { ConnectionRef } from './state-store.js';
import type { TurnHistory, TurnState } from './turn.js';

/** How much of the transcript a turn carries (AI-01 §3). */
export interface HistoryBudget {
  /** Events read back from the newest (`AI_HISTORY_MAX_MESSAGES`). */
  readonly maxMessages: number;
  /** Characters across the earlier messages (`AI_HISTORY_MAX_CHARS`). */
  readonly maxChars: number;
}

/** 05 AI-01's suggested defaults; the env keys arrive with tm 292.5. */
export const DEFAULT_HISTORY_BUDGET: HistoryBudget = Object.freeze({
  maxMessages: 20,
  maxChars: 12_000,
});

/**
 * The system events a turn is told about. The rest are internal (a take-over
 * is `agents`-only, filtered anyway) or end the connection, after which no
 * turn runs.
 */
export const CONTEXT_SYSTEM_EVENTS: readonly string[] = [
  'connection_opened',
  'chat_transferred',
  'chat_resumed',
];

/** Written where earlier messages were left out. */
export const GAP_MARKER = '[… earlier messages not shown …]';

/** Put in front of an agent's message: a person wrote it, not the AI. */
export const AGENT_MARKER = '[Agent]';

/** One event of the connection, as the loader reads it. */
export interface ConnectionEvent {
  readonly sequence: number;
  readonly type: 'message' | 'file' | 'system_message';
  readonly authorType: string;
  readonly text: string | null;
  readonly attachmentUrl: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * The events a context is built from, oldest first, and where the budget left
 * some out: after the event with sequence `gapAfter` (0 — before the first),
 * or nowhere (null).
 */
export interface ConnectionEvents {
  readonly events: ConnectionEvent[];
  readonly gapAfter: number | null;
}

/**
 * What a turn knows of its conversation — 05 AI-01 §8's `TurnContext`, named
 * apart from the turn's own `TurnContext` (`turn.ts`).
 */
export interface ConnectionContext extends TurnHistory {
  /** The visitor's messages after `processedThrough`, merged: what the turn answers. */
  readonly newCustomerText: string;
  /** The newest event read; the turn covers the connection up to here. */
  readonly lastSeq: number;
}

export interface LoadConnectionOptions {
  /**
   * The newest visitor message the turn may see (inclusive). The live adapter
   * passes the message it answers, so a message that arrived while it was
   * being picked up is the next turn's, not a silent addition to this one.
   * Everybody else's events are read to the end of the connection: the answer
   * to an earlier message is written *after* the visitor wrote again whenever
   * they did not wait for it, and a turn that missed it would take that
   * earlier message for unanswered and answer it a second time.
   */
  readonly through: number;
  /**
   * The events up to here (inclusive) were answered by an earlier turn; the
   * visitor's messages after it are this turn's.
   */
  readonly processedThrough: number;
  readonly budget?: HistoryBudget;
}

/**
 * The connection's events a context is built from: the newest `maxMessages`,
 * and the visitor's opening message when it is older than those. Visitor
 * messages after `through` are not read (see {@link LoadConnectionOptions}).
 */
export async function loadConnectionEvents(
  tx: TenantClient,
  ref: ConnectionRef,
  options: { through: number; maxMessages: number },
): Promise<ConnectionEvents> {
  const { through, maxMessages } = options;
  // `chat_id` beside `thread_id`: a reference whose halves disagree reads
  // nothing, rather than the transcript of whichever half was right.
  const rows = await tx.$queryRaw<RawConnectionEvent[]>(Prisma.sql`
    SELECT event_sequence, type, author_type, text, attachment_url, properties, created_at
    FROM events
    WHERE thread_id = ${ref.threadId}
      AND chat_id = ${ref.chatId}
      AND (author_type <> 'customer' OR event_sequence <= ${through})
      AND recipients = 'all'
      AND (type IN ('message', 'file')
           OR (type = 'system_message'
               AND properties->>'system_event' IN (${Prisma.join([...CONTEXT_SYSTEM_EVENTS])})))
    ORDER BY event_sequence DESC
    LIMIT ${maxMessages + 1}
  `);
  const window = rows.slice(0, maxMessages).reverse().map(fromRaw);
  const older = rows[maxMessages];
  if (!older) return { events: window, gapAfter: null };

  const oldest = window[0]?.sequence ?? Number.MAX_SAFE_INTEGER;
  const [opening] = await tx.$queryRaw<RawConnectionEvent[]>(Prisma.sql`
    SELECT event_sequence, type, author_type, text, attachment_url, properties, created_at
    FROM events
    WHERE thread_id = ${ref.threadId}
      AND chat_id = ${ref.chatId}
      AND event_sequence < ${oldest}
      AND recipients = 'all'
      AND author_type = 'customer'
      AND type IN ('message', 'file')
    ORDER BY event_sequence ASC
    LIMIT 1
  `);
  if (!opening) return { events: window, gapAfter: 0 };
  const anchor = fromRaw(opening);
  // The row past the window may be the opening message itself, in which case
  // nothing between the two was left out.
  const gapAfter = Number(older.event_sequence) === anchor.sequence ? null : anchor.sequence;
  return { events: [anchor, ...window], gapAfter };
}

/** Read and build a turn's context in one call — the live adapter's door. */
export async function loadConnectionContext(
  tx: TenantClient,
  ref: ConnectionRef,
  state: TurnState,
  options: LoadConnectionOptions,
): Promise<ConnectionContext> {
  const budget = options.budget ?? DEFAULT_HISTORY_BUDGET;
  const read = await loadConnectionEvents(tx, ref, {
    through: options.through,
    maxMessages: budget.maxMessages,
  });
  return buildConnectionContext(read, {
    state,
    processedThrough: options.processedThrough,
    budget,
  });
}

/** An earlier message on its way into the context. */
interface Earlier {
  readonly message: LlmMessage;
  /** The visitor's first message on the connection — kept whatever the budget. */
  readonly opening: boolean;
  /** Messages were left out just before this one. */
  readonly gapBefore: boolean;
}

/**
 * The context from events already read. Pure, so every rule of the mapping
 * and the budget is pinned by a unit test without a database.
 */
export function buildConnectionContext(
  read: ConnectionEvents,
  input: { state: TurnState; processedThrough: number; budget?: HistoryBudget },
): ConnectionContext {
  const budget = input.budget ?? DEFAULT_HISTORY_BUDGET;
  const systemNotes: string[] = [];
  const earlier: Earlier[] = [];
  const fresh: string[] = [];
  let visitorMessages = 0;
  let lastSeq = 0;
  let openingSeen = false;
  // The gap marker goes on the first earlier message past the gap.
  let gapPending = read.gapAfter === 0;
  let gapPassed = read.gapAfter === null || read.gapAfter === 0;

  for (const event of read.events) {
    lastSeq = Math.max(lastSeq, event.sequence);
    if (!gapPassed && event.sequence > read.gapAfter!) {
      gapPending = true;
      gapPassed = true;
    }
    if (event.type === 'system_message') {
      if (event.text) systemNotes.push(`${clockOf(event.createdAt)} UTC — ${event.text}`);
      continue;
    }
    const message = asMessage(event);
    if (!message) continue;
    const opening = message.role === 'user' && !openingSeen;
    if (message.role === 'user') openingSeen = true;
    if (event.authorType === 'customer' && event.sequence > input.processedThrough) {
      fresh.push(message.content);
      continue;
    }
    if (message.role === 'user') visitorMessages += 1;
    earlier.push({ message, opening, gapBefore: gapPending });
    gapPending = false;
  }

  const kept = fitToChars(earlier, budget.maxChars);
  return {
    messages: mergeSameRole(kept),
    systemNotes,
    stateDigest: stateDigest(input.state),
    omitted: read.gapAfter !== null || kept.length < earlier.length,
    visitorMessages,
    newCustomerText: fresh.join('\n'),
    lastSeq,
  };
}

/**
 * What the conversation has settled, in a line or two the model can read:
 * the procedure step and the slots collected (AI-01 §3). Deterministic and
 * free — the stand-in for a summary of what the budget cut. Empty while
 * nothing is settled.
 */
export function stateDigest(state: TurnState): string {
  const lines: string[] = [];
  if (state.stepId) {
    lines.push(`Current step: ${state.stepId}${state.stepStatus ? ` (${state.stepStatus})` : ''}`);
  }
  const slots = Object.entries(state.slots).filter(([, value]) => value !== null);
  if (slots.length > 0) {
    const pairs = slots.map(
      ([key, value]) => `${key} = ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    );
    lines.push(`Collected so far: ${pairs.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * The history one step shorter, for a prompt that does not fit
 * `LLM_MAX_PROMPT_CHARS` (05 §1.0.7: the history is the section that yields).
 * The oldest message after the opening one goes first, then the ones before
 * it, the opening message last; with no messages left, the notes and the
 * digest go, and then there is no history (`undefined`).
 */
export function shortenHistory(history: TurnHistory): TurnHistory | undefined {
  const messages = history.messages.map((message) => ({ ...message }));
  if (messages.length === 0) return undefined;
  const opening = messages.findIndex((message) => message.role === 'user');
  const drop =
    opening >= 0 && opening + 1 < messages.length ? opening + 1 : opening > 0 ? 0 : opening;
  const at = Math.max(drop, 0);
  messages.splice(at, 1);
  // A cut that leaves two messages of one role side by side takes the second
  // too: it is the next oldest anyway, and merging it into its neighbour would
  // grow the opening message with everything the budget meant to drop.
  while (at > 0 && messages[at] && messages[at]!.role === messages[at - 1]!.role) {
    messages.splice(at, 1);
  }
  // What follows the cut says so.
  const next = messages[at];
  if (next && at > 0 && !next.content.startsWith(GAP_MARKER)) {
    next.content = `${GAP_MARKER}\n${next.content}`;
  }

  if (messages.length === 0 && history.systemNotes.length === 0 && !history.stateDigest) {
    return undefined;
  }
  return { ...history, messages, omitted: true };
}

/**
 * `[Attachment: image, .jpg]` — the kind, and the name when the event carries
 * one. A stored upload has no name of its own (its key is a random id), so
 * the extension stands in for it.
 */
export function attachmentPlaceholder(event: {
  type: string;
  attachmentUrl: string | null;
  properties: Readonly<Record<string, unknown>>;
}): string | null {
  if (!event.attachmentUrl && event.type !== 'file') return null;
  const named = ['file_name', 'name'].map((key) => event.properties[key]).find(isName);
  const extension = /\.([a-z0-9]{1,8})$/i.exec(event.attachmentUrl ?? '')?.[1]?.toLowerCase();
  const kind = (extension && KINDS[extension]) || 'file';
  const label = named ?? (extension ? `.${extension}` : null);
  return label ? `[Attachment: ${kind}, ${label}]` : `[Attachment: ${kind}]`;
}

const KINDS: Readonly<Record<string, string>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  pdf: 'document',
  txt: 'document',
  csv: 'document',
};

/**
 * The event as a model message, or null when it has nothing to say. An
 * attachment becomes a placeholder; its bytes never travel.
 */
function asMessage(event: ConnectionEvent): LlmMessage | null {
  const role =
    event.authorType === 'customer'
      ? 'user'
      : event.authorType === 'bot' || event.authorType === 'agent'
        ? 'assistant'
        : null;
  if (!role) return null;
  const parts = [event.text?.trim() ?? '', attachmentPlaceholder(event) ?? ''].filter(Boolean);
  if (parts.length === 0) return null;
  const content = parts.join('\n');
  return { role, content: event.authorType === 'agent' ? `${AGENT_MARKER} ${content}` : content };
}

/**
 * The newest messages that fit in `maxChars`, in order, and the opening one
 * whatever the budget — shortened to half of it when it is longer.
 */
function fitToChars(items: readonly Earlier[], maxChars: number): Earlier[] {
  const openingIndex = items.findIndex((item) => item.opening);
  const keep = new Map<number, Earlier>();
  let remaining = maxChars;
  if (openingIndex >= 0) {
    const opening = items[openingIndex]!;
    const content = clip(opening.message.content, Math.floor(maxChars / 2));
    keep.set(openingIndex, { ...opening, message: { ...opening.message, content } });
    remaining -= content.length;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (index === openingIndex) continue;
    const item = items[index]!;
    if (item.message.content.length > remaining) break;
    remaining -= item.message.content.length;
    keep.set(index, item);
  }

  const kept: Earlier[] = [];
  let previous = -1;
  for (const index of [...keep.keys()].sort((a, b) => a - b)) {
    const item = keep.get(index)!;
    kept.push(index > previous + 1 ? { ...item, gapBefore: true } : item);
    previous = index;
  }
  return kept;
}

/**
 * Join consecutive messages of one role (AI-01 §4), a line apiece, writing
 * the gap marker where messages were left out — so the model does not read
 * the opening message and the recent ones as one unbroken exchange.
 */
function mergeSameRole(items: readonly Earlier[]): LlmMessage[] {
  const merged: LlmMessage[] = [];
  for (const item of items) {
    const content = item.gapBefore
      ? `${GAP_MARKER}\n${item.message.content}`
      : item.message.content;
    const last = merged.at(-1);
    if (last && last.role === item.message.role) last.content = `${last.content}\n${content}`;
    else merged.push({ role: item.message.role, content });
  }
  return merged;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function clockOf(at: Date): string {
  return at.toISOString().slice(11, 16);
}

interface RawConnectionEvent {
  event_sequence: bigint | number;
  type: string;
  author_type: string;
  text: string | null;
  attachment_url: string | null;
  properties: unknown;
  created_at: Date;
}

function fromRaw(row: RawConnectionEvent): ConnectionEvent {
  return {
    sequence: Number(row.event_sequence),
    type: row.type as ConnectionEvent['type'],
    authorType: row.author_type,
    text: row.text,
    attachmentUrl: row.attachment_url,
    properties:
      row.properties && typeof row.properties === 'object'
        ? (row.properties as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}
