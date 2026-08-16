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
import {
  isPending,
  type ChatEvent,
  type ChatSummary,
  type EventRecipients,
  type InboxView,
} from './types';
import type { RtmClientAction, RtmStatus } from '../../rtm/client';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TranscriptState {
  /** Newest first. */
  events: ChatEvent[];
  status: LoadStatus;
  error: string | null;
  /** Whether a further page of history exists behind the oldest loaded event. */
  hasMore: boolean;
  loadingOlder: boolean;
  sending: boolean;
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
      this.#patch({ chats: page.items, status: 'ready', error: null, refreshing: false });
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
      this.#patchTranscript(chatId, {
        events: page.items,
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
   */
  async send(
    chatId: string,
    input: { text: string; recipients: EventRecipients },
  ): Promise<boolean> {
    const text = input.text.trim();
    if (text === '') return false;

    const stamp = (this.#options.now ?? Date.now)();
    const pendingId = `pending-${++this.#pendingCounter}`;
    const optimistic: ChatEvent = {
      id: pendingId,
      chat_id: chatId,
      thread_id: '',
      type: 'message',
      text,
      author_id: this.accountId,
      author_type: 'agent',
      recipients: input.recipients,
      attachment_url: null,
      properties: { pending: true },
      created_at: new Date(stamp).toISOString(),
    };

    const before = this.transcriptOf(chatId);
    this.#patchTranscript(chatId, {
      events: [optimistic, ...before.events],
      sending: true,
      sendError: null,
    });

    try {
      const event = await this.#options.api.sendEvent(chatId, {
        type: 'message',
        text,
        recipients: input.recipients,
        // Survives a retry after a timeout without posting twice.
        idempotency_key: `${stamp.toString(36)}-${pendingId}`,
      });

      const current = this.transcriptOf(chatId);
      // The socket may have echoed this event back before the POST resolved.
      const alreadyThere = current.events.some((existing) => existing.id === event.id);
      this.#patchTranscript(chatId, {
        events: alreadyThere
          ? current.events.filter((existing) => existing.id !== pendingId)
          : current.events.map((existing) => (existing.id === pendingId ? event : existing)),
        sending: false,
        sendError: null,
      });
      this.#noteEvent(chatId, event);
      this.#applyToChatList(chatId, event);
      return true;
    } catch (error) {
      const current = this.transcriptOf(chatId);
      // Roll the bubble back rather than leave a message on screen that nobody
      // received — a greyed-out "sent" is the worst of both answers.
      this.#patchTranscript(chatId, {
        events: current.events.filter((existing) => existing.id !== pendingId),
        sending: false,
        sendError: messageOf(error),
      });
      return false;
    }
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

      case 'incoming_chat':
      case 'chat_appeared':
      case 'chat_transferred':
      case 'chat_taken_over':
      case 'chat_deactivated':
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
        // placeholder instead of showing the sentence twice.
        const withoutEcho = transcript.events.filter(
          (existing) => !(isPending(existing) && existing.text === event.text),
        );
        this.#patchTranscript(chatId, { events: [event, ...withoutEcho] });
      }
    }

    this.#noteEvent(chatId, event);
    this.#applyToChatList(chatId, event);
  }

  #noteEvent(chatId: string, event: ChatEvent): void {
    if (typeof event.id === 'string' && !event.id.startsWith('pending-')) {
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
    this.#patch({ chats: this.#state.chats.filter((chat) => chat.id !== chatId), transcripts });
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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Something went wrong. Pull to try again.';
}
