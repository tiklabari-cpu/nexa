import type {
  AnswerLength,
  Cond,
  ClarifyThresholds,
  DailyMemorySettings,
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
  group?: string;
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
  active: boolean;
  skills_count: number;
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
