/**
 * Customer Chat API client for the widget.
 *
 * Keeps its own tiny client rather than sharing the agent app's: the widget has
 * a hard 50 KB budget (NFR-P3) and the agent client pulls in error taxonomy,
 * retry policy and typed routes it will never use.
 */

export interface WidgetEvent {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
}

export interface WidgetState {
  online: boolean;
  customer: { id: string; name: string | null; email: string | null };
  chat: { id: string; thread_id: string | null; queue_position: number | null } | null;
  events: WidgetEvent[];
}

export class WidgetApi {
  #token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly organizationId: string,
  ) {}

  get authenticated(): boolean {
    return this.#token !== null;
  }

  /**
   * Exchange the organization id for a short-lived customer token.
   *
   * The customer id is kept in localStorage so a returning visitor continues
   * the same conversation. It is not a secret — it identifies, it does not
   * authorize; the token does that, and is re-minted on every load.
   */
  async connect(): Promise<WidgetState> {
    const stored = safeGetItem('nexa.customer_id');

    const response = await fetch(`${this.baseUrl}/customer/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organization_id: this.organizationId,
        ...(stored ? { customer_id: stored } : {}),
      }),
    });
    if (!response.ok) throw new WidgetApiError(await describe(response));

    const { token, customer_id } = (await response.json()) as {
      token: string;
      customer_id: string;
    };
    this.#token = token;
    safeSetItem('nexa.customer_id', customer_id);

    return this.state();
  }

  async state(): Promise<WidgetState> {
    return this.#request<WidgetState>('GET', '/customer/chat');
  }

  async send(
    text: string,
    options: { url?: string; name?: string; email?: string } = {},
  ): Promise<{ chat_id: string; event: WidgetEvent | null }> {
    return this.#request('POST', '/customer/chat/events', {
      text,
      ...options,
      // Survives a retry after a timeout without posting the message twice.
      idempotency_key: randomKey(),
    });
  }

  async rate(value: 'good' | 'bad'): Promise<void> {
    await this.#request('POST', '/customer/chat/rating', { value });
  }

  async close(): Promise<void> {
    await this.#request('POST', '/customer/chat/close');
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.#token) throw new WidgetApiError('not connected');

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (response.status === 401) {
      // The token expired mid-session. Re-mint and retry once, so a visitor who
      // left the tab open overnight is not silently unable to reply.
      this.#token = null;
      await this.connect();
      return this.#request<T>(method, path, body);
    }
    if (!response.ok) throw new WidgetApiError(await describe(response));
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }
}

export class WidgetApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetApiError';
  }
}

async function describe(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

/**
 * Storage can throw: Safari private mode, and any browser where the user has
 * blocked site data. A widget that crashes because it could not remember a
 * visitor id is worse than one that forgets them.
 */
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignored — the visitor simply gets a new identity next load.
  }
}

function randomKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
