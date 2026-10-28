/**
 * The coaching and suggestion queue's vocabulary (tm 318 · SiyahTuş analysis
 * AI-23) — shared by the `ai_suggestions` CHECKs
 * (`20261116090000_ai_suggestions`), the API (`routes/ai-suggestions.ts`), the
 * drafting job (`ai_suggestion_drafts`) and the panel (tm 318.2).
 *
 * An agent who took a conversation over marks the AI's message ("wrong",
 * "should have handed over", "tone"…) or offers their own answer to the AI's
 * knowledge ("AI bilgisine öner"). The suggestion keeps a masked copy of the
 * last messages, so it can be reviewed after the conversation's retention
 * ran out, and goes to the Team Lead of the conversation's team (or an
 * administrator). Accepting it writes the change into the AI-20 draft — never
 * live: a publication is what puts it in front of a player (AI-23-S1).
 */

// ---------------------------------------------------------------------------
// Closed lists — each is a CHECK in the migration.
// ---------------------------------------------------------------------------

/**
 * What the suggestion says (05 § AI-23 "Prisma"):
 *
 *   - `wrong_answer`               — the AI's message was wrong;
 *   - `missing_info`               — the AI lacked something it should know;
 *   - `should_have_handed_off`     — it should have passed the player on;
 *   - `should_not_have_handed_off` — it passed the player on for nothing
 *                                    (the hand-over band's one suggestion);
 *   - `tone`                       — right content, wrong manner;
 *   - `promote_agent_answer`       — "AI bilgisine öner": an agent's own
 *                                    answer, generalised into knowledge;
 *   - `other`.
 */
export const SUGGESTION_KINDS = [
  'wrong_answer',
  'missing_info',
  'should_have_handed_off',
  'should_not_have_handed_off',
  'tone',
  'promote_agent_answer',
  'other',
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return (SUGGESTION_KINDS as readonly unknown[]).includes(value);
}

/**
 * The kinds that name one of the AI's own messages: the event must be the
 * model's (`author_id` `AI_BOT_ID`), or the suggestion is refused.
 */
export const SUGGESTION_AI_MESSAGE_KINDS = [
  'wrong_answer',
  'should_have_handed_off',
  'tone',
] as const satisfies readonly SuggestionKind[];

/** The kind that names a person's message: an agent's (`author_type` `agent`). */
export const SUGGESTION_AGENT_MESSAGE_KINDS = [
  'promote_agent_answer',
] as const satisfies readonly SuggestionKind[];

/**
 * The kinds the drafting job writes a proposal for (AI-23 §2): the `fast`
 * model's generalisation of what the agent said, without what is the
 * player's own, then masked.
 */
export const SUGGESTION_DRAFTED_KINDS = [
  'promote_agent_answer',
  'missing_info',
] as const satisfies readonly SuggestionKind[];

/**
 * Where a suggestion came from: an agent's mark, a QA finding (AI-24, tm
 * 319), or an unresolved-questions cluster whose agents kept answering the
 * same thing (AI-23-S2).
 */
export const SUGGESTION_SOURCES = ['agent_flag', 'qa_finding', 'unresolved_cluster'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

/**
 * Where it stands:
 *
 *   - `drafting`  — waiting for the drafting job (a drafted kind);
 *   - `new`       — in the reviewers' queue;
 *   - `in_review` — a reviewer edited its proposal and has not decided yet;
 *   - `accepted`  — written into the AI-20 draft (`resulting_change_id`);
 *   - `rejected`  — with the reviewer's reason;
 *   - `merged`    — joined to another suggestion or to an AI-22 cluster.
 */
export const SUGGESTION_STATUSES = [
  'new',
  'drafting',
  'in_review',
  'accepted',
  'rejected',
  'merged',
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Still in the queue — what a reviewer's badge counts. */
export const SUGGESTION_OPEN_STATUSES = [
  'new',
  'drafting',
  'in_review',
] as const satisfies readonly SuggestionStatus[];

/** Decided: a review moves none of these again. */
export const SUGGESTION_CLOSED_STATUSES = [
  'accepted',
  'rejected',
  'merged',
] as const satisfies readonly SuggestionStatus[];

/**
 * What accepting writes into the draft (AI-23 §4): a knowledge snippet (a
 * `faq` source, or a correction of one), a behaviour rule (AI-07), an example
 * sentence of a procedure (AI-03), or a note on when a procedure applies.
 */
export const SUGGESTION_TARGETS = [
  'knowledge_snippet',
  'guidance_rule',
  'procedure_example',
  'procedure_note',
] as const;
export type SuggestionTarget = (typeof SUGGESTION_TARGETS)[number];

/** The targets that change an existing procedure: `source_id` names it. */
export const SUGGESTION_PROCEDURE_TARGETS = [
  'procedure_example',
  'procedure_note',
] as const satisfies readonly SuggestionTarget[];

/** What a review does (`PATCH /ai/suggestions/{id}` `action`). */
export const SUGGESTION_REVIEW_ACTIONS = ['edit', 'accept', 'reject', 'merge'] as const;
export type SuggestionReviewAction = (typeof SUGGESTION_REVIEW_ACTIONS)[number];

/** The list's filters (`GET /ai/suggestions` `status`): a status, the open ones, or all. */
export const SUGGESTION_LIST_STATUSES = [
  'new',
  'drafting',
  'in_review',
  'accepted',
  'rejected',
  'merged',
  'open',
  'all',
] as const;
export type SuggestionListStatus = (typeof SUGGESTION_LIST_STATUSES)[number];

// ---------------------------------------------------------------------------
// Limits — the migration's CHECKs use the same numbers.
// ---------------------------------------------------------------------------

/** The excerpt: the last messages up to the marked one (AI-23 "son 6 mesaj"). */
export const SUGGESTION_EXCERPT_MESSAGES = 6;

/** Each excerpt message is cut to this. */
export const SUGGESTION_EXCERPT_TEXT_MAX = 2000;

/** The agent's note. */
export const SUGGESTION_NOTE_MAX = 1000;

/** The proposal's title and body. */
export const SUGGESTION_TITLE_MAX = 200;
export const SUGGESTION_BODY_MAX = 4000;

/** The reviewer's note — required to reject. */
export const SUGGESTION_REVIEW_NOTE_MAX = 1000;

/** Suggestions per agent in a rolling day (AI-23 §1). */
export const SUGGESTIONS_PER_AGENT_PER_DAY = 50;

/** The knowledge passages a duplicate proposal names. */
export const SUGGESTION_SIMILAR_CHUNKS_MAX = 3;

/**
 * The cosine a proposal must reach against a knowledge passage to be called
 * "already there" (AI-23 §3, τ), by kind of embedding space: a model's
 * vectors are dense and close; the stub's bag of words is sparse.
 */
export const SUGGESTION_DUPLICATE_SIMILARITY = { model: 0.85, lexical: 0.6 } as const;

/** Suggestions drafted per workspace and pass of `ai_suggestion_drafts`. */
export const SUGGESTION_DRAFTS_PER_PASS = 20;

/**
 * AI-23-S2: an unresolved-questions cluster whose items agents answered at
 * least this many times in {@link SUGGESTION_CLUSTER_WINDOW_DAYS} opens one
 * `promote_agent_answer` suggestion — once per window.
 */
export const SUGGESTION_CLUSTER_ANSWERS_MIN = 3;
export const SUGGESTION_CLUSTER_WINDOW_DAYS = 7;

/** The list's page. */
export const SUGGESTION_LIST_LIMIT_DEFAULT = 50;
export const SUGGESTION_LIST_LIMIT_MAX = 100;

/**
 * The capabilities (RL-02 · `capabilities.ts`): to suggest (every member by
 * default) and to review — a Team Lead their teams' suggestions, an
 * administrator and the Founder all of them.
 */
export const AI_SUGGEST_CAPABILITY = 'ai.suggest' as const;
export const AI_SUGGESTIONS_REVIEW_CAPABILITY = 'ai.suggestions.review' as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One excerpt message, masked when the suggestion was made. */
export interface SuggestionExcerptMessage {
  event_id: string;
  author_type: 'customer' | 'agent' | 'bot';
  /** The model's message (`AI_BOT_ID`), not a rule bot's. */
  is_ai: boolean;
  text: string;
  created_at: string;
  /** The message the suggestion is about. */
  marked: boolean;
}

/** What accepting would write (`proposed_change`). */
export interface SuggestionProposedChange {
  target: SuggestionTarget;
  title: string;
  body: string;
  /** The knowledge source, behaviour rule or procedure it changes; null: a new one. */
  source_id: string | null;
}

/** What the drafting job took out of the agent's words (`removed_specifics`), by kind. */
export const SUGGESTION_SPECIFIC_KINDS = [
  'name',
  'username',
  'email',
  'phone',
  'amount',
  'date',
  'time',
  'reference',
] as const;
export type SuggestionSpecificKind = (typeof SUGGESTION_SPECIFIC_KINDS)[number];

/**
 * The placeholder each removed specific becomes in a draft — Turkish, as the
 * reviewers read it; a policy amount the generaliser took is written back by
 * the reviewer.
 */
export const SUGGESTION_SPECIFIC_PLACEHOLDERS: Readonly<Record<SuggestionSpecificKind, string>> = {
  name: '[oyuncu]',
  username: '[kullanıcı adı]',
  email: '[e-posta]',
  phone: '[telefon]',
  amount: '[tutar]',
  date: '[tarih]',
  time: '[saat]',
  reference: '[işlem no]',
};

/**
 * `ai_suggestion_created` (`RTM_PUSH_ACTIONS`): a suggestion reached the
 * queue. To the people who may review it — the Team Leads of its team and the
 * administrators — each with their own open count, the badge (AI-23 KK 1).
 */
export interface AiSuggestionCreatedPush {
  suggestion_id: string;
  ai_agent_id: string;
  kind: SuggestionKind;
  team_id: number | null;
  /** The recipient's open suggestions. */
  open_count: number;
}

/**
 * `ai_suggestion_reviewed`: the suggestion's author is told how it ended
 * (AI-23 §5) — the reviewer's note with it, never the excerpt.
 */
export interface AiSuggestionReviewedPush {
  suggestion_id: string;
  kind: SuggestionKind;
  status: 'accepted' | 'rejected' | 'merged';
  review_note: string | null;
}
