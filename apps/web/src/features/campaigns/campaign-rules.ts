/**
 * The campaign rule builder's logic (EN-03 · tm 352.2), free of React: a row
 * the person is still typing (every field a string) and the rule it becomes.
 *
 * The one validator is `campaignRuleProblem` in `@siyahtus/types`, the one the
 * API refuses with. Its sentences are English and meant for a 400, so the
 * builder asks it only whether a rule can be saved and says why in its own
 * words (`RuleProblem` → a catalogue key).
 */
import {
  campaignRuleOps,
  campaignRuleProblem,
  isCampaignNumericOp,
  normalizeCampaignConditions,
  type CampaignConditions,
  type CampaignMatchMode,
  type CampaignRule,
  type CampaignRuleField,
  type CampaignRuleOp,
} from '@siyahtus/types';

/** A rule as typed: every part is text until the row is saved. */
export interface RuleDraft {
  /** Stable across edits, so a row keeps its focus when another is removed. */
  id: number;
  field: CampaignRuleField;
  op: CampaignRuleOp;
  /** The variable's name — `custom_var` only. */
  key: string;
  value: string;
}

export type RuleProblem = 'value' | 'key' | 'seconds' | 'country' | 'number';

export function blankRule(id: number): RuleDraft {
  return { id, field: 'current_url', op: 'contains', key: '', value: '' };
}

/** Switching the field resets what no longer fits it: the operator and the value. */
export function withField(draft: RuleDraft, field: CampaignRuleField): RuleDraft {
  return {
    ...draft,
    field,
    op: campaignRuleOps(field)[0] ?? 'equals',
    key: '',
    value: field === 'exit_intent' ? 'true' : field === 'visitor_type' ? 'new' : '',
  };
}

/** The rows of a stored trigger — the first shape reads as one URL rule; none yields one blank row. */
export function draftsFromConditions(conditions: CampaignConditions | undefined): {
  match: CampaignMatchMode;
  drafts: RuleDraft[];
} {
  const set = normalizeCampaignConditions(conditions);
  const drafts = set.rules.map((rule, index): RuleDraft => ({
    id: index + 1,
    field: rule.field,
    op: rule.op,
    key: rule.key ?? '',
    value: String(rule.value),
  }));
  return { match: set.match, drafts: drafts.length > 0 ? drafts : [blankRule(1)] };
}

export function ruleFromDraft(draft: RuleDraft): CampaignRule {
  const text = draft.value.trim();
  switch (draft.field) {
    case 'time_on_page':
      return { field: draft.field, op: draft.op, value: Number(text) };
    case 'exit_intent':
      return { field: draft.field, op: draft.op, value: true };
    case 'country':
      return { field: draft.field, op: draft.op, value: text.toUpperCase() };
    case 'custom_var':
      return { field: draft.field, op: draft.op, value: text, key: draft.key.trim() };
    default:
      return { field: draft.field, op: draft.op, value: text };
  }
}

/** What stops this row from being saved, or null. */
export function draftProblem(draft: RuleDraft): RuleProblem | null {
  if (draft.field === 'custom_var' && !draft.key.trim()) return 'key';
  if (draft.field !== 'exit_intent' && !draft.value.trim()) return 'value';
  if (campaignRuleProblem(ruleFromDraft(draft)) === null) return null;
  if (draft.field === 'time_on_page') return 'seconds';
  if (draft.field === 'country') return 'country';
  if (draft.field === 'custom_var' && isCampaignNumericOp(draft.op)) return 'number';
  return 'value';
}

/** The trigger to send. */
export function conditionsFromDrafts(
  match: CampaignMatchMode,
  drafts: readonly RuleDraft[],
): { match: CampaignMatchMode; rules: CampaignRule[] } {
  return { match, rules: drafts.map(ruleFromDraft) };
}
