/**
 * The rule bot — a deterministic, LLM-free chatbot (FR-MOD-06.6).
 *
 * PRD:577 asks for a "kural bazlı bot" that is explicitly *separate* from the AI
 * Agent and carries no LLM, and that "gruplara priority ile atanır". Its `Şema`
 * column names `§8 bots`, but PRD §8.4 — the single source of truth for the
 * schema together with `rapor-2-teknik-mimari.md` §5.3 — defines no such table:
 * `bot` appears there only as a *value* (`events.author_type`,
 * `webhooks.type`, `api_tokens.kind`). So the shape below is this task's design
 * decision, written down here because the console, the engine and the migration
 * all have to agree on it (PLAN §C · A37).
 *
 * **Why its own entity and not a third `ai_agents.kind`.** The requirement's own
 * words are "AI Agent'tan AYRI"; sharing the AI agent's table is the opposite of
 * separate. Measured rather than assumed: `GET /ai-agents` filters on no `kind`
 * at all, so a `rule_bot` row would appear in the AI Agent console's list and in
 * the Team → Chatbots count as though it were LLM-backed. And every
 * AI-shaped column on that table — `persona`, `tone`, `languages`,
 * `instruction`, plus the `skills` and `knowledge_sources` relations — is
 * meaningless for a bot that only matches text, which would turn "is this column
 * real for this row" into a runtime question. The link table that carries
 * `priority` has to be new either way (`group_agents.agent_id` is a FK to
 * `accounts`, and a bot is not an account), so nothing is saved by folding the
 * bot itself into an existing table.
 *
 * **Nothing in this file may reach an LLM.** That is the requirement, not a
 * style preference: the whole point of the row is an answer path a workspace can
 * predict exactly. The conditions below are therefore all cheap, total
 * predicates over values the request already has, and there is deliberately no
 * regular-expression condition — a regex is an unbounded matcher on
 * attacker-influenced text (the visitor's own message), which is a denial of
 * service one badly written rule away.
 */

/** How many rules one bot may carry. Bounded so a message costs a bounded walk. */
export const RULE_BOT_MAX_RULES = 50;

/** How many teams one bot may serve. The console lists them all, unpaged. */
export const RULE_BOT_MAX_GROUPS = 25;

/** Longest reply a rule may send. The composer's own limit for an agent message. */
export const RULE_BOT_MAX_REPLY = 2000;

/**
 * Whether the workspace is inside its own business hours.
 *
 * The calendar is the one the SLA clock already uses — the union of the agents'
 * saved `work_schedules` (§C-A27) — so "open" here and "open" in a first-response
 * target mean the same thing. A workspace where nobody saved a plan has no
 * calendar and counts as always open, which is that module's rule too: an
 * invented 09:00-18:00 would close a team that never said it closes.
 */
export const RULE_BOT_OFFICE_HOURS = ['open', 'closed'] as const;
export type RuleBotOfficeHours = (typeof RULE_BOT_OFFICE_HOURS)[number];

/**
 * A rule's trigger. Every key that is set must hold (AND).
 *
 * An empty predicate matches **nobody**, not everybody — the discipline ticket
 * rules and campaign triggers already use. A rule with no condition is not
 * "reply to everything", it is a rule that is not ready, and the service refuses
 * to save it.
 *
 * Three text predicates and no fourth, because "exact / contains / word" is the
 * whole vocabulary a person writing a keyword rule needs, and each is a total
 * function of the message:
 *
 *   - `message_equals` — the trimmed message, case-insensitively, is exactly
 *     this. What "hi" should use, so it does not also fire on "this".
 *   - `message_contains` — case-insensitive substring. The blunt one, and the
 *     reason `message_word` exists beside it: `contains: "cancel"` also fires on
 *     "cancellation policy".
 *   - `message_word` — the message contains this as a whole word, with word
 *     boundaries decided by "is this character a letter or a digit". So "iptal"
 *     matches inside "iptal?" and not inside "iptaller".
 *
 * Case folding is JavaScript's own, the same `toLowerCase` comparison ticket
 * rules make. It is not locale-aware and does not pretend to be: a Turkish
 * dotted capital İ folds to `i` + a combining dot, so it matches a needle
 * written the same way and not one typed as a plain `i`. Naming a locale here
 * would only move the surprise to a different alphabet.
 *
 * There is deliberately **no `channel` condition**, even though a rule engine
 * elsewhere in the product would want one. Measured: the bot runs on exactly one
 * entry — the widget's Customer Chat API — because `ChannelService.ingestInbound`
 * never invokes a responder at all. A `channel` key would therefore have exactly
 * one value it could ever match, which is a predicate that discriminates nothing
 * while reading as though it does.
 */
export interface RuleBotConditions {
  /** The whole message, trimmed and compared case-insensitively. */
  message_equals?: string;
  /** Case-insensitive substring of the message. */
  message_contains?: string;
  /** Case-insensitive whole-word occurrence in the message. */
  message_word?: string;
  /** Case-insensitive substring of the page the visitor wrote from. */
  page_url_contains?: string;
  /** Only inside — or only outside — the workspace's business hours. */
  office_hours?: RuleBotOfficeHours;
}

/**
 * What a matching rule does. At least one must be set; a rule that does nothing
 * is refused rather than saved inert.
 *
 * The three actions are the ones PRD:577's own "deterministik akış" can carry
 * end to end without asking anything the request does not already know: say
 * something, label the conversation, hand it to a team.
 */
export interface RuleBotActions {
  /** Reply to the visitor, as the bot. */
  send_message?: string;
  /** Tag the conversation (created in the shared tag library if new). */
  add_tag?: string;
  /** Transfer the conversation to this team. */
  transfer_to_group_id?: number;
}

/** One rule, as the API returns it. */
export interface RuleBotRule {
  id: string;
  name: string;
  conditions: RuleBotConditions;
  actions: RuleBotActions;
  /** Whether the rule fires. Off keeps it written down without acting. */
  enabled: boolean;
  /** Evaluation order within the bot; lower is tried first. */
  position: number;
  created_at: string;
}

/**
 * A bot's place in one team, and how eagerly it is tried there.
 *
 * `priority` reuses `GROUP_PRIORITIES` — the same four tiers an agent's team
 * membership carries — rather than inventing a second vocabulary. The PRD uses
 * one word, "priority", for both, and a console showing two different pickers
 * called "priority" that order things differently would be the worse answer.
 */
export interface RuleBotGroupAssignment {
  group_id: number;
  /** `primary` | `first` | `normal` | `last` — see `GROUP_PRIORITIES`. */
  priority: string;
}

/** A rule bot, with everything the console edits in one object. */
export interface RuleBot {
  id: string;
  name: string;
  /** Whether the bot answers at all. Off silences every rule it carries. */
  enabled: boolean;
  groups: RuleBotGroupAssignment[];
  rules: RuleBotRule[];
  created_at: string;
}
