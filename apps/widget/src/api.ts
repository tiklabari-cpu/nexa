/**
 * Customer Chat API client for the widget.
 *
 * Keeps its own tiny client rather than sharing the agent app's: the widget has
 * a hard 50 KB budget (NFR-P3) and the agent client pulls in error taxonomy,
 * retry policy and typed routes it will never use.
 */

import {
  DEFAULT_PRECHAT_CONFIG,
  normalizePrechatConfig,
  type PrechatConfig,
  type WidgetFormField,
  type WidgetAppearance,
  type WidgetLauncherVisibility,
  type WidgetTokenAppearance,
  type ChallengeRequiredDetails,
  type ChallengeReason,
} from '@siyahtus/types';

/**
 * Shows the human check a `403 challenge_required` asked for (tm 339.3 · GV-01)
 * and resolves with the provider's token — or null when the visitor gave up.
 * `reason` is `challenge_failed` when the token just sent was refused, which is
 * the cue to show the check again rather than a fresh one.
 */
export type ChallengeHandler = (details: ChallengeRequiredDetails) => Promise<string | null>;

/** How many times one request is retried behind a check before it gives up. */
const MAX_CHALLENGE_ROUNDS = 3;

/**
 * The appearance off a token mint. The two footer links are optional on the
 * wire: a deployment predating them omits both, and the widget then shows the
 * footer text without links rather than guessing an address.
 */
export type MintedAppearance = WidgetAppearance &
  Partial<
    Pick<WidgetTokenAppearance, 'privacy_policy_url' | 'powered_by_url' | 'logo_url' | 'brand_name'>
  >;

/** A brand's own widget texts for one language, off a token mint (WG-05). */
export interface MintedPhrases {
  locale: string;
  phrases: Record<string, string>;
}

export interface WidgetEvent {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  /**
   * Who wrote it, as the server names them. The widget reads it for one thing:
   * `bot` is three different authors (the LLM AI Agent, a rule bot, an API bot
   * token) and only this id says which, so it is what the "AI" mark keys on.
   */
  author_id?: string | null;
  created_at: string;
  type: string;
  attachment_url: string | null;
  /**
   * Free-form event metadata. The widget reads two keys from it — `edited_at`,
   * which the server stamps when the agent corrects a message already sent
   * (FR-MOD-02.3.7), and a system notice's `system_event`, which marks the
   * sensitive-data warning (tm 300.2) — and is optional because the poll and
   * the socket both predate it and a server that has not sent it is not an error.
   */
  properties?: Record<string, unknown>;
}

/** The order fields `POST /customer/chat/sale` accepts (FR-MOD-13.5). */
export interface TrackSaleInput {
  external_order_id: string;
  amount_cents: number;
  currency: string;
}

/**
 * A message left when nobody is available (FR-MOD-08.7.7). The two answer maps
 * are kept apart because their destinations are: `ticket_fields` are about the
 * request and land on the ticket this opens, `prospect_fields` are about the
 * person and land on the contact.
 */
export interface LeaveTicketInput {
  subject: string;
  name?: string;
  email: string;
  ticket_fields?: Record<string, string>;
  prospect_fields?: Record<string, string>;
}

export interface WidgetState {
  online: boolean;
  /**
   * Whether a chat is offered rather than the offline form (WG-09), and who
   * answers now. Absent from a server predating them.
   */
  can_start_chat?: boolean;
  answered_by?: 'human' | 'ai' | 'none';
  /** Whether an agent is mid-reply, for the "…is typing" line (FR-MOD-02.9). */
  agent_typing?: boolean;
  customer: { id: string; name: string | null; email: string | null };
  /** Who the visitor is talking to — a person or the AI persona. */
  agent: { name: string; avatar_url: string | null } | null;
  chat: {
    id: string;
    thread_id: string | null;
    queue_position: number | null;
    /** Roughly how long the queue still is, in minutes (WG-05); absent from an older server. */
    estimated_wait?: { min_minutes: number; max_minutes: number } | null;
  } | null;
  /**
   * A proactive campaign message owed to this visitor (FR-MOD-03.3.2), handed
   * over on this poll and stamped delivered server-side in the same request —
   * at-most-once, so the same `id` never arrives twice (`campaign-delivery.ts`).
   */
  campaign: { id: string; message: string } | null;
  events: WidgetEvent[];
  /**
   * Who has the open connection (tm 308 · AI-29): "Talk to an agent" shows
   * while it is `ai`. Absent from a server predating it: no button.
   */
  owner?: 'ai' | 'human' | 'queue' | null;
  /** Whether anyone is accepting chats now. */
  human_available?: boolean;
  /** The button's words, resolved by the server (the workspace's or its default). */
  human_button_label?: string | null;
}

/** The answer to "is it solved?" as the server kept it (tm 320.1 · AI-25-S2). */
export interface ResolutionAnswerResult {
  answer: 'yes' | 'no';
  /** False when the AI no longer had the connection, or nothing asked. */
  recorded: boolean;
  owner: 'ai' | 'human' | 'queue';
  human_available: boolean;
}

/** What a press of "Talk to an agent" left the connection with (tm 308). */
export interface HumanRequestResult {
  owner: 'ai' | 'human' | 'queue';
  human_available: boolean;
  requested: boolean;
}

export class WidgetApi {
  #token: string | null = null;
  #rtmUrl: string | null = null;
  #appearance: MintedAppearance | null = null;
  /**
   * Whether the licence allows attachments (FR-MOD-08.9.4). Starts `true` —
   * the schema default, and the state the attach button is already in before
   * the first connect — so a visitor who opens the panel and picks a file
   * before the mint resolves meets the same server refusal as before; it
   * only ever narrows once the real value is known.
   */
  #fileSharingEnabled = true;
  /**
   * The built-in pre-chat form (WG-01) from the last mint. Starts as today's
   * form — open, all four required — which is also what a server predating
   * the setting means by sending nothing.
   */
  #prechat: PrechatConfig = DEFAULT_PRECHAT_CONFIG;
  #preChatForm: WidgetFormField[] = [];
  #postChatForm: WidgetFormField[] = [];
  #ticketForm: WidgetFormField[] = [];
  #prospectForm: WidgetFormField[] = [];
  /** The mint in flight, which `forget` lets land before it forgets anything. */
  #minting: Promise<void> | null = null;
  /** Set by `forget`: this instance speaks for nobody any more. */
  #forgotten = false;
  /** Asked for a token when the API answers `challenge_required`; unset = the error surfaces. */
  #challenge: ChallengeHandler | null = null;
  /**
   * The brand's own texts for one language (WG-05) from the last mint, or null
   * from a server predating them.
   */
  #phrases: MintedPhrases | null = null;
  /**
   * What the mint is told about the visitor's language (WG-05) so it can pick
   * the custom texts of the language the widget will show: the snippet's
   * `data-language` and the browser's languages.
   */
  localeHints: { language?: string; browser: readonly string[] } = { browser: [] };

  /**
   * Teach this client to answer a `403 challenge_required` (tm 339.3): the
   * handler shows the check, the request is repeated with its token as
   * `challenge_token`. Without one the error reaches the caller as before.
   */
  onChallenge(handler: ChallengeHandler | null): void {
    this.#challenge = handler;
  }

  /**
   * The credential the socket logs in with (FR-MOD-11.6), or null before the
   * first mint.
   *
   * Exposed rather than passed to the socket once, because it is replaced: a
   * customer token is short-lived and `#request` re-mints on the first 401. A
   * socket handed a copy at construction would keep presenting a token that had
   * already been retired — read it at each connection attempt instead.
   */
  get token(): string | null {
    return this.#token;
  }

  /**
   * Where the realtime gateway takes customer sockets (FR-MOD-11.6), from the
   * last token mint, or null when the server did not name one. Null is a
   * supported answer, not a fault: the widget then stays on the polling path it
   * has always had.
   */
  get rtmUrl(): string | null {
    return this.#rtmUrl;
  }

  /**
   * The workspace's widget appearance from the last token mint (FR-MOD-11.7), or
   * null before the first connect. The server is the source of truth, so this
   * corrects a stale baked snippet and is the only source the hosted Chat page —
   * which has no snippet — has at all.
   */
  get appearance(): MintedAppearance | null {
    return this.#appearance;
  }

  /** The brand's custom texts from the last mint (WG-05), for the language it names. */
  get phrases(): MintedPhrases | null {
    return this.#phrases;
  }

  /** The last token mint's file-sharing switch (FR-MOD-08.9.4). */
  get fileSharingEnabled(): boolean {
    return this.#fileSharingEnabled;
  }

  /** The brand's built-in pre-chat form from the last token mint (WG-01). */
  get prechat(): PrechatConfig {
    return this.#prechat;
  }

  /**
   * The workspace's pre-chat form fields from the last token mint
   * (FR-MOD-08.7.7), or an empty list before connect / when none are configured.
   * The widget renders one input per field and rides the answers along with the
   * visitor's first message.
   */
  get preChatForm(): WidgetFormField[] {
    return this.#preChatForm;
  }

  /**
   * The workspace's post-chat form fields from the last token mint
   * (FR-MOD-08.7.7), or an empty list before connect / when none are configured.
   * Delivered at mint rather than fetched when the conversation ends: the widget
   * learns a chat closed from a poll it does not control, and the form has to be
   * on screen at that moment, not a round-trip later.
   */
  get postChatForm(): WidgetFormField[] {
    return this.#postChatForm;
  }

  /**
   * The questions about the *request*, asked when nobody is available and the
   * visitor leaves a message instead (FR-MOD-08.7.7). Empty before connect and
   * for a workspace that has built no offline form — in which case the widget
   * shows no panel at all, which is what makes the surface opt-in.
   */
  get ticketForm(): WidgetFormField[] {
    return this.#ticketForm;
  }

  /** The questions about the *person*, asked on that same screen. */
  get prospectForm(): WidgetFormField[] {
    return this.#prospectForm;
  }

  constructor(
    private readonly baseUrl: string,
    private readonly organizationId: string,
    /**
     * Origin of the page the widget is embedded in. Sent because this request
     * comes from inside the iframe, whose own origin is SiyahTuş's and therefore
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
   * A returning visitor is recognised by the member token the server signed
   * for this browser (ID-03 · K4), and nothing else — the server re-signs it on
   * every load, so it lives as long as the visitor keeps coming back. It
   * travels two ways (tm 287.3):
   *
   *   - **The cookie** (`siyahtus_member_<organization>`, `HttpOnly`,
   *     `Partitioned`), which the browser keeps and sends on its own — but
   *     only on a credentialed request, hence `credentials: 'include'`. No
   *     script here can read it, which is the point.
   *   - **The copy in localStorage**, for a browser that will not keep the
   *     cookie. The server leaves the token out of its answer exactly when the
   *     cookie carried it, and the copy is deleted then: where the cookie
   *     works, the token lives only where no script can reach it.
   *
   * Both are per organization: a partition is per embedding site, and every
   * workspace's hosted Chat page shares the widget's own site — one shared
   * slot would have each workspace overwrite the other's member.
   *
   * The customer id is kept per organization too, but it identifies, it does
   * not authenticate: it only says this browser has been here before
   * (`isReturningVisitor`). A browser from before member tokens holds the old
   * un-keyed id and sends it, without a token, for the one trade the server
   * allows during the transition.
   */
  /**
   * How the launcher is drawn (WG-10), asked before any mint: a first-time
   * visitor is not minted for until they open the panel, yet the bubble has to
   * be right from the first paint. Null on any failure — the caller keeps what
   * it had. Remembered for the next page load, which draws from it at once.
   */
  async launcher(): Promise<WidgetLauncherVisibility | null> {
    try {
      const query = new URLSearchParams({ organization_id: this.organizationId });
      if (this.hostOrigin) query.set('host_origin', this.hostOrigin);
      const response = await fetch(`${this.baseUrl}/customer/launcher?${query}`);
      // A refusal is an error envelope: no `launcher_visibility` in it, so null.
      const body = (await response.json()) as { launcher_visibility?: unknown };
      return rememberLauncher(this.organizationId, body.launcher_visibility);
    } catch {
      return null;
    }
  }

  async connect(): Promise<WidgetState> {
    // Signed out (`forget`): the next visitor gets a fresh instance in a
    // fresh document — this one must not mint for them, not even on a 401.
    if (this.#forgotten) throw new WidgetApiError('signed out');
    const minting = this.#mint();
    this.#minting = minting;
    try {
      await minting;
    } finally {
      if (this.#minting === minting) this.#minting = null;
    }
    return this.state();
  }

  async #mint(): Promise<void> {
    const keys = storageKeys(this.organizationId);
    // Read only by a workspace this browser has not met under its own keys
    // yet: whatever a widget from before tm 287.3 left in the shared slot.
    const met = safeGetItem(keys.customerId) !== null;
    const legacyToken = met ? null : safeGetItem(LEGACY_MEMBER_TOKEN_KEY);
    const legacyId = met ? null : safeGetItem(LEGACY_CUSTOMER_ID_KEY);
    const memberToken = safeGetItem(keys.memberToken) ?? legacyToken;
    const stored = memberToken ? null : legacyId;

    // A script minting identities from one address is asked for a check here
    // (tm 339.2); a normal visitor never is, and the request goes out once.
    const response = await this.#behindChallenge(async (challengeToken) => {
      const attempt = await fetch(`${this.baseUrl}/customer/token`, {
        method: 'POST',
        // The member cookie rides only a credentialed request; the API answers
        // the widget's origin by name with `Access-Control-Allow-Credentials`.
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization_id: this.organizationId,
          ...(memberToken ? { member_token: memberToken } : {}),
          ...(stored ? { customer_id: stored } : {}),
          ...(this.hostOrigin ? { host_origin: this.hostOrigin } : {}),
          ...(challengeToken ? { challenge_token: challengeToken } : {}),
          // Hints only, and never a reason to refuse the token: what the
          // server would not take (over-long tags) is left out.
          ...(this.localeHints.language && this.localeHints.language.length <= 35
            ? { language: this.localeHints.language }
            : {}),
          browser_languages: this.localeHints.browser
            .filter((tag) => tag.length <= 35)
            .slice(0, 10),
        }),
      });
      if (!attempt.ok) throw await failure(attempt);
      return attempt;
    });

    const {
      token,
      customer_id,
      member_token,
      rtm_url,
      widget,
      file_sharing_enabled,
      prechat,
      pre_chat_form,
      post_chat_form,
      ticket_form,
      prospect_form,
      widget_phrases,
    } = (await response.json()) as {
      token: string;
      customer_id: string;
      member_token?: string;
      rtm_url?: string;
      widget?: MintedAppearance;
      file_sharing_enabled?: boolean;
      prechat?: unknown;
      pre_chat_form?: WidgetFormField[];
      post_chat_form?: WidgetFormField[];
      ticket_form?: WidgetFormField[];
      prospect_form?: WidgetFormField[];
      widget_phrases?: MintedPhrases;
    };
    this.#token = token;
    this.#rtmUrl = typeof rtm_url === 'string' && rtm_url !== '' ? rtm_url : null;
    if (widget) {
      this.#appearance = widget;
      rememberLauncher(this.organizationId, widget.launcher_visibility);
    }
    if (typeof file_sharing_enabled === 'boolean') this.#fileSharingEnabled = file_sharing_enabled;
    this.#prechat = normalizePrechatConfig(prechat);
    this.#preChatForm = Array.isArray(pre_chat_form) ? pre_chat_form : [];
    this.#postChatForm = Array.isArray(post_chat_form) ? post_chat_form : [];
    this.#ticketForm = Array.isArray(ticket_form) ? ticket_form : [];
    this.#prospectForm = Array.isArray(prospect_form) ? prospect_form : [];
    this.#phrases =
      widget_phrases && typeof widget_phrases.phrases === 'object' ? widget_phrases : null;
    // Absent exactly when the cookie carried the token: it then lives only
    // where no script can read it, and the copy here goes. Present otherwise —
    // the fallback for a browser that would not keep that cookie.
    if (typeof member_token === 'string' && member_token !== '') {
      safeSetItem(keys.memberToken, member_token);
    } else {
      safeRemoveItem(keys.memberToken);
    }
    safeSetItem(keys.customerId, customer_id);
    // The shared slot was this workspace's if the server just recognised the
    // customer it names; it has moved under this workspace's keys. Anything
    // else in it is another workspace's to collect, so it stays.
    if (legacyId !== null && legacyId === customer_id) {
      safeRemoveItem(LEGACY_MEMBER_TOKEN_KEY);
      safeRemoveItem(LEGACY_CUSTOMER_ID_KEY);
    }
  }

  /**
   * Make this browser forget its visitor — the widget's half of the host
   * page's `siyahtus('logout')` (ID-03 · K4 · tm 287.3). Never throws.
   *
   * Every workspace's identity on this site goes, not only this one's: the
   * host page signed its user out, and the next person at this browser must
   * not be recognised as them by any widget on it. The localStorage copies are
   * deleted here; the cookies are `HttpOnly`, so only the API can expire them,
   * which `DELETE /customer/token` does for every one the browser sends.
   *
   * Nothing is revoked: a token copied off this browser stays valid until it
   * expires or an agent revokes the member. The cookie request is
   * best-effort — if it fails the cookie survives, and the next load is
   * recognised as the old member — so the failure is logged, not hidden.
   */
  async forget(): Promise<void> {
    this.#forgotten = true;
    // A mint already out lands first: forgetting before it would leave the
    // copy it writes and the cookie it brings back.
    await this.#minting?.catch(() => undefined);
    this.#token = null;
    forgetStoredIdentities();
    try {
      const response = await fetch(`${this.baseUrl}/customer/token`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new WidgetApiError(`request failed (${response.status})`);
    } catch (error) {
      console.warn('siyahtus widget: could not expire the member cookie', error);
    }
  }

  async state(): Promise<WidgetState> {
    return this.#request<WidgetState>('GET', '/customer/chat');
  }

  async send(
    text: string,
    options: {
      url?: string;
      /** Where the visitor arrived from — the visit's `came_from` (FR-MOD-13.2). */
      referrer?: string;
      name?: string;
      /** The visitor's username on the embedding site, from the pre-chat form. */
      username?: string;
      email?: string;
      /** The language the widget is showing — for the visitor's transcript e-mail (WG-02). */
      locale?: string;
      attachment_url?: string;
      /** Pre-chat form answers: contact custom-field id → value (FR-MOD-08.7.7). */
      custom_fields?: Record<string, string>;
    } = {},
  ): Promise<{ chat_id: string; event: WidgetEvent | null }> {
    // One key for every round: a retry behind a check must not post twice.
    const idempotencyKey = randomKey();
    return this.#behindChallenge((challengeToken) =>
      this.#request('POST', '/customer/chat/events', {
        // An attachment may travel without text (FR-MOD-11.4), so an empty string
        // is omitted rather than sent — the server requires text *or* attachment.
        ...(text ? { text } : {}),
        ...options,
        // Survives a retry after a timeout without posting the message twice.
        idempotency_key: idempotencyKey,
        ...(challengeToken ? { challenge_token: challengeToken } : {}),
      }),
    );
  }

  /**
   * Run `attempt`; if the API answers `403 challenge_required`, show the check
   * and run it again with the token, a few rounds at most. A refused token comes
   * back as the same error (`reason: challenge_failed`), which asks again.
   */
  async #behindChallenge<T>(attempt: (challengeToken?: string) => Promise<T>): Promise<T> {
    let token: string | undefined;
    for (let round = 0; ; round += 1) {
      try {
        return await attempt(token);
      } catch (error) {
        const details = challengeDetails(error);
        if (!details || !this.#challenge || round >= MAX_CHALLENGE_ROUNDS) throw error;
        const next = await this.#challenge(details);
        if (!next) throw error;
        token = next;
      }
    }
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
    if (!response.ok) throw await failure(response);
    return grant.file_url;
  }

  /** Fetch an attachment's bytes with the token, for inline rendering. */
  async fetchAttachment(url: string): Promise<Blob> {
    if (!this.#token) throw new WidgetApiError('not connected');
    const response = await fetch(new URL(url, this.baseUrl).toString(), {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (!response.ok) throw await failure(response);
    return response.blob();
  }

  /**
   * Live typing preview (FR-MOD-02.9 / 11.8): tell the agent the visitor is
   * typing, and — while `isTyping` — a preview of the in-progress message. Sent
   * fire-and-forget by the caller; a dropped indicator is cosmetic. Capped so a
   * pasted wall of text does not travel keystroke by keystroke.
   */
  async typing(isTyping: boolean, text?: string): Promise<void> {
    await this.#request('POST', '/customer/chat/typing', {
      is_typing: isTyping,
      ...(isTyping && text ? { text: text.slice(0, 500) } : {}),
    });
  }

  /**
   * A vote, or a vote with its comment (AR-03 · WG-11): one rating per
   * connection on the server, so sending the comment again with the same
   * value writes onto the rating rather than adding one. `threadId` is the
   * connection the prompt is for — without it the server rates the newest.
   */
  async rate(
    value: 'good' | 'bad',
    options: { threadId?: string | null; comment?: string } = {},
  ): Promise<void> {
    await this.#request('POST', '/customer/chat/rating', {
      value,
      ...(options.threadId ? { thread_id: options.threadId } : {}),
      ...(options.comment ? { comment: options.comment } : {}),
    });
  }

  /**
   * Post-chat form answers (FR-MOD-08.7.7): contact custom-field id → value,
   * stored on the contact. Unlike the pre-chat half — which rides the first
   * message — this has its own request, because the conversation is over and
   * there is no message left to carry it. Rejects on a 400 so the caller can
   * keep the form on screen rather than claim an answer was saved.
   */
  async submitPostChatForm(values: Record<string, string>): Promise<void> {
    await this.#request('POST', '/customer/chat/form-response', { custom_fields: values });
  }

  /**
   * Leave a message when nobody is available (FR-MOD-08.7.7): the visitor's
   * words open a ticket, and both offline forms' answers ride the same request
   * so the server stores them in the one transaction that creates it. Rejects on
   * a 400 so the caller can keep the form on screen rather than claim a message
   * was sent.
   */
  async leaveTicket(input: LeaveTicketInput): Promise<{ ticket_id: string }> {
    return this.#request('POST', '/customer/ticket', input);
  }

  async close(): Promise<void> {
    await this.#request('POST', '/customer/chat/close');
  }

  /** "Talk to an agent" (tm 308 · AI-29): the AI hands the connection to a person. */
  async requestHuman(): Promise<HumanRequestResult> {
    return this.#request('POST', '/customer/chat/request-human', { reason: 'button' });
  }

  /** "E-mail me the transcript" (WG-06 · tm 345): the latest connection, to `email`. */
  async requestTranscript(email: string): Promise<void> {
    await this.#request('POST', '/customer/chat/transcript', { email });
  }

  /** A read for the Help tab (WG-12 · tm 348): `/customer/kb/...` with the visitor's token. */
  async help<T>(path: string): Promise<T> {
    return this.#request('GET', path);
  }

  /** The answer to the "leave your e-mail" card (WG-08 · tm 342). */
  async submitContactEmail(email: string): Promise<void> {
    await this.#request('POST', '/customer/chat/email', { email });
  }

  /**
   * "Is it solved?" answered with the buttons (tm 320.1 · AI-25-S2): yes is
   * thanked, no hands the connection to a person.
   */
  async answerResolution(answer: 'yes' | 'no'): Promise<ResolutionAnswerResult> {
    return this.#request('POST', '/customer/chat/resolution', { answer });
  }

  /**
   * Report a completed order (FR-MOD-13.5), attributed server-side to the
   * visitor's most recent chat within the workspace's configured window.
   * Fired from the host page's `siyahtus('trackSale', …)` tracking call, relayed
   * into the widget document — same fire-and-forget shape as `typing`/`rate`,
   * the response body is nothing the widget needs to act on.
   */
  async trackSale(input: TrackSaleInput): Promise<void> {
    await this.#request('POST', '/customer/chat/sale', input);
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
    if (!response.ok) throw await failure(response);
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }
}

export class WidgetApiError extends Error {
  /** The ADR-06 `error.type` the server named, when the failure came with one. */
  readonly type: string | undefined;
  readonly status: number | undefined;
  /** The envelope's `details` — an upload refusal carries its limit here. */
  readonly details: Record<string, unknown> | undefined;
  /** Seconds the server asked the caller to wait (`Retry-After` on a 429). */
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    details: {
      type?: string;
      status?: number;
      details?: Record<string, unknown>;
      retryAfter?: number;
    } = {},
  ) {
    super(message);
    this.name = 'WidgetApiError';
    this.type = details.type;
    this.status = details.status;
    this.details = details.details;
    this.retryAfter = details.retryAfter;
  }
}

async function failure(response: Response): Promise<WidgetApiError> {
  const status = response.status;
  // A whole number of seconds; the HTTP-date form is not one the API sends.
  const seconds = Number(response.headers?.get('retry-after'));
  const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  try {
    const body = (await response.json()) as {
      error?: { message?: string; type?: string; details?: Record<string, unknown> };
    };
    return new WidgetApiError(body.error?.message ?? `request failed (${status})`, {
      status,
      ...(body.error?.type ? { type: body.error.type } : {}),
      ...(body.error?.details ? { details: body.error.details } : {}),
      ...(retryAfter ? { retryAfter } : {}),
    });
  } catch {
    return new WidgetApiError(`request failed (${status})`, {
      status,
      ...(retryAfter ? { retryAfter } : {}),
    });
  }
}

/** `challenge_required`'s `details`, or null when `error` is some other failure. */
function challengeDetails(error: unknown): ChallengeRequiredDetails | null {
  if (!(error instanceof WidgetApiError)) return null;
  if (error.status !== 403 || error.type !== 'challenge_required') return null;
  const { reason, provider, site_key: siteKey } = error.details ?? {};
  if (provider !== 'turnstile' && provider !== 'mock') return null;
  return {
    reason: typeof reason === 'string' ? (reason as ChallengeReason) : 'always_on_chat_start',
    provider,
    site_key: typeof siteKey === 'string' ? siteKey : '',
  };
}

const MEMBER_TOKEN_PREFIX = 'siyahtus.member_token.';
const CUSTOMER_ID_PREFIX = 'siyahtus.customer_id.';

/**
 * The single, un-keyed slots a widget from before tm 287.3 kept — one for
 * whichever workspace wrote last. Read once per workspace, to move a member
 * across (`connect`), and cleared on sign-out.
 */
export const LEGACY_MEMBER_TOKEN_KEY = 'siyahtus.member_token';
export const LEGACY_CUSTOMER_ID_KEY = 'siyahtus.customer_id';

/**
 * Where this browser keeps what it knows about its visitor for one
 * organization (ID-03 · K4 · tm 287.3): the member token copy — only when the
 * browser would not keep the cookie — and the customer id, which marks a
 * returning visitor. Lowercased so the snippet's casing cannot split one
 * workspace into two. Exported for the tests that act as a returning visitor.
 */
export function storageKeys(organizationId: string): { memberToken: string; customerId: string } {
  const organization = organizationId.toLowerCase();
  return {
    memberToken: `${MEMBER_TOKEN_PREFIX}${organization}`,
    customerId: `${CUSTOMER_ID_PREFIX}${organization}`,
  };
}

const LAUNCHER_PREFIX = 'siyahtus.launcher.';

/** A launcher mode off the wire or out of storage, else null. */
export function parseLauncher(value: unknown): WidgetLauncherVisibility | null {
  return value === 'always' || value === 'until_opened' || value === 'never' ? value : null;
}

/** The mode this browser last learned for `organizationId` (WG-10), for the first paint. */
export function cachedLauncher(organizationId: string): WidgetLauncherVisibility | null {
  return parseLauncher(safeGetItem(LAUNCHER_PREFIX + organizationId.toLowerCase()));
}

/** Keep `value` for the next page load when it is a mode; returns it, or null. */
export function rememberLauncher(
  organizationId: string,
  value: unknown,
): WidgetLauncherVisibility | null {
  const mode = parseLauncher(value);
  if (mode) safeSetItem(LAUNCHER_PREFIX + organizationId.toLowerCase(), mode);
  return mode;
}

/**
 * Whether this browser has talked to `organizationId` before — its own key,
 * or the shared slot a widget from before tm 287.3 left, which `connect`
 * moves across on the first mint.
 */
export function isReturningVisitor(organizationId: string): boolean {
  return (
    safeGetItem(storageKeys(organizationId).customerId) !== null ||
    safeGetItem(LEGACY_CUSTOMER_ID_KEY) !== null
  );
}

/** Every visitor identity this browser holds on this site, for every workspace. */
function forgetStoredIdentities(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (
        key !== null &&
        (key === LEGACY_MEMBER_TOKEN_KEY ||
          key === LEGACY_CUSTOMER_ID_KEY ||
          key.startsWith(MEMBER_TOKEN_PREFIX) ||
          key.startsWith(CUSTOMER_ID_PREFIX))
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage that cannot be read holds nothing to forget.
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

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignored — storage that cannot be written cannot hold the copy either.
  }
}

function randomKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
