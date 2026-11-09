/**
 * Inbox state: the chat list, the open transcript, and the live updates that
 * keep both current.
 *
 * One store rather than per-screen state, for the same reason the console folds
 * realtime into its query cache: a pushed message and a fetched one must be
 * indistinguishable downstream. The alternative — a list of "live events"
 * merged at render time — is where duplicates and out-of-order bubbles come
 * from, and on a phone the merge would have to happen on every reconnect too.
 *
 * Everything is held newest-first. That is the order the API returns with
 * `sort: newest`, the order a push arrives in, and the order an inverted
 * `FlatList` renders — so there is no place left to get it wrong.
 *
 * Deliberately not TanStack Query, which is what the console uses. The phone's
 * update pattern is a socket, not a poll: React Query would be a cache in front
 * of a stream, and the reconciliation between the two is exactly the code this
 * class is. It also keeps a dependency out of a bundle that `13.7-k` has to
 * weigh.
 */
import type { InboxApi } from './api';
import type { ComposerDraft } from './failedSend';
import { REFUSED_PROPERTY, type ReplyAccess, type ReplyLock } from './replyGuard';
import {
  LOCAL_EVENT_PREFIX,
  PENDING_PROPERTY,
  SEND_FAILED_PROPERTY,
  failedSendOf,
  isLocalOnly,
  isPending,
  type ChatEvent,
  type ChatSummary,
  type EventRecipients,
  type FailedSend,
  type InboxView,
} from './types';
import type { RtmClientAction, RtmStatus } from '../../rtm/client';
import { ApiClientError } from '../../lib/api-client';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TranscriptState {
  /** Newest first. */
  events: ChatEvent[];
  status: LoadStatus;
  error: string | null;
  /** Whether a further page of history exists behind the oldest loaded event. */
  hasMore: boolean;
  loadingOlder: boolean;
  /** A composer send is in flight (a retry from a bubble does not count). */
  sending: boolean;
  /** Why the latest attempt failed; the bubble itself says "not sent" (tm 437). */
  sendError: string | null;
}

export interface InboxState {
  view: InboxView;
  chats: ChatSummary[];
  status: LoadStatus;
  error: string | null;
  refreshing: boolean;
  transcripts: Readonly<Record<string, TranscriptState>>;
  connection: RtmStatus;
  /**
   * Chats the phone has learnt it may not answer (tm 475.5): the server
   * refused a reply (409 `reply_requires_assignment`), the chat left the `my`
   * list, or it was archived. Cleared when a fresh list shows it mine again.
   */
  replyLocks: Readonly<Record<string, ReplyLock>>;
}

export interface InboxStoreOptions {
  api: InboxApi;
  /** The signed-in agent, so the transcript knows which bubbles are theirs. */
  accountId?: string | null;
  /** Where a cursor goes — wired to `MobileRtmClient.noteEvent`. */
  onCursor?: (chatId: string, eventId: string) => void;
  onChatForgotten?: (chatId: string) => void;
  now?: () => number;
  view?: InboxView;
}

const EMPTY_TRANSCRIPT: TranscriptState = {
  events: [],
  status: 'idle',
  error: null,
  hasMore: false,
  loadingOlder: false,
  sending: false,
  sendError: null,
};

export class InboxStore {
  #state: InboxState;
  #listeners = new Set<() => void>();
  #pendingCounter = 0;
  /**
   * Generation counters, one per request kind. A slow first page that lands
   * after the reader has pulled to refresh must not overwrite the newer answer,
   * and on a mobile connection that reordering is routine rather than rare.
   */
  #chatsGeneration = 0;
  #transcriptGeneration = new Map<string, number>();
  /** The chat on screen — unread counts are not bumped for it. */
  #activeChatId: string | null = null;

  readonly #options: InboxStoreOptions;

  constructor(options: InboxStoreOptions) {
    this.#options = options;
    this.#state = {
      view: options.view ?? 'my',
      chats: [],
      status: 'idle',
      error: null,
      refreshing: false,
      transcripts: {},
      connection: 'offline',
      replyLocks: {},
    };
  }

  // --- Reading ---------------------------------------------------------------

  getState = (): InboxState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  transcriptOf(chatId: string | null): TranscriptState {
    if (chatId === null) return EMPTY_TRANSCRIPT;
    return this.#state.transcripts[chatId] ?? EMPTY_TRANSCRIPT;
  }

  get accountId(): string | null {
    return this.#options.accountId ?? null;
  }

  /**
   * May I answer this customer from here (tm 475.5 · D10)? Read from the list
   * row's `assignee_id` — the newest connection's assignee — against the
   * signed-in account, plus what the store has learnt since. No request of
   * its own.
   */
  replyAccessOf(chatId: string): ReplyAccess {
    const lock = this.#state.replyLocks[chatId];
    if (lock !== undefined) return lock;
    const chat = this.#state.chats.find((candidate) => candidate.id === chatId);
    if (chat === undefined) return 'unknown';
    if (chat.active === false) return 'closed';
    if (this.accountId === null) return 'unknown';
    return chat.assignee_id === this.accountId ? 'mine' : 'not_mine';
  }

  // --- Chat list -------------------------------------------------------------

  setView(view: InboxView): void {
    if (this.#state.view === view) return;
    this.#patch({ view, chats: [], status: 'idle', error: null });
    void this.loadChats();
  }

  async loadChats(options: { refresh?: boolean } = {}): Promise<void> {
    const generation = ++this.#chatsGeneration;
    const refresh = options.refresh === true;
    this.#patch(refresh ? { refreshing: true, error: null } : { status: 'loading', error: null });

    try {
      const page = await this.#options.api.listChats(this.#state.view);
      if (generation !== this.#chatsGeneration) return;
      this.#patch({
        chats: page.items,
        status: 'ready',
        error: null,
        refreshing: false,
        replyLocks: this.#locksAfterList(page.items),
      });
      this.#seedCursors(page.items);
    } catch (error) {
      if (generation !== this.#chatsGeneration) return;
      this.#patch({
        status: this.#state.chats.length > 0 ? 'ready' : 'error',
        error: messageOf(error),
        refreshing: false,
      });
    }
  }

  /**
   * What a fresh list says about who may answer.
   *
   * On the phone the list is the `my` view (D10): a conversation leaves it
   * only when it stops being mine or closes, so one that was listed and is
   * not any more is locked — that is the open screen of a chat a colleague
   * just took over. A row that is mine and open again lifts its lock: the
   * list is newer than whatever set it, because every load bumps the
   * generation and an older answer is dropped above.
   */
  #locksAfterList(next: ChatSummary[]): Record<string, ReplyLock> {
    const locks: Record<string, ReplyLock> = { ...this.#state.replyLocks };
    if (this.#state.view === 'my') {
      const listed = new Set(next.map((chat) => chat.id));
      for (const chat of this.#state.chats) {
        if (!listed.has(chat.id) && locks[chat.id] === undefined) locks[chat.id] = 'not_mine';
      }
    }
    for (const chat of next) {
      if (chat.active !== false && this.accountId !== null && chat.assignee_id === this.accountId) {
        delete locks[chat.id];
      }
    }
    return locks;
  }

  /**
   * Teach the socket where every listed conversation stands.
   *
   * The console only ever learns an event id by watching one arrive, which is
   * enough for a tab that stays open. A phone spends most of its life asleep
   * and sees none of them — without this, a reconnect would replay only the
   * chat that happened to be open and everything else would look unchanged
   * until it was tapped.
   */
  #seedCursors(chats: ChatSummary[]): void {
    for (const chat of chats) {
      const lastEventId = chat.last_event?.id;
      if (typeof lastEventId === 'string') this.#options.onCursor?.(chat.id, lastEventId);
    }
  }

  // --- Transcript ------------------------------------------------------------

  /** Called when a chat screen opens. Loads the newest page once. */
  openChat(chatId: string): void {
    this.#activeChatId = chatId;
    this.#clearUnread(chatId);
    const transcript = this.transcriptOf(chatId);
    if (transcript.status === 'idle' || transcript.status === 'error') {
      void this.loadTranscript(chatId);
    }
  }

  closeChat(chatId: string): void {
    if (this.#activeChatId === chatId) this.#activeChatId = null;
  }

  async loadTranscript(chatId: string): Promise<void> {
    const generation = (this.#transcriptGeneration.get(chatId) ?? 0) + 1;
    this.#transcriptGeneration.set(chatId, generation);
    this.#patchTranscript(chatId, { status: 'loading', error: null });

    try {
      const page = await this.#options.api.listEvents(chatId, {});
      if (generation !== this.#transcriptGeneration.get(chatId)) return;
      // Bubbles only this phone holds — sending, failed, refused — are not in
      // the server's page, and replacing the transcript with it would delete
      // them. A reload follows a reconnect (`sync_truncated`), which on a weak
      // signal is exactly when a send has just failed (tm 437). They stay at
      // the newest end, next to the composer, where an open question belongs;
      // one whose message the page does hold settles by id when its request
      // (or its retry) answers.
      const local = this.transcriptOf(chatId).events.filter(isLocalOnly);
      this.#patchTranscript(chatId, {
        events: [...local, ...page.items],
        status: 'ready',
        error: null,
        hasMore: page.next_page_id !== undefined,
      });
      // `items` is newest-first, so the cursor is the head of the page.
      const newest = page.items[0]?.id;
      if (newest !== undefined) this.#options.onCursor?.(chatId, newest);
    } catch (error) {
      if (generation !== this.#transcriptGeneration.get(chatId)) return;
      this.#patchTranscript(chatId, { status: 'error', error: messageOf(error) });
    }
  }

  /**
   * One more page of history, from the oldest event currently loaded.
   *
   * Guarded on `loadingOlder` because `onEndReached` fires repeatedly while a
   * list settles: without it, one flick asks the server for the same page four
   * times and appends it four times.
   */
  async loadOlder(chatId: string): Promise<void> {
    const transcript = this.transcriptOf(chatId);
    if (!transcript.hasMore || transcript.loadingOlder || transcript.status !== 'ready') return;

    const oldest = transcript.events.at(-1);
    if (oldest === undefined) return;

    this.#patchTranscript(chatId, { loadingOlder: true });
    try {
      const page = await this.#options.api.listEvents(chatId, { beforeEventId: oldest.id });
      const current = this.transcriptOf(chatId);
      const known = new Set(current.events.map((event) => event.id));
      this.#patchTranscript(chatId, {
        events: [...current.events, ...page.items.filter((event) => !known.has(event.id))],
        hasMore: page.next_page_id !== undefined,
        loadingOlder: false,
      });
    } catch (error) {
      // History that failed to load is not an error worth replacing the
      // transcript with — the messages already on screen are still true.
      this.#patchTranscript(chatId, { loadingOlder: false, error: messageOf(error) });
    }
  }

  // --- Sending ---------------------------------------------------------------

  /**
   * Send a reply or an internal note.
   *
   * The message appears immediately, marked pending. An agent who sees nothing
   * happen presses send again, and on a slow connection that is how one message
   * becomes three — so the optimistic bubble is not a nicety, and the
   * idempotency key is what makes the retry behind it safe.
   *
   * The key is minted here, once per message, and never again: a failed send
   * keeps it on the bubble and {@link retrySend} sends it unchanged (tm 437).
   */
  async send(
    chatId: string,
    input: { text: string; recipients: EventRecipients },
  ): Promise<boolean> {
    const text = input.text.trim();
    if (text === '') return false;

    const stamp = (this.#options.now ?? Date.now)();
    const localId = `${LOCAL_EVENT_PREFIX}${++this.#pendingCounter}`;
    const optimistic: ChatEvent = {
      id: localId,
      chat_id: chatId,
      thread_id: '',
      type: 'message',
      text,
      author_id: this.accountId,
      author_type: 'agent',
      recipients: input.recipients,
      attachment_url: null,
      properties: { [PENDING_PROPERTY]: true },
      created_at: new Date(stamp).toISOString(),
    };

    const before = this.transcriptOf(chatId);
    this.#patchTranscript(chatId, {
      events: [optimistic, ...before.events],
      sending: true,
      sendError: null,
    });

    return this.#deliver(
      chatId,
      localId,
      { text, recipients: input.recipients, idempotencyKey: `${stamp.toString(36)}-${localId}` },
      { fromComposer: true },
    );
  }

  /**
   * Send a failed message again, with the key its first attempt carried
   * (tm 437).
   *
   * That key is the point. On a weak signal the usual failure is a timeout
   * whose request did arrive: the server saved the message and the answer was
   * lost on the way back. A fresh key would save it a second time; the same
   * key gets the saved one back (`replayed`), and the bubble turns into it.
   *
   * The text and the mode are read off the bubble — what the agent sees is
   * what goes — so a note retried is still a note. A second tap while the
   * first retry is in flight finds the bubble pending again and does nothing.
   */
  async retrySend(chatId: string, eventId: string): Promise<boolean> {
    const bubble = this.transcriptOf(chatId).events.find((event) => event.id === eventId);
    const failed = bubble === undefined ? null : failedSendOf(bubble);
    if (bubble === undefined || failed === null || !failed.retryable) return false;

    this.#replaceBubble(chatId, eventId, { [PENDING_PROPERTY]: true });
    this.#patchTranscript(chatId, { sendError: null });

    return this.#deliver(
      chatId,
      eventId,
      {
        text: bubble.text ?? '',
        recipients: bubble.recipients,
        idempotencyKey: failed.idempotency_key,
      },
      { fromComposer: false },
    );
  }

  /**
   * Take a failed message back (tm 437): the bubble goes, and its text and
   * mode are returned for the composer. Only a failed bubble can be taken —
   * one still sending may yet arrive, and one the server refused stays as the
   * record that it did not go.
   */
  discardFailedSend(chatId: string, eventId: string): ComposerDraft | null {
    const current = this.transcriptOf(chatId);
    const bubble = current.events.find((event) => event.id === eventId);
    if (bubble === undefined || failedSendOf(bubble) === null) return null;

    this.#patchTranscript(chatId, {
      events: current.events.filter((event) => event.id !== eventId),
      sendError: null,
    });
    return { text: bubble.text ?? '', recipients: bubble.recipients };
  }

  /**
   * One attempt at one message, settling its bubble whichever way it goes.
   *
   * - Accepted (or replayed): the bubble becomes the server's event — or is
   *   dropped, if the socket already put that event on screen.
   * - Refused because the chat is not mine (tm 475.5): kept, marked refused,
   *   never retried.
   * - Anything else: kept, marked failed with this message's key (tm 437).
   *
   * `fromComposer` says whether this attempt is the one the composer is
   * waiting on; a retry from the bubble leaves the composer's state alone.
   */
  async #deliver(
    chatId: string,
    localId: string,
    message: { text: string; recipients: EventRecipients; idempotencyKey: string },
    options: { fromComposer: boolean },
  ): Promise<boolean> {
    const released: Partial<TranscriptState> = options.fromComposer ? { sending: false } : {};

    try {
      const event = await this.#options.api.sendEvent(chatId, {
        type: 'message',
        text: message.text,
        recipients: message.recipients,
        idempotency_key: message.idempotencyKey,
      });

      const current = this.transcriptOf(chatId);
      // The socket may have echoed this event back before the POST resolved —
      // or, for a retry, the first attempt's echo arrived while it sat failed.
      const alreadyThere = current.events.some((existing) => existing.id === event.id);
      this.#patchTranscript(chatId, {
        events: alreadyThere
          ? current.events.filter((existing) => existing.id !== localId)
          : current.events.map((existing) => (existing.id === localId ? event : existing)),
        ...released,
        sendError: null,
      });
      this.#noteEvent(chatId, event);
      this.#applyToChatList(chatId, event);
      return true;
    } catch (error) {
      if (!this.transcriptOf(chatId).events.some((existing) => existing.id === localId)) {
        // The bubble is gone: the socket delivered this very message while the
        // request was still out (its echo took the bubble's place), or the
        // conversation was dropped. There is nothing left to mark, and an
        // error line under a message the screen shows as sent would only
        // invite the agent to type it again.
        if (options.fromComposer) this.#patchTranscript(chatId, released);
        return false;
      }

      if (isReplyRefusal(error)) {
        // The chat is not mine to answer (tm 475.5 · D10). Retrying cannot
        // help — the answer will be the same until someone assigns it to me —
        // so there is no retry; but the words are not thrown away either: the
        // bubble stays, marked as not sent, and the composer closes.
        this.#replaceBubble(chatId, localId, { [REFUSED_PROPERTY]: true });
        this.#patchTranscript(chatId, { ...released, sendError: null });
        this.#lock(chatId, 'not_mine');
        // The list still says it is mine; read who has it now.
        void this.loadChats({ refresh: true });
        return false;
      }

      // Keep the bubble (tm 437). Rolling it back, as this once did, lost the
      // reply outright on a weak signal: the composer had already cleared. It
      // stays with its key, marked not sent, until the agent tries again or
      // takes the text back.
      const failed: FailedSend = {
        idempotency_key: message.idempotencyKey,
        retryable: !(error instanceof ApiClientError) || error.isRetryable,
      };
      this.#replaceBubble(chatId, localId, { [SEND_FAILED_PROPERTY]: failed });
      this.#patchTranscript(chatId, { ...released, sendError: messageOf(error) });
      return false;
    }
  }

  /** Swap a local bubble's state marker, leaving its words and place alone. */
  #replaceBubble(chatId: string, localId: string, properties: Record<string, unknown>): void {
    const current = this.transcriptOf(chatId);
    this.#patchTranscript(chatId, {
      events: current.events.map((existing) =>
        existing.id === localId ? { ...existing, properties } : existing,
      ),
    });
  }

  // --- Realtime --------------------------------------------------------------

  setConnection(connection: RtmStatus): void {
    if (this.#state.connection === connection) return;
    this.#patch({ connection });
  }

  applyPush(action: RtmClientAction, payload: Record<string, unknown>): void {
    const chatId = typeof payload['chat_id'] === 'string' ? payload['chat_id'] : null;

    switch (action) {
      case 'incoming_event': {
        const event = payload['event'] as ChatEvent | undefined;
        if (chatId === null || event === undefined || typeof event.id !== 'string') return;
        this.#receiveEvent(chatId, event);
        return;
      }

      case 'event_updated': {
        // A message was corrected after it was sent (FR-MOD-02.3.7). Replace by
        // id, and deliberately not through `#receiveEvent`: that one dedupes by
        // id and would drop this, and it moves the cursor — which must not
        // follow a correction to an event older than the newest one seen.
        const event = payload['event'] as ChatEvent | undefined;
        if (chatId === null || event === undefined || typeof event.id !== 'string') return;
        const transcript = this.#state.transcripts[chatId];
        if (transcript?.events.some((existing) => existing.id === event.id) === true) {
          this.#patchTranscript(chatId, {
            events: transcript.events.map((existing) =>
              existing.id === event.id ? event : existing,
            ),
          });
        }
        return;
      }

      case 'sync_truncated':
        // The gap was too large to replay. Refetch rather than show a
        // transcript with an invisible hole in it.
        if (chatId !== null && this.transcriptOf(chatId).status !== 'idle') {
          void this.loadTranscript(chatId);
        }
        return;

      case 'chat_unfollowed':
        // Access was lost while we were away; the conversation is not ours to
        // show any more, transcript included.
        if (chatId !== null) this.#dropChat(chatId);
        return;

      case 'chat_deactivated':
        // Archived: say so, rather than "no longer yours", when the refresh
        // below drops it from the list.
        if (chatId !== null) this.#lock(chatId, 'closed');
        void this.loadChats({ refresh: true });
        return;

      // `sync_required`: pushes were lost on the gateway's bus (tm 408), and
      // which chats they moved is exactly what is not known.
      case 'incoming_chat':
      case 'chat_appeared':
      case 'chat_transferred':
      case 'chat_taken_over':
      case 'sync_required':
        void this.loadChats({ refresh: true });
        return;

      default:
        return;
    }
  }

  #receiveEvent(chatId: string, event: ChatEvent): void {
    const transcript = this.#state.transcripts[chatId];
    if (transcript !== undefined) {
      // Deduplicate by id: a push and a replay can both deliver the same event,
      // and after a reconnect they routinely do.
      if (!transcript.events.some((existing) => existing.id === event.id)) {
        // Our own message, echoed back before the POST resolved. Replace the
        // placeholder instead of showing the sentence twice. Only my own words
        // in the same mode count as the echo: a customer who happens to write
        // the same "ok" must not sweep away a bubble whose send may yet fail
        // (tm 437) — the request's failure would then have nothing to mark.
        const withoutEcho = transcript.events.filter(
          (existing) => !(isPending(existing) && isEchoOf(existing, event)),
        );
        this.#patchTranscript(chatId, { events: [event, ...withoutEcho] });
      }
    }

    this.#noteEvent(chatId, event);
    this.#applyToChatList(chatId, event);
  }

  #noteEvent(chatId: string, event: ChatEvent): void {
    if (typeof event.id === 'string' && !isLocalOnly(event)) {
      this.#options.onCursor?.(chatId, event.id);
    }
  }

  /**
   * Fold an event into the list: newest conversation first, and an unread badge
   * for anything the reader is not currently looking at.
   *
   * A chat we have never heard of means the routing changed while we were
   * connected, so the list itself is stale — refetch rather than invent a row
   * out of one event.
   */
  #applyToChatList(chatId: string, event: ChatEvent): void {
    const index = this.#state.chats.findIndex((chat) => chat.id === chatId);
    if (index < 0) {
      void this.loadChats({ refresh: true });
      return;
    }

    const chat = this.#state.chats[index] as ChatSummary;
    const unread =
      event.author_type === 'customer' && chatId !== this.#activeChatId
        ? (chat.unread_count ?? 0) + 1
        : (chat.unread_count ?? 0);

    const updated: ChatSummary = { ...chat, last_event: event, unread_count: unread };
    const rest = this.#state.chats.filter((existing) => existing.id !== chatId);
    this.#patch({ chats: [updated, ...rest] });
  }

  #clearUnread(chatId: string): void {
    const index = this.#state.chats.findIndex((chat) => chat.id === chatId);
    if (index < 0 || (this.#state.chats[index] as ChatSummary).unread_count === 0) return;
    const chats = this.#state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, unread_count: 0 } : chat,
    );
    this.#patch({ chats });
  }

  #dropChat(chatId: string): void {
    const transcripts = { ...this.#state.transcripts };
    delete transcripts[chatId];
    this.#transcriptGeneration.delete(chatId);
    this.#options.onChatForgotten?.(chatId);
    this.#patch({
      chats: this.#state.chats.filter((chat) => chat.id !== chatId),
      transcripts,
      replyLocks: { ...this.#state.replyLocks, [chatId]: 'not_mine' },
    });
  }

  #lock(chatId: string, lock: ReplyLock): void {
    if (this.#state.replyLocks[chatId] === lock) return;
    this.#patch({ replyLocks: { ...this.#state.replyLocks, [chatId]: lock } });
  }

  // --- Plumbing --------------------------------------------------------------

  #patch(partial: Partial<InboxState>): void {
    this.#state = { ...this.#state, ...partial };
    this.#emit();
  }

  #patchTranscript(chatId: string, partial: Partial<TranscriptState>): void {
    const current = this.#state.transcripts[chatId] ?? EMPTY_TRANSCRIPT;
    this.#state = {
      ...this.#state,
      transcripts: { ...this.#state.transcripts, [chatId]: { ...current, ...partial } },
    };
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** Whether a pushed event is the server's copy of this phone's pending bubble. */
function isEchoOf(bubble: ChatEvent, event: ChatEvent): boolean {
  return (
    typeof bubble.author_id === 'string' &&
    bubble.author_id === event.author_id &&
    bubble.recipients === event.recipients &&
    bubble.text === event.text
  );
}

function isReplyRefusal(error: unknown): boolean {
  return error instanceof ApiClientError && error.type === 'reply_requires_assignment';
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Something went wrong. Pull to try again.';
}
