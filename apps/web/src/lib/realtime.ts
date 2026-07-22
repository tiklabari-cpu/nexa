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
import type { RtmPushAction } from '@nexa/types';

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
  getToken: () => string | null;
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
      void this.#login(token);
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
      this.#clearTimers();
      if (this.#closedByUs) return;
      this.#setStatus('reconnecting');
      this.#scheduleRetry();
    });

    ws.addEventListener('error', () => {
      // `close` always follows, and that is where reconnect is handled.
    });
  }

  async #login(token: string): Promise<void> {
    const response = await this.#send('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': this.options.pushes },
    });

    if (!response.success) {
      // Credentials are wrong or revoked; retrying would loop forever.
      this.#closedByUs = true;
      this.#setStatus('offline');
      this.#ws?.close();
      return;
    }

    this.#attempt = 0;
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
