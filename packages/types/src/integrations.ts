/**
 * Integration manifest — FR-MOD-09.4. The machine-readable catalogue a
 * Zapier/Make (or any REST Hooks-style) app definition is built from, served
 * by `GET /integrations/manifest`.
 *
 * KK-derived: the PRD's "700+ Zapier" acceptance criterion is not a measurable
 * target (a workspace does not write 700 integrations) — its buildable
 * equivalent is that SiyahTuş's own trigger/action surface can be published as
 * *one* Zapier/Make app. That publication needs exactly two lists: which
 * workspace events a subscriber can trigger on (`INTEGRATION_TRIGGERS` — one
 * entry per `WebhookAction`, `apps/api/src/services/webhooks/webhook-service.ts`)
 * and which existing write endpoints an action step may call
 * (`INTEGRATION_ACTIONS`, a hand-picked subset of routes already gated by an
 * existing scope — no new endpoint or scope is introduced here).
 *
 * This module makes no request and reads no tenant data — every field below
 * is a static description, mirroring `apps.ts`'s catalogue pattern. Because
 * `WEBHOOK_ACTIONS` lives in `apps/api` (this package has no dependency on
 * it), `INTEGRATION_TRIGGERS` is kept in sync by a test instead of the type
 * system: `apps/api/test/integration/webhooks.test.ts` asserts the two
 * action lists are the same set, so adding a webhook action without adding
 * its manifest entry fails the suite.
 */

/** One workspace event a webhook — and so a Zapier/Make trigger — can subscribe to. */
export interface IntegrationTrigger {
  /** A `WebhookAction` value (`webhook-service.ts`) — what `POST /webhooks` accepts. */
  action: string;
  label: string;
  description: string;
  /** An example delivery body, shaped like `{action, data}` (the dispatcher's envelope). */
  sample_payload: Record<string, unknown>;
}

/**
 * The subscribable events, one entry per `WEBHOOK_ACTION`. Kept in the same
 * order as the source list so a diff against it stays readable.
 */
export const INTEGRATION_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    action: 'chat_started',
    label: 'Chat started',
    description: 'Fires when a new chat begins, carrying its first connection (thread_id).',
    sample_payload: {
      action: 'chat_started',
      data: {
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH1H8CFKRV',
        customer_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        active: true,
        created_at: '2026-01-15T10:30:00.000Z',
      },
    },
  },
  {
    action: 'chat_deactivated',
    label: 'Chat deactivated',
    description:
      'Fires when a chat is archived (agent close or timeout), naming the connection that closed (thread_id).',
    sample_payload: {
      action: 'chat_deactivated',
      data: {
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH1H8CFKRV',
        active: false,
        created_at: '2026-01-15T10:30:00.000Z',
      },
    },
  },
  {
    action: 'chat_transferred',
    label: 'Chat transferred',
    description: 'Fires when a chat is handed to another agent or team.',
    sample_payload: {
      action: 'chat_transferred',
      data: {
        chat_id: 'CH1H8CFKRV',
        group_id: 42,
        agent_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        reason: 'manual',
      },
    },
  },
  {
    action: 'event_created',
    label: 'Event created',
    description: 'Fires when a message or other event is posted to a chat thread.',
    sample_payload: {
      action: 'event_created',
      data: {
        event_id: 'EV1H8CFKRV',
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH1H8CFKRV',
        type: 'message',
        text: 'Thanks, that solved it!',
        author_type: 'customer',
        created_at: '2026-01-15T10:32:00.000Z',
      },
    },
  },
  {
    action: 'ticket_created',
    label: 'Ticket created',
    description: 'Fires when a follow-up ticket is opened.',
    sample_payload: {
      action: 'ticket_created',
      data: {
        ticket_id: 'TCK1H8CFK',
        subject: 'Refund request',
        status: 'open',
        priority: 3,
        customer_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        created_at: '2026-01-15T10:35:00.000Z',
      },
    },
  },
  {
    // ID-02: a chat is the member's day and a thread one connection inside it,
    // so "the member came back" no longer always means a new chat. The second
    // and later connections of a day are announced here; the first one rides on
    // `chat_started` — never both for one opening.
    action: 'thread_started',
    label: 'Connection started',
    description:
      'Fires when a further connection (thread) opens under an existing chat — the member back the same day.',
    sample_payload: {
      action: 'thread_started',
      data: {
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH2K9DXQ4M',
        customer_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        reason: 'same_day_return',
        created_at: '2026-01-15T14:00:00.000Z',
      },
    },
  },
  {
    // AI-27-S4 (tm 302.2): the operator hears at once that a player asked to
    // stop, may be a minor, or is at risk — the account is theirs to act on.
    // What the flag is, where, and whose by the site's player key; never a word
    // anyone wrote (`RiskFlagSignal`).
    action: 'risk_flag_raised',
    label: 'Risk flag raised',
    description:
      'Fires when a conversation is risk-flagged — by the AI or an agent — with the type, the chat and the member key; no message text.',
    sample_payload: {
      action: 'risk_flag_raised',
      data: {
        flag_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        type: 'self_exclusion_request',
        severity: 'urgent',
        scope: 'member',
        status: 'active',
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH1H8CFKRV',
        member_key: 'oyuncu42',
        raised_at: '2026-01-15T10:31:00.000Z',
        cleared_at: null,
      },
    },
  },
  {
    action: 'risk_flag_cleared',
    label: 'Risk flag cleared',
    description:
      "Fires when someone with the authority clears a risk flag. Clearing support's mark changes nothing on the operator's side.",
    sample_payload: {
      action: 'risk_flag_cleared',
      data: {
        flag_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        type: 'self_exclusion_request',
        severity: 'urgent',
        scope: 'member',
        status: 'cleared',
        chat_id: 'CH1H8CFKRV',
        thread_id: 'TH1H8CFKRV',
        member_key: 'oyuncu42',
        raised_at: '2026-01-15T10:31:00.000Z',
        cleared_at: '2026-01-20T09:00:00.000Z',
      },
    },
  },
] as const;

/** One existing write endpoint a Zapier/Make "action" step may call. */
export interface IntegrationAction {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Contract-style path, e.g. `/chats/{chatId}/events`. */
  path: string;
  label: string;
  /** At least one of these scopes must be granted (the route's own gate). */
  required_scopes: readonly string[];
}

/**
 * A hand-picked subset of already-shipped write routes, described for a
 * Zapier/Make action step. No new endpoint or scope — `required_scopes`
 * copies each route's existing `config.scopes` verbatim.
 */
export const INTEGRATION_ACTIONS: readonly IntegrationAction[] = [
  {
    id: 'send_message',
    method: 'POST',
    path: '/chats/{chatId}/events',
    label: 'Send a message',
    required_scopes: ['chats--all:rw', 'chats--access:rw'],
  },
  {
    id: 'create_ticket',
    method: 'POST',
    path: '/tickets',
    label: 'Create a ticket',
    required_scopes: ['tickets--all:rw', 'tickets--access:rw'],
  },
  {
    id: 'add_tag',
    method: 'POST',
    path: '/chats/{chatId}/tags',
    label: 'Add a tag to a chat',
    required_scopes: ['tags--all:rw', 'tags--groups:rw', 'chats--all:rw', 'chats--access:rw'],
  },
] as const;
