/**
 * What the compliance-guardrails screen (tm 301.4 · AI-08) decides without
 * drawing anything: which words a refusal is shown in, how a scope is edited,
 * and who may write.
 */
import {
  FORBIDDEN_PHRASE_PROBLEMS,
  GUARDRAIL_PLATFORM_LOCKED_REASON,
  readGuidanceScope,
  type GuidanceScope,
} from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';

/**
 * The owner writes the guardrails (`exactRole: 'owner'` on every write); an
 * admin and the rest of the roster with the AI scope read.
 */
export function canWriteGuardrails(role: string | null, hasAiScope: boolean): boolean {
  return hasAiScope && role === 'owner';
}

/**
 * The catalogue key that answers a failed guardrail call. A write against the
 * locked platform rules (403 `guardrail_platform_locked`) and a phrase the
 * server will not store (400 `validation`, `details.reason`) each have a
 * sentence of their own; everything else is the generic one for its type.
 */
export function guardrailErrorKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    const reason = error.details?.['reason'];
    if (error.type === 'not_allowed' && reason === GUARDRAIL_PLATFORM_LOCKED_REASON) {
      return 'playbook.guardrails.error.locked';
    }
    if (error.type === 'validation' && typeof reason === 'string') {
      if ((FORBIDDEN_PHRASE_PROBLEMS as readonly string[]).includes(reason)) {
        return `playbook.guardrails.phrases.problem.${reason}`;
      }
      if (PHRASE_LIMIT_REASONS.has(reason)) return `playbook.guardrails.phrases.problem.${reason}`;
      if (reason === 'guardrail_crisis_text_missing') {
        return 'playbook.guardrails.settings.approveNeedsText';
      }
    }
  }
  return errorMessageKey(error);
}

/** Refusals the server raises that are not about one phrase's form. */
const PHRASE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'forbidden_phrase_exists',
  'forbidden_phrases_limit',
  'forbidden_phrase_regex_limit',
]);

// ---------------------------------------------------------------------------
// Scope.
// ---------------------------------------------------------------------------

/**
 * What the scope editor holds. A brand scope is shown, never authored (the turn
 * does not know its brand yet, tm 309): an item written over the API keeps it
 * through an edit, and the editor offers no way to make a new one.
 */
export interface ScopeDraft {
  mode: 'all' | 'skills' | 'brands';
  skillIds: string[];
}

export const NEW_SCOPE_DRAFT: ScopeDraft = { mode: 'all', skillIds: [] };

export function scopeDraftOf(rawScope: unknown): ScopeDraft {
  const scope = readGuidanceScope(rawScope);
  if (scope && 'skill_ids' in scope) return { mode: 'skills', skillIds: scope.skill_ids };
  if (scope && 'brand_ids' in scope) return { mode: 'brands', skillIds: [] };
  return NEW_SCOPE_DRAFT;
}

/** The scope a draft stands for; a brand scope is carried over from the item as it was. */
export function scopeOfDraft(draft: ScopeDraft, original: unknown): GuidanceScope {
  if (draft.mode === 'skills') return { skill_ids: draft.skillIds };
  if (draft.mode === 'brands') {
    const kept = original === null ? null : readGuidanceScope(original);
    if (kept && 'brand_ids' in kept) return kept;
  }
  return { all: true };
}

export function scopeIsEmpty(draft: ScopeDraft): boolean {
  return draft.mode === 'skills' && draft.skillIds.length === 0;
}
