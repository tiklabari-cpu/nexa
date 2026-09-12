/**
 * The widget's RTM socket (FR-MOD-11.6).
 *
 * The visitor's side of the same gateway the agent app dials
 * (`apps/web/src/lib/realtime.ts`), speaking the same protocol — `login` →
 * pushes → `sync` on reconnect — deliberately rather than a second one invented
 * for the widget. A customer-shaped protocol would be a second implementation
 * of the same invariants on a surface where getting them wrong means one
 * visitor's conversation reaching another's browser.
 *
 * It is not the agent client, though, and could not be:
 *
 * **The budget.** The widget has a hard 50 KB gzipped ceiling (NFR-P3) and no
 * bundler in common with `apps/web`. Importing that client would drag in status
 * plumbing, typing indicators and a cursor model for many chats at once, for a
 * document that has exactly one conversation.
 *
 * **The reach.** An agent socket subscribes to a workspace; this one subscribes
 * to nothing at all. Authorization is not something the client asks for and the
 * server grants — the gateway addresses a customer socket *only* by the id
 * inside the signed token (`fanout.ts#isAddressed`), so there is no chat id, no
 * team and no `chats--all` for this file to name, correctly or otherwise. The
 * one thing it does send is a list of push *kinds* it wants, which widens
 * nothing.
 *
 * **The fallback.** An agent whose socket dies sees a "reconnecting" banner. A
 * visitor must never see anything: the widget keeps polling whenever this is not
 * live, so a socket blocked by a corporate proxy costs latency and nothing else.
 * The overlap is safe because every event the caller applies is keyed by id.
 */
import type { WidgetEvent } from './api.js';

/** Server closes an idle socket at 2× this, so a live one speaks first. */
const PING_INTERVAL_MS = 15_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
/** A request that never comes back must still settle, or `login` hangs forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Wire version — the gateway refuses anything else (`protocol.ts`). */
const RTM_VERSION = '3.6';

/**
 * What the visitor is entitled to be told about.
 *
 * `incoming_event` is the point of the exercise. `chat_deactivated` rides along
 * because the alternative — learning the conversation ended on the next poll —
 * is the one place where the fallback's latency is visible as a wrong screen
 * rather than a late one: the composer stays open for a chat that is gone.
 *
 * `event_updated` is the third because the visitor is who a correction is
 * *for* (FR-MOD-02.3.7). An agent who fixes a wrong order number and sees their
 * own transcript change, while the person it was sent to goes on reading the
 * wrong one, is the defect the edit was meant to repair — and the poll would
 * not catch it either, since the fallback appends what is new and a correction
 * mints no new event.
 */
const PUSHES = ['incoming_event', 'chat_deactivated', 'event_updated'] as const;

interface Frame {
  request_id?: string;
  action?: string;
  type?: 'response' | 'push';
  success?: boolean;
  payload?: Record<string, unknown>;
}

/** The slice of `WebSocket` this file uses, so a test can stand in for one. */
export interface WidgetWebSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface WidgetSocketOptions {
  /** The gateway's customer endpoint, from the token mint. */
  url: string;
  organizationId: string;
  /** Read per attempt, never captured: the token is re-minted on a 401. */
  getToken: () => string | null;
  /** One event the visitor may see — from a push or from a reconnect replay. */
  onEvent: (chatId: string, event: WidgetEvent) => void;
  /**
   * An event already in the transcript has been corrected (FR-MOD-02.3.7).
   * Separate from `onEvent` because the caller has to replace by id rather than
   * append — and because the cursor must not move onto it.
   */
  onEventUpdated: (chatId: string, event: WidgetEvent) => void;
  /** That conversation has ended (agent archive, idle sweep, or their own close). */
  onChatClosed: (chatId: string) => void;
  /** The gap was wider than the gateway will replay — refetch the transcript. */
  onResync: () => void;
  /** Live or not, so the caller can move its poll off the fast cadence. */
  onStatusChange: (live: boolean) => void;
  /** Injected in tests; production reads the global at each attempt. */
  createSocket?: (url: string) => WidgetWebSocket;
}

export class WidgetSocket {
  #ws: WidgetWebSocket | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #stopped = false;
  #live = false;
  #requestId = 0;
  #pending = new Map<string, (frame: Frame) => void>();
  /** Newest event seen per chat — where `sync` resumes from after a gap. */
  #cursors = new Map<string, string>();

  constructor(private readonly options: WidgetSocketOptions) {}

  get live(): boolean {
    return this.#live;
  }

  /**
   * Record where the transcript has got to.
   *
   * Called by the poll as well as by this class, and that is the point: the two
   * paths take turns, so a socket connecting after a poll has already advanced
   * the conversation must resume from what the *poll* saw. A cursor kept only
   * from pushes would replay everything the socket personally missed, including
   * what the visitor is already looking at.
   */
  noteEvent(chatId: string, eventId: string): void {
    // `pending-…` ids belong to optimistic bubbles that never existed
    // server-side; naming one as a cursor asks the gateway to resume from an
    // event in no thread, which it answers by declaring the whole chat
    // truncated.
    if (eventId.startsWith('pending-')) return;
    this.#cursors.set(chatId, eventId);
  }

  /** Forget a conversation that has ended — it will not be replayed again. */
  forget(chatId: string): void {
    this.#cursors.delete(chatId);
  }

  connect(): void {
    this.#stopped = false;
    if (this.#ws) return;
    this.#open();
  }

  close(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#pending.clear();
    const ws = this.#ws;
    this.#ws = null;
    try {
      ws?.close();
    } catch {
      // A socket that was never established has nothing to close.
    }
    this.#setLive(false);
  }

  #open(): void {
    const token = this.options.getToken();
    // No credential yet — the poll path is minting one; the next retry picks it
    // up rather than opening a socket that could only fail `login`.
    if (!token) {
      this.#scheduleRetry();
      return;
    }

    let ws: WidgetWebSocket;
    try {
      ws = this.#create(
        `${this.options.url}?organization_id=${encodeURIComponent(this.options.organizationId)}`,
      );
    } catch {
      // A blocked scheme, a Content-Security-Policy that does not list the
      // gateway, or a browser with no WebSocket at all. All three mean the same
      // thing here: stay on the poll and try again later.
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;

    ws.onopen = () => {
      void this.#login(token);
    };
    ws.onmessage = (event) => {
      this.#receive(event.data);
    };
    ws.onclose = () => {
      this.#handleClose(ws);
    };
    ws.onerror = () => {
      // `onclose` always follows, and reconnect is decided there — handling it
      // twice would double the backoff exponent on a single failure.
    };
  }

  #create(url: string): WidgetWebSocket {
    if (this.options.createSocket) return this.options.createSocket(url);
    const Ctor = (globalThis as { WebSocket?: new (url: string) => WidgetWebSocket }).WebSocket;
    if (!Ctor) throw new Error('no WebSocket');
    return new Ctor(url);
  }

  async #login(token: string): Promise<void> {
    const response = await this.#send('login', {
      token,
      pushes: { [RTM_VERSION]: [...PUSHES] },
    });
    // A socket that died between `open` and this answer has already scheduled
    // its own retry; going on would start a second one.
    if (this.#stopped || !this.#ws) return;

    if (!response.success) {
      // The credential is wrong, expired, or for another workspace. Retrying at
      // once would loop against a door that is not going to open — but not
      // retrying at all would strand a visitor whose token simply aged out, so
      // this backs off like any other failure. Meanwhile the poll is running
      // and re-mints on its own first 401, which is what makes the next attempt
      // different from this one.
      this.#ws.close();
      return;
    }

    this.#attempt = 0;
    this.#startPing();
    // Live only after `sync` has settled: the visitor's transcript has a hole
    // in it until then, and telling the caller "live" would let it slow the
    // poll that is currently the only thing filling that hole.
    if (this.#cursors.size > 0) {
      const sync = await this.#send('sync', { cursors: Object.fromEntries(this.#cursors) });
      if (this.#stopped || !this.#ws) return;
      if (sync.success) this.#applySync(sync.payload ?? {});
    }
    this.#setLive(true);
  }

  /**
   * Missed-event recovery (NFR-R2), the visitor's half.
   *
   * The gateway answers per chat with everything after the cursor. Each event
   * goes through the same `onEvent` a push does, so the caller has one path to
   * get right and de-duplication covers both.
   */
  #applySync(payload: Record<string, unknown>): void {
    const chats = (payload['chats'] ?? []) as Array<{
      chat_id?: unknown;
      events?: unknown;
      corrections?: unknown;
      truncated?: unknown;
    }>;

    for (const chat of chats) {
      if (typeof chat.chat_id !== 'string') continue;
      // Corrections first, so an edit to a message already on screen is applied
      // before anything new lands under it — and so the two lists cannot fight
      // over an event that is in both.
      for (const raw of Array.isArray(chat.corrections) ? chat.corrections : []) {
        const event = asEvent(raw);
        if (!event) continue;
        // No `noteEvent`, for the same reason a live `event_updated` does not
        // move the cursor: these sit *behind* it by construction.
        this.options.onEventUpdated(chat.chat_id, event);
      }
      for (const raw of Array.isArray(chat.events) ? chat.events : []) {
        const event = asEvent(raw);
        if (!event) continue;
        this.noteEvent(chat.chat_id, event.id);
        this.options.onEvent(chat.chat_id, event);
      }
      // Away long enough that the gateway capped the replay. A transcript with
      // an invisible hole is worse than a slow one — refetch instead.
      if (chat.truncated === true) this.options.onResync();
    }

    // A chat the visitor still holds but the gateway no longer sees is one that
    // is no longer active: it ended while the socket was down.
    for (const chatId of asStrings(payload['removed_chat_ids'])) {
      this.#cursors.delete(chatId);
      this.options.onChatClosed(chatId);
    }
    // A conversation started while we were away — there is no cursor to replay
    // from, so the transcript comes from the poll.
    if (asStrings(payload['new_chat_ids']).length > 0) this.options.onResync();
  }

  #receive(data: unknown): void {
    let frame: Frame;
    try {
      frame = JSON.parse(String(data)) as Frame;
    } catch {
      return;
    }

    if (frame.type === 'response' && typeof frame.request_id === 'string') {
      const settle = this.#pending.get(frame.request_id);
      this.#pending.delete(frame.request_id);
      settle?.(frame);
      return;
    }
    if (frame.type !== 'push') return;

    const payload = frame.payload ?? {};
    const chatId = payload['chat_id'];
    if (typeof chatId !== 'string') return;

    if (frame.action === 'incoming_event') {
      const event = asEvent(payload['event']);
      if (!event) return;
      this.noteEvent(chatId, event.id);
      this.options.onEvent(chatId, event);
      return;
    }
    if (frame.action === 'event_updated') {
      const event = asEvent(payload['event']);
      if (!event) return;
      // No `noteEvent`. The cursor is "the newest event seen", and a correction
      // can land on a message several older than that — advancing it onto one
      // would make the next `sync` skip everything in between.
      //
      // That leaves the cursor unable to describe a correction at all, which
      // used to mean a push missed here was missed for good. It no longer does:
      // `sync` answers with a `corrections` list beside `events` (see
      // `#applySync`), so a socket that was down across the edit is caught up
      // on reconnect.
      this.options.onEventUpdated(chatId, event);
      return;
    }
    if (frame.action === 'chat_deactivated') {
      this.#cursors.delete(chatId);
      this.options.onChatClosed(chatId);
    }
  }

  #send(action: string, payload: Record<string, unknown>): Promise<Frame> {
    const requestId = `w${++this.#requestId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(requestId)) resolve({ success: false });
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(requestId, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });

      try {
        this.#ws?.send(
          JSON.stringify({ version: RTM_VERSION, request_id: requestId, action, payload }),
        );
      } catch {
        // The socket died mid-write; `onclose` handles the reconnect and the
        // timeout above settles this caller.
      }
    });
  }

  #handleClose(ws: WidgetWebSocket): void {
    // A close belonging to a socket we have already replaced must not schedule
    // a retry — that is how one dropped connection becomes two.
    if (ws !== this.#ws) return;
    this.#ws = null;
    this.#clearTimers();
    this.#pending.clear();
    this.#setLive(false);
    if (!this.#stopped) this.#scheduleRetry();
  }

  #startPing(): void {
    this.#pingTimer = setInterval(() => {
      void this.#send('ping', {});
    }, PING_INTERVAL_MS);
  }

  /**
   * Exponential backoff with full jitter. Without the jitter a gateway restart
   * brings every visitor on every embed back at the same instant, which is how
   * a blink becomes an outage.
   */
  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer !== null) return;
    this.#attempt += 1;
    const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (this.#attempt - 1), MAX_BACKOFF_MS);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#stopped) this.#open();
    }, Math.random() * ceiling);
  }

  #clearTimers(): void {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #setLive(live: boolean): void {
    if (this.#live === live) return;
    this.#live = live;
    this.options.onStatusChange(live);
  }
}

/**
 * An event off the wire, or null.
 *
 * Shaped rather than cast: this is the one place gateway-supplied data becomes
 * something the widget writes to the DOM, and a field of the wrong type would
 * otherwise reach `textContent` as `[object Object]`. `recipients` is checked
 * too — the API addresses internal notes to agents only, but the widget refuses
 * to render one even if a note ever reached it.
 */
function asEvent(raw: unknown): WidgetEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value['id'] !== 'string' || value['id'] === '') return null;
  if (value['recipients'] !== undefined && value['recipients'] !== 'all') return null;

  const author = value['author_type'];
  return {
    id: value['id'],
    text: typeof value['text'] === 'string' ? value['text'] : null,
    author_type:
      author === 'agent' || author === 'customer' || author === 'bot' || author === 'system'
        ? author
        : 'system',
    created_at:
      typeof value['created_at'] === 'string' ? value['created_at'] : new Date().toISOString(),
    type: typeof value['type'] === 'string' ? value['type'] : 'message',
    attachment_url: typeof value['attachment_url'] === 'string' ? value['attachment_url'] : null,
    // Carried through so `event_updated` can bring the "edited" marker with it
    // (FR-MOD-02.3.7). Narrowed rather than cast: everything else on this event
    // is validated, and a `properties` that is not an object would reach
    // `readEditedAt` from two paths instead of one.
    ...(typeof value['properties'] === 'object' && value['properties'] !== null
      ? { properties: value['properties'] as Record<string, unknown> }
      : {}),
  };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
