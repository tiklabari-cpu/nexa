import type {
  AddressForm,
  AnswerLength,
  Cond,
  ClarifyThresholds,
  CrawlScope,
  DailyMemorySettings,
  EmojiUse,
  ForbiddenPhraseAction,
  ForbiddenPhraseMatch,
  GuardrailCategory,
  GuardrailHitAction,
  GuardrailRuleAction,
  GuidanceCategory,
  GuidanceScope,
  KnowledgeAudience,
  KnowledgeJobKind,
  KnowledgeJobStatus,
  KnowledgePageStatus,
  ProcedureProblemDetails,
  SkillMode,
  SkillProcedureBody,
  SlotDef,
} from '@siyahtus/types';

export type { AnswerLength };

export interface SkillStep {
  type:
    'detect_intent' | 'request_info' | 'tag' | 'summarize' | 'send_message' | 'transfer_to_team';
  intent?: string;
  phrases?: string[];
  field?: string;
  prompt?: string;
  tag?: string;
  source?: 'text' | 'knowledge';
  text?: string;
  /** The team's name, kept beside its id (AI-12 · tm 307.1); read by a release that predates ids. */
  group?: string;
  /** The team, by id — renaming it keeps the step working. */
  group_id?: number;
}

export interface Skill {
  id: string;
  ai_agent_id: string | null;
  name: string;
  kind: string;
  instruction: string | null;
  steps: SkillStep[];
  active: boolean;
  runs_count: number;
  updated_at: string;
  created_by_name: string | null;
  created_by_id: string | null;
  /**
   * The procedure fields (tm 296.2). The API always sends them; they are
   * optional here so a row written before them (or a test fixture) reads as a
   * `single` skill with the defaults.
   */
  mode?: SkillMode;
  when_to_use?: string | null;
  examples?: string[];
  priority?: number;
  slots?: SlotDef<Cond>[];
  procedure?: SkillProcedureBody | null;
  /** A locked template copy (`self_exclusion`, …): only its texts and its team may change. */
  locked?: boolean;
  template_key?: string | null;
  template_version?: number | null;
  is_fallback?: boolean;
}

export interface AiAgent {
  id: string;
  name: string;
  kind: 'ai_agent' | 'copilot';
  tone: string | null;
  avatar_url: string | null;
  languages: string[];
  answer_length: AnswerLength | null;
  /** Seconds the agent waits for the visitor to stop typing; null is the workspace default. */
  batch_window_seconds: number | null;
  /** Same-day memory (tm 294 · AI-02); absent reads as the default. */
  daily_memory?: DailyMemorySettings;
  /** How sure the agent must be of a procedure (tm 297.2 · AI-05); absent reads as the default. */
  clarify_thresholds?: ClarifyThresholds;
  /** How the player is addressed, whether emoji are used, questions per message (tm 299 · AI-07); null is unset. */
  address_form?: AddressForm | null;
  emoji?: EmojiUse | null;
  max_questions_per_message?: number | null;
  /** The opening words after the AI disclosure, and the button's wording (tm 308 · AI-29); null is unset. */
  welcome_message?: string | null;
  human_button_label?: string | null;
  active: boolean;
  skills_count: number;
}

/** One behaviour rule of the AI agent (`GET /ai-guidance`, tm 299 · AI-07). */
export interface GuidanceRule {
  id: string;
  ai_agent_id: string;
  title: string;
  body: string;
  category: GuidanceCategory;
  scope: GuidanceScope;
  priority: number;
  active: boolean;
  owner_id?: string | null;
  updated_at: string;
}

/** `POST /ai-guidance/check`'s answer: warnings only, except `locked`, which a save refuses. */
export interface GuidanceCheck {
  locked: {
    locked_rule: 'credentials' | 'mandatory_bonus' | 'disable_locked';
    explanation: string;
  } | null;
  conflicts: { rule_id: string; explanation: string; severity: 'warning' | 'error' }[];
  duplicates: { rule_id: string; explanation: string }[];
  vague: { explanation: string }[];
  compared: number;
  checked_by: 'model' | 'rules';
}

/** One locked platform guardrail (`GET /ai-guardrails/platform`, tm 301.2 · AI-08). */
export interface PlatformGuardrail {
  id: string;
  title: { tr: string; en: string };
  prompt: { tr: string; en: string };
  category: GuardrailCategory;
  action: 'force_handoff' | 'block_output' | 'block_promo' | 'warn';
  target: 'responsible_gaming' | 'kyc_risk' | 'complaints' | null;
  priority: 'urgent' | 'high' | 'normal';
  tenant_text: 'crisis' | 'complaint' | 'access_info' | null;
  stages: ('input' | 'output')[];
  locked: true;
}

export interface PlatformGuardrails {
  version: string;
  rules: PlatformGuardrail[];
}

/** An AI agent's guardrail texts and judge switch (`GET /ai-guardrails/settings`). */
export interface GuardrailSettings {
  ai_agent_id: string;
  crisis_text: string | null;
  complaint_text: string | null;
  judge_enabled: boolean;
  crisis_text_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  crisis_text_draft: string | null;
  setup_problem: 'crisis_text_missing' | 'crisis_text_not_approved' | null;
  updated_at: string | null;
}

/** A workspace's compliance rule (`GET /ai-guardrails/rules`). */
export interface GuardrailRule {
  id: string;
  ai_agent_id: string;
  title: string;
  body: string;
  category: GuardrailCategory;
  action: GuardrailRuleAction;
  scope: GuidanceScope;
  active: boolean;
  updated_at: string;
}

/** A phrase the AI's replies must not carry (`GET /ai-guardrails/phrases`). */
export interface ForbiddenPhrase {
  id: string;
  ai_agent_id: string;
  phrase: string;
  match: ForbiddenPhraseMatch;
  lang: string | null;
  scope: GuidanceScope;
  action: ForbiddenPhraseAction;
  active: boolean;
  updated_at: string;
}

/** One guardrail a turn found broken (`GET /ai-guardrails/hits`). */
export interface GuardrailHitRecord {
  id: string;
  /** The day container (ids.thread) — the inbox opens it with ?chat=. */
  chat_id: string;
  thread_id: string;
  turn_id: string;
  rule_key: string;
  stage: 'input' | 'output';
  action_taken: GuardrailHitAction;
  evidence: string | null;
  catalog_version: string;
  created_at: string;
}

export interface SkillLogEntry {
  step: string;
  detail: string;
  ok: boolean;
}

/**
 * One recorded execution of a skill (`GET /skills/:skillId/runs`).
 *
 * `status` is whether the run completed; `outcome` is what it decided to do to
 * the chat — the two answer different questions, and a run can succeed while
 * deciding to do nothing. `outcome` is null for runs recorded before the log
 * gained one, so the UI must render a status-only row rather than a blank.
 */
export interface SkillRun {
  id: string;
  chat_id: string | null;
  /** The connection inside that day; null on a run recorded before it was kept (ID-05). */
  thread_id?: string | null;
  status: 'succeeded' | 'failed' | 'aborted';
  outcome: 'answered' | 'handed_off' | 'skipped' | null;
  ran_at: string;
  log: SkillLogEntry[];
}

export interface SkillPreview {
  outcome: 'answered' | 'handed_off' | 'skipped';
  reply: string | null;
  tags: string[];
  transfer_to: string | null;
  summary: string | null;
  log: SkillLogEntry[];
  /** The English sentences, for API callers; the editor words `error_details` instead. */
  errors: string[];
  /** The same refusals as codes, one per entry of `errors` and in its order (tm 261). */
  error_details?: StepProblem[];
  /** The state the turn would leave on a new connection (tm 296.4). */
  state?: AiConversationState;
  /** Why a procedure preview did not run: what a save would refuse, as codes. */
  procedure_problems?: ProcedureProblemDetails[];
}

/** `POST /skills/compile`'s answer; `draft` only for `mode: 'procedure'` (tm 296.4). */
export interface SkillCompileResult {
  mode?: SkillMode;
  steps: SkillStep[];
  unrecognised: string[];
  draft?: SkillProcedureDraft;
}

/** A procedure drafted from an SOP — `POST /skills`'s fields and the validator's verdict. */
export interface SkillProcedureDraft {
  name: string;
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: SlotDef<Cond>[];
  procedure: SkillProcedureBody;
  source: 'rules' | 'model';
  problems: ProcedureProblemDetails[];
  warnings: ProcedureProblemDetails[];
}

/** One slot as `AiConversationState` reads it back — its `display`, never the raw value. */
export interface AiConversationSlot {
  name: string;
  label: string;
  type: string | null;
  status: 'missing' | 'filled' | 'partial' | 'invalid' | 'refused' | 'unknown' | 'carried';
  display: string | null;
  source: 'player' | 'carried' | 'inferred';
  attempts: number;
  sensitive: boolean;
}

export interface AiConversationProcedure {
  skill_id: string;
  skill_name: string | null;
  snapshot_hash: string | null;
  step_id: string | null;
  step_status: 'awaiting_answer' | 'ready' | 'done' | null;
}

/** Where the AI stands on a connection — and where a preview turn would leave it. */
export interface AiConversationState {
  mode: 'ai' | 'human' | 'paused';
  procedure: AiConversationProcedure | null;
  slots: AiConversationSlot[];
  suspended: (AiConversationProcedure & { slots: AiConversationSlot[] }) | null;
  turns: number;
  outcome: 'resolved' | 'resolved_waiting' | 'handed_off' | 'abandoned' | 'no_ai' | null;
}

/** An earlier message of the preview's conversation (`POST /skills/preview` `conversation`). */
export interface PreviewExchange {
  role: 'visitor' | 'ai' | 'agent';
  text: string;
}

export interface StepProblem {
  reason: string;
  /** 1-based; absent when the list as a whole was refused. */
  step?: number;
  /** The unrecognised type, for `unknown_step_type`. */
  type?: string;
}

/** One page of a website source's crawl (`GET /knowledge-sources/{id}/pages`). */
export interface KnowledgePage {
  id: string;
  url: string;
  title?: string | null;
  lang?: string | null;
  status: KnowledgePageStatus;
  http_status?: number | null;
  /** A snake_case code saying why the page is `error` or `blocked`. */
  error?: string | null;
  depth?: number;
  chunk_count: number;
  fetched_at?: string | null;
  changed_at?: string | null;
}

/** A knowledge job's progress (`GET /knowledge-jobs/{id}`). */
export interface KnowledgeJob {
  id: string;
  source_id: string;
  kind: KnowledgeJobKind;
  status: KnowledgeJobStatus;
  pages: {
    discovered: number;
    done: number;
    ok: number;
    unchanged: number;
    skipped: number;
    failed: number;
    removed: number;
  };
  error?: string | null;
  available_at?: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface KnowledgeSource {
  id: string;
  ai_agent_id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
  updated_at: string;
  added_by_name: string | null;
  /** Days between automatic re-crawls. Null (every source's default) means never. Website only. */
  refresh_after_days: number | null;
  /** When the freshness sweep will next attempt this source. Null whenever `refresh_after_days` is null. */
  next_refresh_at: string | null;
  /** Why the last refresh attempt failed, if it did. Cleared on the next success. */
  last_refresh_error: string | null;
  /**
   * How a website is crawled (tm 312 · AI-17). Optional because a list from a
   * release that predates the crawler omits them; null for the other types.
   */
  crawl_scope?: CrawlScope | null;
  page_limit?: number | null;
  include_paths?: string[];
  exclude_paths?: string[];
  last_crawled_at?: string | null;
  /** Pages the last crawl left in the store (`ok` + `unchanged`). */
  page_count?: number;
  /** The source's crawl under way, followed at `GET /knowledge-jobs/{id}`; null when none. */
  job_id?: string | null;
  /**
   * Who is the store's scope for (tm 309 · AI-14). Optional because a list from
   * a release that predates the single store omits them; they read as the
   * defaults — both audiences, every agent, every brand, no end, unowned.
   */
  audiences?: KnowledgeAudience[];
  ai_agent_ids?: string[];
  brand_ids?: string[];
  valid_until?: string | null;
  /** The published KB article this source mirrors; its text and scope are the article's. */
  kb_article_id?: string | null;
  language?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  /** When a person last confirmed the source still holds (AI-14-S3). */
  reviewed_at?: string;
  review_interval_days?: number;
  review_due_at?: string;
}

/** One CSV data row's verdict from a bulk import (FR-MOD-06.3.2). */
export interface KnowledgeBulkRowResult {
  line: number;
  name: string | null;
  type: string | null;
  status: 'imported' | 'skipped';
  id: string | null;
  chunk_count: number | null;
  added_by_name: string | null;
  error: string | null;
}

/**
 * The response from `POST /knowledge-sources/bulk`. `dry_run` is what makes
 * `imported`/`results` a preview rather than a write — see
 * `BulkImportForm.tsx`.
 */
export interface KnowledgeBulkResult {
  imported: number;
  failed: number;
  dry_run: boolean;
  results: KnowledgeBulkRowResult[];
}

/** A public KB category (PUBKB-a), used to file and label an article. */
export interface KbCategory {
  id: string;
  slug: string;
  name: string;
  position: number;
  created_at: string;
}

/**
 * A public KB article as the management CRUD returns it (PUBKB-b) — draft
 * until an explicit publish, at which point `published_at` is stamped.
 */
export interface KbArticle {
  id: string;
  category_id: string | null;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Who besides the reader may use the article once published; empty — the AI does not (AI-14-S2). */
  ai_audiences?: KnowledgeAudience[];
}

/** Human-readable one-liner for a step, used in the editor list. */
export function describeStep(step: SkillStep): string {
  switch (step.type) {
    case 'detect_intent':
      return `Only run when the message is about “${step.intent ?? '?'}”`;
    case 'request_info':
      return `Ask for ${step.field ?? 'information'} — “${step.prompt ?? ''}”`;
    case 'tag':
      return `Tag the conversation “${step.tag ?? '?'}”`;
    case 'summarize':
      return 'Write a summary for the agent who picks it up';
    case 'send_message':
      return step.source === 'knowledge'
        ? 'Answer from the knowledge base'
        : `Reply “${step.text ?? ''}”`;
    case 'transfer_to_team':
      return `Hand over to ${step.group ?? '?'}`;
    default:
      return step.type;
  }
}
