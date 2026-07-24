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
  attachment_url: string | null;
}

export interface WidgetState {
  online: boolean;
  customer: { id: string; name: string | null; email: string | null };
  /** Who the visitor is talking to — a person or the AI persona. */
  agent: { name: string; avatar_url: string | null } | null;
  chat: { id: string; thread_id: string | null; queue_position: number | null } | null;
  events: WidgetEvent[];
}

export class WidgetApi {
  #token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly organizationId: string,
    /**
     * Origin of the page the widget is embedded in. Sent because this request
     * comes from inside the iframe, whose own origin is Nexa's and therefore
     * identical for every customer — it cannot say which site opened the chat.
     */
    private readonly hostOrigin: string | null = null,
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
        ...(this.hostOrigin ? { host_origin: this.hostOrigin } : {}),
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
    options: { url?: string; name?: string; email?: string; attachment_url?: string } = {},
  ): Promise<{ chat_id: string; event: WidgetEvent | null }> {
    return this.#request('POST', '/customer/chat/events', {
      // An attachment may travel without text (FR-MOD-11.4), so an empty string
      // is omitted rather than sent — the server requires text *or* attachment.
      ...(text ? { text } : {}),
      ...options,
      // Survives a retry after a timeout without posting the message twice.
      idempotency_key: randomKey(),
    });
  }

  /**
   * Grant → signed PUT, the same two-step upload the agent app uses. Returns the
   * `file_url` to hang on the message's `attachment_url`.
   */
  async upload(file: File): Promise<string> {
    const grant = await this.#request<{ upload_url: string; file_url: string }>(
      'POST',
      '/uploads',
      { filename: file.name, content_type: file.type, size_bytes: file.size },
    );
    // The PUT is authorised by the signature in the URL, not the token, and its
    // body is raw bytes. `upload_url` is root-relative; resolve it against the
    // API base so it does not hit the widget's own origin.
    const response = await fetch(new URL(grant.upload_url, this.baseUrl).toString(), {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!response.ok) throw new WidgetApiError(await describe(response));
    return grant.file_url;
  }

  /** Fetch an attachment's bytes with the token, for inline rendering. */
  async fetchAttachment(url: string): Promise<Blob> {
    if (!this.#token) throw new WidgetApiError('not connected');
    const response = await fetch(new URL(url, this.baseUrl).toString(), {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (!response.ok) throw new WidgetApiError(await describe(response));
    return response.blob();
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
