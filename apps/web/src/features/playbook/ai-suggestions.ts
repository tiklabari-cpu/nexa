/**
 * The AI coaching and suggestion queue as the panel reads it (tm 318.2 ·
 * SiyahTuş analysis AI-23): the wire shapes of `/ai/suggestions`
 * (`routes/ai-suggestions.ts`), the query keys they live under, the marks the
 * transcript offers and the badge the reviewers watch.
 *
 * An agent marks the AI's message ("wrong", "should have handed over",
 * "tone") or offers their own answer to its knowledge; a Team Lead or an
 * administrator reads the masked excerpt, edits the proposal and accepts it
 * into the AI-20 draft — or rejects it with a reason.
 */
import {
  AI_BOT_ID,
  SUGGESTION_AI_MESSAGE_KINDS,
  SUGGESTION_BODY_MAX,
  SUGGESTION_LIST_LIMIT_DEFAULT,
  SUGGESTION_OPEN_STATUSES,
  SUGGESTION_TITLE_MAX,
  type SuggestionExcerptMessage,
  type SuggestionKind,
  type SuggestionListStatus,
  type SuggestionProposedChange,
  type SuggestionSource,
  type SuggestionSpecificKind,
  type SuggestionStatus,
} from '@siyahtus/types';

export type { SuggestionExcerptMessage, SuggestionProposedChange };

export interface SuggestionSimilarSource {
  chunk_id: string;
  source_id: string;
  source_name: string;
}

export interface AiSuggestion {
  id: string;
  ai_agent_id: string;
  kind: SuggestionKind;
  source: SuggestionSource;
  status: SuggestionStatus;
  /** The day's container (panel: `ids.thread`). */
  chat_id: string | null;
  /** The connection (panel: `ids.chat`). */
  thread_id: string | null;
  event_ids: string[];
  excerpt: SuggestionExcerptMessage[];
  note: string | null;
  team_id: number | null;
  proposed_change: SuggestionProposedChange | null;
  removed_specifics: SuggestionSpecificKind[];
  drafted_by: 'llm' | 'lexical' | null;
  duplicate_of: string | null;
  cluster_id: string | null;
  already_known: boolean;
  similar_sources: SuggestionSimilarSource[];
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  resulting_change_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiSuggestionList {
  suggestions: AiSuggestion[];
  total: number;
  /** The open suggestions the caller may review — the badge. */
  open_count: number;
}

export const suggestionKeys = {
  all: ['ai-suggestions'] as const,
  list: (status: SuggestionListStatus, mine: boolean) =>
    ['ai-suggestions', 'list', status, mine] as const,
  detail: (id: string) => ['ai-suggestions', 'detail', id] as const,
  badge: ['ai-suggestions', 'badge'] as const,
};

export function suggestionListPath(status: SuggestionListStatus, mine: boolean): string {
  const params = new URLSearchParams({ status, limit: String(SUGGESTION_LIST_LIMIT_DEFAULT) });
  if (mine) params.set('mine', 'true');
  return `/ai/suggestions?${params.toString()}`;
}

/** The badge's request: one row is enough, the list answers `open_count` whatever the page. */
export const SUGGESTION_BADGE_PATH = '/ai/suggestions?status=open&limit=1';

export function isOpenSuggestion(suggestion: Pick<AiSuggestion, 'status'>): boolean {
  return (SUGGESTION_OPEN_STATUSES as readonly string[]).includes(suggestion.status);
}

/** The marks the transcript offers on one of the AI's messages, in the order of the chips. */
export const AI_MESSAGE_MARKS = SUGGESTION_AI_MESSAGE_KINDS;

/** What a message of the transcript can be suggested about, or null. */
export type SuggestionSubject = 'ai_message' | 'agent_message';

export function suggestionSubjectOf(event: {
  type: string;
  author_type: string;
  author_id: string | null;
  recipients: string;
  text: string | null;
}): SuggestionSubject | null {
  // The API reads a marked message that was said to all and is a plain message.
  if (event.type !== 'message' || event.recipients !== 'all') return null;
  if (event.text === null || event.text.trim() === '') return null;
  if (event.author_type === 'bot' && event.author_id === AI_BOT_ID) return 'ai_message';
  if (event.author_type === 'agent') return 'agent_message';
  return null;
}

/** An editable proposal as the detail pane holds it while it is typed. */
export interface ProposalDraft {
  target: SuggestionProposedChange['target'];
  title: string;
  body: string;
  source_id: string | null;
}

export function draftOf(suggestion: Pick<AiSuggestion, 'proposed_change'>): ProposalDraft | null {
  const change = suggestion.proposed_change;
  return change
    ? { target: change.target, title: change.title, body: change.body, source_id: change.source_id }
    : null;
}

/** Whether the proposal can be sent: both parts typed, within the server's limits. */
export function proposalIssue(draft: ProposalDraft): 'title' | 'body' | null {
  const title = draft.title.trim();
  if (title.length === 0 || title.length > SUGGESTION_TITLE_MAX) return 'title';
  const body = draft.body.trim();
  if (body.length === 0 || body.length > SUGGESTION_BODY_MAX) return 'body';
  return null;
}

export function sameProposal(
  draft: ProposalDraft,
  change: SuggestionProposedChange | null,
): boolean {
  return (
    change !== null &&
    draft.target === change.target &&
    draft.title.trim() === change.title &&
    draft.body.trim() === change.body &&
    draft.source_id === change.source_id
  );
}

/** What `PATCH` takes for a draft. */
export function proposalBody(draft: ProposalDraft): SuggestionProposedChange {
  return {
    target: draft.target,
    title: draft.title.trim(),
    body: draft.body.trim(),
    source_id: draft.source_id,
  };
}

/**
 * A procedure target names the procedure it changes (`source_id`); a new
 * snippet or rule needs none. Accepting a procedure change without one is the
 * server's 400 — the pane says so before the click.
 */
export function needsProcedure(draft: ProposalDraft): boolean {
  return (
    (draft.target === 'procedure_example' || draft.target === 'procedure_note') &&
    draft.source_id === null
  );
}
