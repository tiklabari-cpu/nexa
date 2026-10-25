/**
 * Error taxonomy — v2-03 §1.8 (23 types), plus the clone-specific additions the
 * source platform lacks. The wire envelope is ADR-06:
 *
 *   { error: { type, message, request_id, details? } }
 *
 * `type` is the machine-readable category clients switch on; the HTTP status is
 * derived from it via ERROR_STATUS so the two can never drift.
 */

export const ERROR_TYPES = [
  // SiyahTuş additions — who answers a connection (AI-11 · tm 293.3). A move the
  // connection's AI mode cannot make — pausing an AI that is not answering it —
  // and a connection a risk flag (responsible gaming, self-harm, a suspected
  // minor) keeps from going back to the AI. Both 409: the request was fine and
  // allowed, the connection's state refused it. Kept apart because the screen
  // answers them differently — "the AI is not on this chat" against "this chat
  // must stay with a person" — and kept narrow like `takeover_conflict`.
  'ai_mode_transition_refused',
  'ai_return_blocked',
  // SiyahTuş addition — compliance guardrails (AI-08 · tm 301.2). A customer-
  // facing AI agent switched on before the Founder approved its crisis text
  // (AI-08-S1): the request was fine and allowed, the agent's setup is what
  // refused it, and the screen answers it with "approve the crisis text
  // first" (`details.reason`), which a generic `not_allowed` cannot say.
  'ai_guardrail_setup_incomplete',
  // SiyahTuş addition — the AI test bench (AI-19 · tm 314.2): a second run of
  // an AI agent against a configuration while one is still queued or playing.
  // The request was fine and allowed; the run under way refused it, and the
  // Test tab answers "wait for it" — kept narrow like `sandbox_exists`.
  'ai_test_run_in_progress',
  // SiyahTuş addition. Signup is not in the source catalogue at all — that API
  // assumes a workspace already exists — and "this email is taken" is a
  // conflict, not a malformed request.
  'account_exists',
  'authentication',
  'authorization',
  // SiyahTuş additions — Multibrand (PRD §5.3 · NFR-S4/S5). The source catalogue
  // (v2-03 §1.8) has no brand concept. `brand_not_found` gives the brands surface
  // its own 404 (a foreign or unknown brand id is un-enumerable, like every other
  // resource); `brand_exists` is the 409 a duplicate slug within a license raises,
  // kept narrow like `website_exists`/`ticket_exists` rather than a generic conflict.
  'brand_exists',
  'brand_not_found',
  'chat_anonymized',
  'chat_inactive',
  // SiyahTuş addition — widget abuse protection (GV-01 · tm 339.2). A widget token
  // or a conversation opening that looks scripted (many new visitors from one
  // address, a burst of messages) must first pass a human check, and the
  // widget answers this by showing one: `details.reason` says why, `details.provider`
  // and `details.site_key` which check to load. 403 like `customer_banned`, kept
  // apart from it because the answer is "prove you are a person", not "go away".
  'challenge_required',
  'customer_banned',
  // SiyahTuş addition — routing rules (FR-MOD-08.6.1). A licence holds at most one
  // fallback rule per kind, and asking for a second is a conflict rather than a
  // malformed request: the body was fine, the workspace's state is what refused
  // it. It also needs its own answer on the screen — "you already have one, edit
  // that instead" — which a generic `not_allowed` cannot give. Kept narrow like
  // `sandbox_exists`/`ticket_exists`, which is how the rest of this list is
  // written.
  'fallback_rule_exists',
  'greeting_not_found',
  // SiyahTuş addition. A team still carries work: a routing rule targets it, or a
  // live conversation is reachable only through it (FR-MOD-04.5). Neither
  // reference is a foreign key, so this refusal is the only thing standing
  // between a delete and silently unroutable chats. 409, like the other
  // "the state says no" codes, rather than a generic 400.
  'group_in_use',
  // SiyahTuş addition — team queues (AU-01 · K14 · tm 305.3). A team that
  // requires areas of expertise takes only members who hold every one of them
  // (routing gives them nothing otherwise), and the Responsible Gambling team's
  // members hold its training at all times. Raised by the membership write, and
  // for that team by whatever would leave a member short of it — a requirement
  // grown, the role given to a staffed team, an agent's area removed.
  // `details` names the team and the areas or agents short of it.
  'group_expertise_missing',
  'group_not_found',
  'group_offline',
  // SiyahTuş addition — team queues (AU-01 · K14 · tm 305.3). The Responsible
  // Gambling team (ADR-08a §2.6) cannot be deleted, cannot lose its topic role
  // and cannot go without a training requirement: only its name changes.
  // `details.reason` says which (`delete` · `topic_role` · `required_expertise`).
  'group_protected',
  // SiyahTuş addition — team queues (AU-01 · K14 · tm 305.1). A topic role
  // (`QUEUE_TOPIC_ROLES`) names one team per workspace, because the AI's
  // hand-over and the pre-chat topic resolve the role to a team; giving it to a
  // second team is a conflict with the workspace's state, not a malformed body.
  // `details.group_id` names the team that holds it. Kept narrow like
  // `fallback_rule_exists`, the other one-per-workspace refusal.
  'group_topic_role_taken',
  'group_unavailable',
  'groups_offline',
  'internal',
  'license_expired',
  'limit_reached',
  // SiyahTuş addition. A write refused for content reasons at the visitor edge —
  // the spam filter (FR-MOD-08.9.3). Deliberately generic: it does not name the
  // rule that fired, so an enveloped refusal cannot be used to probe the filter.
  // Kept narrow like `customer_banned`, not folded into `not_allowed` (which is
  // an authorization verdict).
  'message_rejected',
  'misdirected_request',
  'not_allowed',
  'not_found',
  'pending_requests_limit_reached',
  'request_timeout',
  // SiyahTuş addition — the sandbox workspace (FR-MOD-11.5 · 11.5-f). A licence may
  // hold at most one sandbox, and asking for a second is a conflict rather than
  // a malformed request: the caller's body was fine, the workspace's state is
  // what refused them. Kept narrow like `website_exists`/`ticket_exists` rather
  // than folding into a generic conflict, which is how the rest of this list is
  // written.
  'sandbox_exists',
  'service_unavailable',
  // SiyahTuş addition — supervisor takeover (FR-MOD-08.6.3). Two supervisors racing
  // to seize the same chat: the conditional re-assign lets exactly one win, and
  // the loser gets this 409. Not `not_allowed` (that is an authorization verdict
  // — the loser *was* allowed, they simply lost the race) and not `chat_inactive`
  // (the chat is open); kept narrow like `ticket_exists`, not a generic conflict.
  'takeover_conflict',
  // SiyahTuş addition — ready-made templates (AI-15 · tm 311.3): switching off
  // or deleting an installed copy of a locked template (`self_exclusion`,
  // `responsible_gambling_signal`). The request was fine and allowed; the
  // copy's lock, which the server derives from its template, refused it.
  'template_locked',
  // SiyahTuş addition. The source catalogue (v2-03 §1.8) is chat-only — ticketing
  // lives in a separate product there — so it has no "this already exists"
  // conflict. Kept narrow rather than adding a generic `conflict`, which is how
  // the rest of this list is written (`group_offline`, not `unavailable`).
  'ticket_exists',
  // SiyahTuş additions — ticket replies (HD-01 · tm 356). Writing to a ticket
  // that was merged into another: the conversation lives on the primary now,
  // and `details.primary_ticket_id` says where, so the console can go there
  // instead of showing an error. And a reply to a player who left no e-mail
  // address: the ticket is fine, there is simply nobody to send it to — a note
  // is still allowed. Both 409, kept narrow like `ticket_exists`.
  'ticket_merged',
  'ticket_no_recipient',
  'too_many_requests',
  // SiyahTuş addition — two-factor authentication (NFR-S11 · FR-MOD-00.1). Asking
  // to set up a second factor on an account that already has a live one
  // (S11-2FA-d). A conflict rather than a malformed request: the body was fine,
  // the account's state is what refused it — and the client needs to tell this
  // apart from a rejected code, because the answer is "turn it off first", not
  // "try again". Kept narrow like `sandbox_exists`/`ticket_exists` rather than
  // folded into a generic conflict, which is how the rest of this list is
  // written.
  'two_factor_already_enabled',
  // SiyahTuş addition — two-factor authentication (NFR-S11 · FR-MOD-00.1). The
  // second login step (S11-2FA-e) answers with this rather than
  // `authentication`: the password was correct, a second factor is simply
  // still owed, and a client needs to tell the two apart to know whether to
  // show a code screen or a login form.
  'two_factor_required',
  'unsupported_version',
  'users_limit_reached',
  'validation',
  // SiyahTuş addition. Websites (FR-MOD-08.5.2) are not in the source catalogue
  // (v2-03 §1.8, chat-only); a duplicate install domain is a conflict, kept
  // narrow like `ticket_exists`/`account_exists` rather than a generic one.
  'website_exists',
  'wrong_product_version',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

/**
 * type → HTTP status. The source platform never published this mapping
 * (v2-03 §1.8 flags it as a gap); these are the clone's locked choices.
 */
export const ERROR_STATUS: Record<ErrorType, number> = {
  account_exists: 409,
  ai_guardrail_setup_incomplete: 409,
  ai_mode_transition_refused: 409,
  ai_return_blocked: 409,
  ai_test_run_in_progress: 409,
  authentication: 401,
  authorization: 403,
  brand_exists: 409,
  brand_not_found: 404,
  chat_anonymized: 410,
  chat_inactive: 409,
  challenge_required: 403,
  customer_banned: 403,
  fallback_rule_exists: 409,
  greeting_not_found: 404,
  group_in_use: 409,
  group_expertise_missing: 409,
  group_not_found: 404,
  group_offline: 409,
  group_protected: 409,
  group_topic_role_taken: 409,
  group_unavailable: 409,
  groups_offline: 409,
  internal: 500,
  license_expired: 402,
  limit_reached: 429,
  message_rejected: 403,
  misdirected_request: 421,
  not_allowed: 403,
  // Enumeration protection (NFR-S5): unknown *and* out-of-tenant resources
  // both surface as 404, never 403.
  not_found: 404,
  pending_requests_limit_reached: 429,
  request_timeout: 408,
  sandbox_exists: 409,
  service_unavailable: 503,
  takeover_conflict: 409,
  template_locked: 409,
  ticket_exists: 409,
  ticket_merged: 409,
  ticket_no_recipient: 409,
  too_many_requests: 429,
  two_factor_already_enabled: 409,
  // Not authenticated yet, same as `authentication` — the second factor is
  // the missing piece, not a different kind of failure.
  two_factor_required: 401,
  unsupported_version: 400,
  users_limit_reached: 429,
  validation: 400,
  website_exists: 409,
  wrong_product_version: 409,
};

export interface ApiErrorBody {
  error: {
    type: ErrorType;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export function isErrorType(value: unknown): value is ErrorType {
  return typeof value === 'string' && (ERROR_TYPES as readonly string[]).includes(value);
}
