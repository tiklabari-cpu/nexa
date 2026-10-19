/**
 * What the hand-over screen (tm 303.5 · AI-09) decides without drawing
 * anything: the shapes it reads, the sentence a refusal is shown in, how a rule
 * is edited and what a new order sends.
 *
 * The rules live in `@siyahtus/types` (`handoff.ts`, `handoff-rules.ts`) — the
 * triggers' bounds, the locked reasons, the ready-made examples. This file adds
 * only what the screen needs on top: the draft of a rule a form holds, and the
 * body it turns into.
 */
import {
  AI_STALL_TIMEOUT_SECONDS_MAX,
  AI_STALL_TIMEOUT_SECONDS_MIN,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_RULE_PHRASE_MAX,
  HANDOFF_RULE_TITLE_MAX,
  HANDOFF_RULE_TOPICS,
  HANDOFF_TRIGGER_BOUNDS,
  HANDOFF_TRIGGER_LOCKED_REASON,
  RISK_FLAG_TYPES,
  type Cond,
  type HandoffMessageReason,
  type HandoffRulePriority,
  type HandoffRuleTarget,
  type HandoffRuleTopic,
  type HandoffRuleTrigger,
  type HandoffRuleTriggerType,
  type HandoffTarget,
  type HandoffTriggers,
  type ProcedureProblemDetails,
  type RiskFlagType,
} from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { moveStep } from './step-reorder.js';

/** `GET|PUT /ai-agents/{id}/handoff-settings`. */
export interface HandoffSettings {
  ai_agent_id: string;
  assignment_mode: 'ai_first' | 'parallel';
  ai_stall_timeout_seconds: number;
  triggers: HandoffTriggers;
  /** By reason; null or absent is the default sentence. */
  messages: Partial<Record<string, string | null>>;
  after_hours: { text: string | null };
  /** The agent's default "resolved" criteria; null is the platform's. */
  resolution_criteria: Cond | null;
}

/** One hand-over rule of the workspace (`GET …/handoff-rules`). */
export interface HandoffRule {
  id: string;
  ai_agent_id: string;
  position: number;
  active: boolean;
  title: string;
  trigger: HandoffRuleTrigger;
  target: HandoffRuleTarget | null;
  priority: HandoffRulePriority;
}

/** A platform compliance rule the list shows greyed out. */
export interface LockedHandoffRuleRow {
  id: string;
  title: { tr: string; en: string };
  reason: string | null;
  target: HandoffRuleTarget | null;
  priority: HandoffRulePriority;
}

export interface HandoffRuleExampleRow {
  key: string;
  title: { tr: string; en: string };
  trigger: HandoffRuleTrigger;
  target: HandoffRuleTarget | null;
  priority: HandoffRulePriority;
}

export interface HandoffRuleList {
  ai_agent_id: string;
  locked: LockedHandoffRuleRow[];
  items: HandoffRule[];
  examples: HandoffRuleExampleRow[];
}

export const handoffSettingsKey = (agentId: string) =>
  ['playbook', 'handoff', 'settings', agentId] as const;
export const handoffRulesKey = (agentId: string) =>
  ['playbook', 'handoff', 'rules', agentId] as const;

/** The refusals the hand-over routes name in `details.reason`. */
const HANDOFF_REFUSALS: ReadonlySet<string> = new Set([
  HANDOFF_TRIGGER_LOCKED_REASON,
  'handoff_rule_unknown_procedure',
  'handoff_rule_unknown_team',
  'handoff_rules_order_mismatch',
  'handoff_rules_limit',
]);

/**
 * The catalogue key that answers a failed hand-over call: a refusal the
 * routes name has a sentence of its own, everything else the generic one for
 * its type. (A refused "resolved" criteria is a procedure problem, worded by
 * {@link resolutionProblem} instead.)
 */
export function handoffErrorKey(error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'validation') {
    const reason = error.details?.['reason'];
    if (typeof reason === 'string' && HANDOFF_REFUSALS.has(reason)) {
      return `playbook.handoff.error.${reason}`;
    }
  }
  return errorMessageKey(error);
}

/** The procedure problem a refused "resolved" criteria carries, or null. */
export function resolutionProblem(error: unknown): ProcedureProblemDetails | null {
  if (!(error instanceof ApiClientError) || error.type !== 'validation') return null;
  const details = error.details;
  if (
    details === undefined ||
    details['section'] !== 'handoff' ||
    details['field'] !== 'resolution_criteria' ||
    typeof details['reason'] !== 'string'
  ) {
    return null;
  }
  return details as unknown as ProcedureProblemDetails;
}

/** The new order of `ids` after moving the rule at `from` to `to` — what `PUT …/order` takes. */
export function reorderedIds(rules: readonly HandoffRule[], from: number, to: number): string[] {
  return moveStep(
    rules.map((rule) => rule.id),
    from,
    to,
  );
}

// ---------------------------------------------------------------------------
// The rule form.
// ---------------------------------------------------------------------------

/** Where a rule sends the conversation, as the form holds it. */
export type RuleTargetKind = 'default' | 'team' | 'topic';

export interface RuleDraft {
  title: string;
  triggerType: HandoffRuleTriggerType;
  /** The topic, the procedure's id, the phrase or the risk flag type; '' for the two routing triggers. */
  triggerValue: string;
  targetKind: RuleTargetKind;
  /** The team, as the select holds it (a number as text). */
  groupId: string;
  topic: string;
  priority: HandoffRulePriority;
}

export const BLANK_RULE_DRAFT: RuleDraft = {
  title: '',
  triggerType: 'topic',
  triggerValue: HANDOFF_RULE_TOPICS[0],
  targetKind: 'default',
  groupId: '',
  topic: '',
  priority: 'normal',
};

/** What a new rule of this trigger type starts its value as. */
export function defaultTriggerValue(type: HandoffRuleTriggerType): string {
  switch (type) {
    case 'topic':
      return HANDOFF_RULE_TOPICS[0];
    case 'risk_flag':
      return RISK_FLAG_TYPES[0];
    default:
      return '';
  }
}

/** Whether the trigger takes a value at all (the two routing triggers do not). */
export function triggerTakesValue(type: HandoffRuleTriggerType): boolean {
  return type !== 'ai_unresolved' && type !== 'player_request';
}

export function targetDraft(
  target: HandoffRuleTarget | null,
): Pick<RuleDraft, 'targetKind' | 'groupId' | 'topic'> {
  if (target !== null && 'group_id' in target) {
    return { targetKind: 'team', groupId: String(target.group_id), topic: '' };
  }
  if (target !== null && 'topic' in target) {
    return { targetKind: 'topic', groupId: '', topic: target.topic };
  }
  return { targetKind: 'default', groupId: '', topic: '' };
}

export function draftOfRule(
  rule: Pick<HandoffRule, 'title' | 'trigger' | 'target' | 'priority'>,
): RuleDraft {
  return {
    title: rule.title,
    triggerType: rule.trigger.type,
    triggerValue: rule.trigger.value ?? '',
    ...targetDraft(rule.target),
    priority: rule.priority,
  };
}

/** The target a draft stands for; null is the usual routing. */
export function targetOfDraft(draft: RuleDraft): HandoffTarget | null {
  if (draft.targetKind === 'team') return { group_id: Number(draft.groupId) };
  if (draft.targetKind === 'topic') return { topic: draft.topic.trim() };
  return null;
}

/** The trigger a draft stands for — the value as the API takes it. */
export function triggerOfDraft(draft: RuleDraft): {
  type: HandoffRuleTriggerType;
  value: string | null;
} {
  return {
    type: draft.triggerType,
    value: triggerTakesValue(draft.triggerType) ? draft.triggerValue.trim() : null,
  };
}

/** What is wrong with a draft, as the catalogue keys that word it; none is a rule the API will take. */
export function ruleDraftProblems(draft: RuleDraft): string[] {
  const problems: string[] = [];
  const title = draft.title.trim();
  if (title === '') problems.push('playbook.handoff.rules.problem.titleEmpty');
  else if (title.length > HANDOFF_RULE_TITLE_MAX) {
    problems.push('playbook.handoff.rules.problem.titleLong');
  }
  const value = draft.triggerValue.trim();
  if (draft.triggerType === 'phrase') {
    if (value === '') problems.push('playbook.handoff.rules.problem.phraseEmpty');
    else if (value.length > HANDOFF_RULE_PHRASE_MAX) {
      problems.push('playbook.handoff.rules.problem.phraseLong');
    }
  }
  if (draft.triggerType === 'procedure' && value === '') {
    problems.push('playbook.handoff.rules.problem.procedureEmpty');
  }
  if (draft.targetKind === 'team' && !Number.isInteger(Number(draft.groupId || 'x'))) {
    problems.push('playbook.handoff.rules.problem.teamEmpty');
  }
  if (draft.targetKind === 'topic' && !/^[a-z][a-z0-9_]{0,63}$/.test(draft.topic.trim())) {
    problems.push('playbook.handoff.rules.problem.topicBad');
  }
  return problems;
}

/** `POST`/`PATCH …/handoff-rules` body for a draft. */
export function ruleBody(draft: RuleDraft): {
  title: string;
  trigger: { type: HandoffRuleTriggerType; value: string | null };
  target: HandoffTarget | null;
  priority: HandoffRulePriority;
} {
  return {
    title: draft.title.trim(),
    trigger: triggerOfDraft(draft),
    target: targetOfDraft(draft),
    priority: draft.priority,
  };
}

/** `POST` body for a ready-made example, in the console's language. */
export function exampleBody(
  example: HandoffRuleExampleRow,
  lang: 'tr' | 'en',
): {
  title: string;
  trigger: HandoffRuleTrigger;
  target: HandoffRuleTarget | null;
  priority: HandoffRulePriority;
} {
  return {
    title: example.title[lang],
    trigger: example.trigger,
    target: example.target,
    priority: example.priority,
  };
}

/** The topics a `topic` trigger names, in the order the form lists them. */
export const TOPIC_OPTIONS: readonly HandoffRuleTopic[] = HANDOFF_RULE_TOPICS;
export const RISK_FLAG_OPTIONS: readonly RiskFlagType[] = RISK_FLAG_TYPES;

/** Whether the example is already in the list (same trigger value and type). */
export function exampleInstalled(
  example: HandoffRuleExampleRow,
  rules: readonly HandoffRule[],
): boolean {
  return rules.some(
    (rule) =>
      rule.trigger.type === example.trigger.type && rule.trigger.value === example.trigger.value,
  );
}

// ---------------------------------------------------------------------------
// The triggers form.
// ---------------------------------------------------------------------------

/** What the triggers card holds: the tunable triggers and how a conversation is first assigned. */
export interface TriggersForm {
  assignmentMode: 'ai_first' | 'parallel';
  stallSeconds: number;
  triggers: HandoffTriggers;
}

export function triggersFormOf(settings: HandoffSettings): TriggersForm {
  return {
    assignmentMode: settings.assignment_mode,
    stallSeconds: settings.ai_stall_timeout_seconds,
    triggers: structuredClone(settings.triggers),
  };
}

/** `NaN` (an emptied box) and a count outside its bounds are refused by the API; the card says which. */
export type TriggersProblem =
  'notUnderstoodTurns' | 'negativeConsecutive' | 'abuseWarnings' | 'maxTurns' | 'stallSeconds';

function inBounds(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

export function triggersProblems(form: TriggersForm): TriggersProblem[] {
  const b = HANDOFF_TRIGGER_BOUNDS;
  const problems: TriggersProblem[] = [];
  if (!inBounds(form.triggers.not_understood.turns, b.not_understood_turns)) {
    problems.push('notUnderstoodTurns');
  }
  if (!inBounds(form.triggers.negative_sentiment.consecutive, b.negative_sentiment_consecutive)) {
    problems.push('negativeConsecutive');
  }
  if (!inBounds(form.triggers.abuse.warnings, b.abuse_warnings)) problems.push('abuseWarnings');
  if (!inBounds(form.triggers.max_turns.turns, b.max_turns)) problems.push('maxTurns');
  if (
    form.assignmentMode === 'ai_first' &&
    !inBounds(form.stallSeconds, {
      min: AI_STALL_TIMEOUT_SECONDS_MIN,
      max: AI_STALL_TIMEOUT_SECONDS_MAX,
    })
  ) {
    problems.push('stallSeconds');
  }
  return problems;
}

/** `PUT …/handoff-settings` body for the card: every field it shows. */
export function triggersBody(form: TriggersForm): {
  assignment_mode: 'ai_first' | 'parallel';
  ai_stall_timeout_seconds?: number;
  triggers: HandoffTriggers;
} {
  return {
    assignment_mode: form.assignmentMode,
    // The wait is only the agent's to set when it answers first.
    ...(form.assignmentMode === 'ai_first' ? { ai_stall_timeout_seconds: form.stallSeconds } : {}),
    triggers: form.triggers,
  };
}

export function triggersFormChanged(form: TriggersForm, settings: HandoffSettings): boolean {
  const stored = triggersFormOf(settings);
  return (
    form.assignmentMode !== stored.assignmentMode ||
    (form.assignmentMode === 'ai_first' && form.stallSeconds !== stored.stallSeconds) ||
    JSON.stringify(form.triggers) !== JSON.stringify(stored.triggers)
  );
}

// ---------------------------------------------------------------------------
// The messages form.
// ---------------------------------------------------------------------------

/** The sentence per reason as the card holds it: '' is the default. */
export type MessagesForm = Record<HandoffMessageReason, string>;

export function messagesFormOf(settings: HandoffSettings): MessagesForm {
  const form = {} as MessagesForm;
  for (const reason of HANDOFF_MESSAGE_REASONS) form[reason] = settings.messages[reason] ?? '';
  return form;
}

/** The reasons whose sentence differs from what is stored, with the value the PUT sends (null: back to the default). */
export function messagesChange(
  form: MessagesForm,
  settings: HandoffSettings,
): Partial<Record<HandoffMessageReason, string | null>> {
  const stored = messagesFormOf(settings);
  const change: Partial<Record<HandoffMessageReason, string | null>> = {};
  for (const reason of HANDOFF_MESSAGE_REASONS) {
    const next = form[reason].trim();
    if (next !== stored[reason].trim()) change[reason] = next === '' ? null : next;
  }
  return change;
}

export function afterHoursChanged(text: string, settings: HandoffSettings): boolean {
  return text.trim() !== (settings.after_hours.text ?? '').trim();
}
