/**
 * RTM client for the agent app.
 *
 * Two things make this more than a `new WebSocket(...)` wrapper:
 *
 * **Reconnect is lossless.** The client remembers the last event it saw per
 * chat and replays from there via `sync` on every reconnect. Without that, a
 * four-second network blip during a handover silently costs the agent a
 * customer's message — and nothing on screen would suggest anything was missed.
 *
 * **Backoff is bounded and jittered.** A server restart otherwise means every
 * connected agent reconnecting in lockstep, which is how a brief outage becomes
 * a long one.
 */
import type { RtmPushAction } from '@siyahtus/types';

const PING_INTERVAL_MS = 15_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

export interface RtmMessage {
  request_id?: string;
  action: string;
  type: 'response' | 'push';
  success?: boolean;
  payload: Record<string, unknown>;
}

export type PushHandler = (action: string, payload: Record<string, unknown>) => void;

export interface RtmClientOptions {
  url: string;
  organizationId: string;
  /** Read at every (re)connect, never captured — the session renews it underneath. */
  getToken: () => string | null;
  /**
   * A fresh token after `stale` was refused at `login`, or null when the
   * session is over (tm 259.1). The gateway checks the token at `login` only,
   * so this is reached by a *re*connect: a page that slept past its renewal
   * comes back to a dropped socket holding the token it had.
   */
  renewToken?: (stale: string) => Promise<string | null>;
  pushes: RtmPushAction[];
  onPush: PushHandler;
  onStatusChange?: (status: RtmStatus) => void;
}

export type RtmStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export class RtmClient {
  #ws: WebSocket | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #closedByUs = false;
  /** A refused login has been answered with a renewal since the last good one — once is the limit. */
  #renewed = false;
  #requestId = 0;
  #pending = new Map<string, (message: RtmMessage) => void>();

  /** Last event seen per chat — the cursor `sync` replays from. */
  #cursors = new Map<string, string>();
  #status: RtmStatus = 'offline';

  constructor(private readonly options: RtmClientOptions) {}

  get status(): RtmStatus {
    return this.#status;
  }

  /** Record progress so a reconnect knows where to resume. */
  noteEvent(chatId: string, eventId: string): void {
    this.#cursors.set(chatId, eventId);
  }

  /**
   * Tell the other side the agent is typing (FR-MOD-02.9).
   *
   * Fire-and-forget: a dropped indicator is cosmetic, and awaiting one would
   * stall the composer. Sent only while the socket is live — queuing them across
   * a reconnect would deliver stale "is typing" the moment it comes back.
   */
  sendTyping(chatId: string, isTyping: boolean): void {
    if (this.#status !== 'live') return;
    void this.#send('send_typing_indicator', {
      chat_id: chatId,
      recipients: 'all',
      is_typing: isTyping,
    });
  }

  connect(): void {
    this.#closedByUs = false;
    this.#open();
  }

  disconnect(): void {
    this.#closedByUs = true;
    this.#clearTimers();
    this.#ws?.close();
    this.#ws = null;
    this.#setStatus('offline');
  }

  #open(): void {
    const token = this.options.getToken();
    if (!token) return;

    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    const url = `${this.options.url}?organization_id=${encodeURIComponent(this.options.organizationId)}`;
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.addEventListener('open', () => {
      void this.#login(ws, token);
    });

    ws.addEventListener('message', (event) => {
      let message: RtmMessage;
      try {
        message = JSON.parse(String(event.data)) as RtmMessage;
      } catch {
        return;
      }

      if (message.type === 'response' && message.request_id) {
        this.#pending.get(message.request_id)?.(message);
        this.#pending.delete(message.request_id);
        return;
      }
      if (message.type === 'push') {
        this.#trackCursor(message);
        this.options.onPush(message.action, message.payload);
      }
    });

    ws.addEventListener('close', () => {
      // A socket this client has already replaced — closed on purpose after a
      // renewal — must not tear down its successor's timers or schedule a
      // reconnect on top of a live connection.
      if (ws !== this.#ws) return;
      this.#clearTimers();
      if (this.#closedByUs) return;
      this.#setStatus('reconnecting');
      this.#scheduleRetry();
    });

    ws.addEventListener('error', () => {
      // `close` always follows, and that is where reconnect is handled.
    });
  }

  async #login(ws: WebSocket, token: string): Promise<void> {
    const response = await this.#send('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': this.options.pushes },
    });
    // Replaced while the answer was on its way: the newer socket decides.
    if (ws !== this.#ws) return;

    if (!response.success) {
      if (await this.#reopenWithRenewedToken(response, token)) return;
      // Credentials are wrong or revoked; retrying would loop forever.
      this.#closedByUs = true;
      this.#setStatus('offline');
      this.#ws?.close();
      return;
    }

    this.#attempt = 0;
    this.#renewed = false;
    this.#setStatus('live');
    this.#startPing();

    // The reason this class exists: recover anything sent while we were away.
    if (this.#cursors.size > 0) {
      const sync = await this.#send('sync', {
        cursors: Object.fromEntries(this.#cursors),
      });
      if (sync.success) this.#applySync(sync.payload);
    }
  }

  /**
   * Answer a login refused for its token with one renewal and a fresh socket
   * (tm 259.1). True when the refusal has been dealt with — a new connection is
   * on its way, or somebody else's decision stands — and false when the client
   * should go offline as before.
   *
   * Only an `authentication` refusal: a wrong region or a malformed frame is
   * not something a new token changes. And once until a login succeeds — a
   * token minted a moment ago and refused anyway means the session is over,
   * not stale, and asking again would loop.
   */
  async #reopenWithRenewedToken(response: RtmMessage, stale: string): Promise<boolean> {
    const error = response.payload['error'] as { type?: unknown } | undefined;
    if (error?.type !== 'authentication' || !this.options.renewToken || this.#renewed) {
      return false;
    }
    this.#renewed = true;
    const refused = this.#ws;

    let renewed: string | null;
    try {
      renewed = await this.options.renewToken(stale);
    } catch {
      // The renewal itself failed — the network, the server — which says
      // nothing about the session. Back off and try it all again, as for any
      // dropped connection. (The panel's own renewal waits out such a failure
      // instead of throwing it, tm 259.2; a `renewToken` that throws still lands here.)
      if (this.#closedByUs || refused !== this.#ws) return true;
      this.#renewed = false;
      this.#replace(refused);
      this.#setStatus('reconnecting');
      this.#scheduleRetry();
      return true;
    }
    // Disconnected meanwhile, or already replaced: not this call's to act on.
    if (this.#closedByUs || refused !== this.#ws) return true;
    // The session is over; the shell is on its way to the sign-in page.
    if (renewed === null) return false;

    // At once rather than after a backoff: nothing is wrong with the gateway,
    // only with the token it was shown.
    this.#replace(refused);
    this.#open();
    return true;
  }

  /** Drop `socket` without its `close` scheduling a reconnect — the caller does that. */
  #replace(socket: WebSocket | null): void {
    this.#clearTimers();
    this.#ws = null;
    socket?.close();
  }

  #applySync(payload: Record<string, unknown>): void {
    const chats = (payload['chats'] ?? []) as Array<{
      chat_id: string;
      events: Array<Record<string, unknown>>;
      truncated: boolean;
    }>;

    for (const chat of chats) {
      for (const event of chat.events) {
        this.options.onPush('incoming_event', {
          chat_id: chat.chat_id,
          event,
        });
        if (typeof event['id'] === 'string') this.#cursors.set(chat.chat_id, event['id']);
      }
      if (chat.truncated) {
        // Too much to replay — tell the UI to refetch rather than showing a
        // transcript with an invisible hole in it.
        this.options.onPush('sync_truncated', { chat_id: chat.chat_id });
      }
    }

    for (const chatId of (payload['removed_chat_ids'] ?? []) as string[]) {
      this.#cursors.delete(chatId);
      this.options.onPush('chat_unfollowed', { chat_id: chatId });
    }
    for (const chatId of (payload['new_chat_ids'] ?? []) as string[]) {
      this.options.onPush('chat_appeared', { chat_id: chatId });
    }
  }

  #trackCursor(message: RtmMessage): void {
    if (message.action !== 'incoming_event') return;
    const chatId = message.payload['chat_id'];
    const event = message.payload['event'] as { id?: unknown } | undefined;
    if (typeof chatId === 'string' && typeof event?.id === 'string') {
      this.#cursors.set(chatId, event.id);
    }
  }

  #send(action: string, payload: Record<string, unknown>): Promise<RtmMessage> {
    const requestId = `c${++this.#requestId}`;
    return new Promise((resolve) => {
      this.#pending.set(requestId, resolve);
      this.#ws?.send(JSON.stringify({ version: '3.6', request_id: requestId, action, payload }));

      // Never leave a caller hanging: the socket may die mid-request.
      setTimeout(() => {
        if (this.#pending.delete(requestId)) {
          resolve({ action, type: 'response', success: false, payload: {} });
        }
      }, 15_000);
    });
  }

  #startPing(): void {
    this.#pingTimer = setInterval(() => {
      void this.#send('ping', {});
    }, PING_INTERVAL_MS);
  }

  /**
   * Exponential backoff with full jitter. Without the jitter, a server restart
   * brings every agent back at the same instant and the stampede extends the
   * outage it is reacting to.
   */
  #scheduleRetry(): void {
    this.#attempt += 1;
    const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (this.#attempt - 1), MAX_BACKOFF_MS);
    const delay = Math.random() * ceiling;
    this.#retryTimer = setTimeout(() => this.#open(), delay);
  }

  #clearTimers(): void {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#pingTimer = null;
    this.#retryTimer = null;
  }

  #setStatus(status: RtmStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.options.onStatusChange?.(status);
  }
}
