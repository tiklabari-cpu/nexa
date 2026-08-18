/**
 * The RTM client for the phone.
 *
 * Same protocol as the console, deliberately: ADR-15 fixes the envelope
 * (`{version, request_id, action, payload}` out, `{request_id, action, type,
 * success, payload}` back) and mobile speaks it unchanged. A second protocol
 * "for mobile" would mean a second implementation of login, of push
 * subscription, and — the expensive one — of missed-event recovery, which is
 * the part nobody notices is wrong until a customer's message is gone.
 *
 * What is genuinely different here is not the wire but the network underneath
 * it, and that shows up in three places:
 *
 * **The socket dies constantly.** A phone changes cell, drops into a lift,
 * joins a captive-portal wifi. Reconnect is not an edge case, it is the normal
 * operating mode, so the cursor bookkeeping that makes reconnect lossless has
 * to be right rather than best-effort.
 *
 * **The app gets suspended.** iOS and Android freeze a backgrounded app; the
 * socket is either killed outright or wakes believing it is still open with a
 * gap behind it. Waiting for a ping to time out would leave the first seconds
 * after unlock silently stale, so returning to the foreground forces a
 * reconnect immediately — and the sync that follows is what fills the gap.
 *
 * **Cursors come from the list, not only from the stream.** The console learns
 * an event id when the event arrives. A phone that was asleep for an hour never
 * saw any of them, so the chat list's `last_event` seeds the cursors too: after
 * a reconnect the server replays every chat's missed tail, not just the one
 * that happened to be open when the connection dropped.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { RTM_LIMITS, RTM_PATHS, RTM_VERSION, type RtmPushAction } from '@nexa/types';

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

export type RtmStatus = 'offline' | 'connecting' | 'live' | 'reconnecting';

export interface RtmMessage {
  request_id?: string;
  action: string;
  type: 'response' | 'push';
  success?: boolean;
  payload: Record<string, unknown>;
}

/**
 * Pushes this client synthesises rather than receives. `sync` answers with bulk
 * shapes (a chat's replayed tail, the chats gained or lost while away); turning
 * them into the same per-event notifications a live connection produces means
 * the store has one definition of "an event arrived" instead of two.
 */
export type RtmClientAction =
  RtmPushAction | 'sync_truncated' | 'chat_unfollowed' | 'chat_appeared';

export type PushHandler = (action: RtmClientAction, payload: Record<string, unknown>) => void;

/**
 * The subset of `WebSocket` this client uses, as an interface so a test can be
 * the network. React Native's own `WebSocket` satisfies it.
 */
export interface RtmSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** The slice of `AppState` this client subscribes to. */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

export interface RtmClientOptions {
  /** Host only, e.g. `wss://rtm.example.com` — the path is protocol, not config. */
  baseUrl: string;
  organizationId: string;
  getToken: () => string | null;
  /**
   * Whether the session is over, as opposed to momentarily without a token.
   * Optional: a caller that cannot tell the two apart gets the safe half of the
   * behaviour (keep waiting), never a retry loop against a dead session — the
   * gateway's refusal already stops that (`#login`).
   */
  isSignedOut?: () => boolean;
  pushes: RtmPushAction[];
  onPush: PushHandler;
  onStatusChange?: (status: RtmStatus) => void;
  socketFactory?: (url: string) => RtmSocket;
  appState?: AppStateLike;
  /** Injectable so a test can pin the jitter instead of tolerating it. */
  random?: () => number;
}

export class MobileRtmClient {
  #socket: RtmSocket | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #appStateSubscription: { remove(): void } | null = null;
  #attempt = 0;
  #stopped = true;
  #requestCounter = 0;
  #status: RtmStatus = 'offline';

  readonly #pending = new Map<string, (message: RtmMessage) => void>();
  /** Last event durably seen per chat — the cursor `sync` replays from. */
  readonly #cursors = new Map<string, string>();

  readonly #options: RtmClientOptions;
  readonly #createSocket: (url: string) => RtmSocket;
  readonly #random: () => number;

  constructor(options: RtmClientOptions) {
    this.#options = options;
    this.#createSocket =
      options.socketFactory ?? ((url) => new WebSocket(url) as unknown as RtmSocket);
    this.#random = options.random ?? Math.random;
  }

  get status(): RtmStatus {
    return this.#status;
  }

  /** The cursor map as it would be sent to `sync`. */
  cursors(): Record<string, string> {
    return Object.fromEntries(this.#cursors);
  }

  /**
   * Record progress so a reconnect knows where to resume.
   *
   * Never moves a cursor backwards within a thread. The chat list seeds these
   * from `last_event`, and a list refresh landing after a newer event arrived
   * would otherwise rewind the cursor and have the server replay messages the
   * screen already shows. A *different* thread does replace it — the
   * conversation moved on, and the old position means nothing there.
   */
  noteEvent(chatId: string, eventId: string): void {
    const current = this.#cursors.get(chatId);
    if (current !== undefined && !isLaterInSameThread(current, eventId)) return;
    this.#cursors.set(chatId, eventId);
  }

  forgetChat(chatId: string): void {
    this.#cursors.delete(chatId);
  }

  connect(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    const appState = this.#options.appState ?? AppState;
    this.#appStateSubscription = appState.addEventListener('change', this.#onAppStateChange);
    this.#open();
  }

  disconnect(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#appStateSubscription?.remove();
    this.#appStateSubscription = null;
    this.#pending.clear();
    this.#closeSocket();
    this.#setStatus('offline');
  }

  /**
   * The agent is typing (FR-MOD-02.9). Fire-and-forget and only while live:
   * queuing indicators across a reconnect delivers a stale "is typing" the
   * moment the socket returns, which is worse than not sending one at all.
   */
  sendTyping(chatId: string, isTyping: boolean): void {
    if (this.#status !== 'live') return;
    void this.#send('send_typing_indicator', {
      chat_id: chatId,
      recipients: 'all',
      is_typing: isTyping,
    });
  }

  // --- Connection ------------------------------------------------------------

  #open(): void {
    const token = this.#options.getToken();
    if (token === null || token === '') {
      this.#waitForCredential();
      return;
    }

    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    const url =
      `${this.#options.baseUrl}${RTM_PATHS.agent}` +
      `?organization_id=${encodeURIComponent(this.#options.organizationId)}`;
    const socket = this.#createSocket(url);
    this.#socket = socket;

    socket.onopen = () => {
      void this.#login(token);
    };

    socket.onmessage = (event) => {
      this.#receive(event.data);
    };

    socket.onclose = () => {
      this.#clearTimers();
      this.#pending.clear();
      if (this.#stopped) return;
      this.#setStatus('reconnecting');
      this.#scheduleRetry();
    };

    // `close` always follows an error, and that is where reconnect lives.
    socket.onerror = () => {};
  }

  /**
   * There is nothing to dial with. Two very different situations wear that same
   * shape, and this used to return quietly for both:
   *
   *   - the session is over, and there will never be a token — retrying is a
   *     loop against a door that is closed on purpose;
   *   - a renewal is in flight, and `getAccessToken()` is null for the few
   *     hundred milliseconds it takes.
   *
   * The second one is the whole reason this method exists. Returning silently
   * left the socket closed with nothing scheduled to reopen it, so the client
   * sat offline until something unrelated happened to poke it — an app-state
   * change, which on a phone left in the foreground can be never. The agent's
   * REST calls kept working (the token renewed a moment later) while messages
   * silently stopped arriving, which is the exact failure this class exists to
   * prevent, arrived at from the other side.
   *
   * So the wait uses the same jittered backoff a dropped connection uses. The
   * status is left alone deliberately: after a drop it is already
   * `reconnecting`, and before the first connection `offline` is the truth —
   * "connecting" would claim a socket that was never opened.
   */
  #waitForCredential(): void {
    if (this.#options.isSignedOut?.() === true) {
      this.#setStatus('offline');
      return;
    }
    this.#scheduleRetry();
  }

  #receive(raw: unknown): void {
    let message: RtmMessage;
    try {
      message = JSON.parse(String(raw)) as RtmMessage;
    } catch {
      return;
    }

    if (message.type === 'response' && message.request_id !== undefined) {
      const settle = this.#pending.get(message.request_id);
      this.#pending.delete(message.request_id);
      settle?.(message);
      return;
    }

    if (message.type === 'push') {
      this.#trackCursor(message);
      this.#options.onPush(message.action as RtmClientAction, message.payload ?? {});
    }
  }

  async #login(token: string): Promise<void> {
    const resumed = this.#attempt > 0;
    const response = await this.#send('login', {
      token: `Bearer ${token}`,
      // How the gateway tells a resumed session from a fresh one; every attempt
      // after the first is a resumption by definition.
      reconnect: resumed,
      pushes: { [RTM_VERSION]: this.#options.pushes },
    });

    if (response.success !== true) {
      // The credential is wrong, revoked, or for another tenant. Retrying is a
      // loop; the session layer fixes this, not the socket.
      this.#stopped = true;
      this.#clearTimers();
      this.#closeSocket();
      this.#setStatus('offline');
      return;
    }

    this.#attempt = 0;
    this.#setStatus('live');
    this.#startPing();
    await this.#sync();
  }

  /**
   * The reason this class exists: recover everything sent while we were away.
   *
   * Cursor-based rather than time-based — several events can share a
   * millisecond, and the sequence inside the event id (`TJ1H8CFKRV_7`) has
   * exactly one answer for "everything after this".
   */
  async #sync(): Promise<void> {
    if (this.#cursors.size === 0) return;

    const response = await this.#send('sync', { cursors: this.cursors() });
    if (response.success !== true) return;

    const chats = asArray<{ chat_id?: unknown; events?: unknown; truncated?: unknown }>(
      response.payload['chats'],
    );

    for (const chat of chats) {
      const chatId = chat.chat_id;
      if (typeof chatId !== 'string') continue;

      for (const event of asArray<Record<string, unknown>>(chat.events)) {
        this.#options.onPush('incoming_event', { chat_id: chatId, event });
        const id = event['id'];
        if (typeof id === 'string') this.noteEvent(chatId, id);
      }

      // Too much to replay. Say so rather than leave a transcript with an
      // invisible hole in it — the screen refetches instead.
      if (chat.truncated === true) this.#options.onPush('sync_truncated', { chat_id: chatId });
    }

    for (const chatId of asArray<unknown>(response.payload['removed_chat_ids'])) {
      if (typeof chatId !== 'string') continue;
      this.#cursors.delete(chatId);
      this.#options.onPush('chat_unfollowed', { chat_id: chatId });
    }
    for (const chatId of asArray<unknown>(response.payload['new_chat_ids'])) {
      if (typeof chatId === 'string') this.#options.onPush('chat_appeared', { chat_id: chatId });
    }
  }

  #trackCursor(message: RtmMessage): void {
    if (message.action !== 'incoming_event') return;
    const chatId = message.payload['chat_id'];
    const event = message.payload['event'] as { id?: unknown } | undefined;
    if (typeof chatId === 'string' && typeof event?.id === 'string') {
      this.noteEvent(chatId, event.id);
    }
  }

  #send(action: string, payload: Record<string, unknown>): Promise<RtmMessage> {
    const requestId = `m${++this.#requestCounter}`;
    return new Promise((resolve) => {
      const settle = (message: RtmMessage): void => {
        clearTimeout(timer);
        resolve(message);
      };
      // Armed before the send, so a socket that throws still settles the caller
      // rather than leaving a `login` awaited forever.
      const timer = setTimeout(() => {
        if (this.#pending.delete(requestId)) {
          resolve({ action, type: 'response', success: false, payload: {} });
        }
      }, RTM_LIMITS.requestTimeoutMs);

      this.#pending.set(requestId, settle);
      try {
        this.#socket?.send(
          JSON.stringify({ version: RTM_VERSION, request_id: requestId, action, payload }),
        );
      } catch {
        if (this.#pending.delete(requestId)) {
          settle({ action, type: 'response', success: false, payload: {} });
        }
      }
    });
  }

  #startPing(): void {
    this.#stopPing();
    this.#pingTimer = setInterval(() => {
      void this.#send('ping', {});
    }, RTM_LIMITS.pingIntervalMs);
  }

  /**
   * Exponential backoff with full jitter. Without the jitter a gateway restart
   * brings every phone back at the same instant, and the stampede extends the
   * outage it is reacting to.
   */
  #scheduleRetry(): void {
    this.#attempt += 1;
    const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (this.#attempt - 1), MAX_BACKOFF_MS);
    this.#retryTimer = setTimeout(() => this.#open(), this.#random() * ceiling);
  }

  /**
   * Coming back from the background. The OS froze this process, so whatever the
   * socket believes about itself is stale: tear it down and dial again rather
   * than wait out a ping interval on a connection that is already gone.
   */
  readonly #onAppStateChange = (state: AppStateStatus): void => {
    if (state !== 'active' || this.#stopped || this.#status === 'connecting') return;
    this.#clearTimers();
    this.#pending.clear();
    this.#closeSocket();
    this.#attempt = 0;
    this.#setStatus('reconnecting');
    this.#open();
  };

  #closeSocket(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket === null) return;
    // Detached first: the close we are asking for is not a disconnection to
    // react to, and leaving the handler attached would schedule a retry for a
    // socket we are replacing on purpose.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  #stopPing(): void {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #clearTimers(): void {
    this.#stopPing();
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #setStatus(status: RtmStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatusChange?.(status);
  }
}

/**
 * Whether `candidate` sits further along the same thread than `current`.
 *
 * Event ids are `<threadId>_<sequence>`, so this is a numeric comparison rather
 * than a string one — `_10` sorts before `_2` lexically, which would silently
 * rewind a cursor past nine events.
 */
function isLaterInSameThread(current: string, candidate: string): boolean {
  const a = splitEventId(current);
  const b = splitEventId(candidate);
  if (a === null || b === null) return true;
  if (a.threadId !== b.threadId) return true;
  return b.sequence > a.sequence;
}

function splitEventId(eventId: string): { threadId: string; sequence: number } | null {
  const separator = eventId.lastIndexOf('_');
  if (separator < 0) return null;
  const sequence = Number(eventId.slice(separator + 1));
  if (!Number.isInteger(sequence)) return null;
  return { threadId: eventId.slice(0, separator), sequence };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
