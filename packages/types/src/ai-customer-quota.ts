/**
 * The per-member daily AI allowance (tm 339.1 · SiyahTuş analysis GV-01) —
 * how many AI turns one member (a `customers` row) may have answered in one
 * conversation day, before the conversation is left to a person.
 *
 * The workspace's and the deployment's daily caps count tokens and bound what
 * the workspace spends; this counts turns and bounds what one visitor can take
 * of it. Without it a script on one page can spend the whole workspace's day.
 *
 * The setting is `security_settings.ai_turns_per_customer_day`
 * (`PATCH /settings/security`); the counter is `ai_customer_daily_usage`,
 * keyed by the workspace's conversation day (ID-04), the same day a member's
 * daily conversation is filed under.
 */

/** A member's AI turns per day when the workspace never set it (GV-01 default). */
export const AI_TURNS_PER_CUSTOMER_DAY_DEFAULT = 40;

/** The highest value the setting takes. 0 turns the per-member allowance off. */
export const AI_TURNS_PER_CUSTOMER_DAY_MAX = 10_000;

/**
 * `properties.system_event` of the agents-only note left when a daily
 * allowance — the member's or the workspace's — handed the conversation over.
 */
export const AI_CAP_REACHED_SYSTEM_EVENT = 'ai_cap_reached';

/**
 * Which allowance refused a turn, as a `cap_reached` decision record's
 * `details.cap_scope` says it: the member's (`customer`), the workspace's, or
 * the deployment's (`global`).
 */
export const AI_CAP_SCOPES = ['customer', 'workspace', 'global'] as const;
export type AiCapReachedScope = (typeof AI_CAP_SCOPES)[number];
