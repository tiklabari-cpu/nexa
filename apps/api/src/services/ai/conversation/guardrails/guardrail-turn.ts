/**
 * The turns the guardrails decide themselves (tm 301.3 · AI-08 §3, §8):
 *
 *   - **a forced hand-over** ({@link guardrailHandoffTurn}): a rule the
 *     player's message or the understanding call's signal set off. No
 *     persuasion, no answer to the question — G1's "hesabımı kapatın" gets no
 *     bonus and no "are you sure?" — and the conversation goes to a person in
 *     the same turn, to the rule's team (AI-12's routing topic) with its
 *     priority, for its reason (AI-09). G3 sends the workspace's crisis text
 *     verbatim first, whatever the hour: the turn runs before any procedure,
 *     so no working-hours condition stands in front of it. G15 gives the
 *     complaint procedure;
 *   - **the safe text** ({@link safeText}): what a draft still in breach after
 *     its rewrite is replaced by ("Bilgilerinizi ilgili ekibimize
 *     iletiyorum"), with a hand-over for `guardrail_output_block`;
 *   - **a calm warning** ({@link abuseWarning}): G19's, before its hand-over.
 */
import {
  GUARDRAIL_PRIORITIES,
  GUARDRAIL_SAFE_TEXT,
  type GuardrailPriority,
  type PersonaLanguage,
  type RiskPolicy,
  type HandoffReason,
} from '@siyahtus/types';
import { NO_ANSWER_PHRASES } from '../knowledge-answer.js';
import type { AiStateObject } from '../state-store.js';
import {
  turnsTaken,
  type SkillRunLogEntry,
  type TurnDecisions,
  type TurnMessage,
  type TurnResult,
  type TurnSideEffect,
  type TurnState,
} from '../turn.js';
import type { GuardrailAgentSettings } from './config.js';
import {
  leadingTrigger,
  raisedRiskFlags,
  triggerEvidence,
  type GuardrailTrigger,
} from './input-scan.js';
import { guardrailHit, type GuardrailHitRecord, type GuardrailRecord } from './record.js';

/** `GUARDRAIL_SAFE_TEXT` in every persona language (the catalogue writes it in two). */
const SAFE_TEXTS: Readonly<Record<PersonaLanguage, string>> = {
  tr: GUARDRAIL_SAFE_TEXT.tr,
  en: GUARDRAIL_SAFE_TEXT.en,
  de: 'Ich leite Ihre Angaben an das zuständige Team weiter.',
  fr: 'Je transmets vos informations à l’équipe concernée.',
  es: 'Paso sus datos al equipo que se encarga de esto.',
};

export function safeText(lang: PersonaLanguage | null): string {
  return SAFE_TEXTS[lang ?? 'tr'];
}

/** G19's calm warning (AI-08 G19 · AI-09 `abuse_warnings`): no reply in kind, no threat. */
const ABUSE_WARNINGS: Readonly<Record<PersonaLanguage, string>> = {
  tr: 'Size yardımcı olmak istiyorum; lütfen saygılı bir dille devam edelim.',
  en: 'I want to help you; please let us keep this conversation respectful.',
  de: 'Ich möchte Ihnen helfen; bitte lassen Sie uns respektvoll bleiben.',
  fr: 'Je souhaite vous aider ; restons courtois, s’il vous plaît.',
  es: 'Quiero ayudarle; por favor, mantengamos un tono respetuoso.',
};

export function abuseWarning(lang: PersonaLanguage | null): string {
  return ABUSE_WARNINGS[lang ?? 'tr'];
}

/** Where G19's warnings are counted between turns (`ai_conversations.signals`). */
export const ABUSE_WARNINGS_SIGNAL = 'abuse_warnings';

export function readAbuseWarnings(signals: AiStateObject): number {
  const count = signals[ABUSE_WARNINGS_SIGNAL];
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
}

/** The conversation's risk flags (`signals.risk_flags`, AI-27's names until #302 stores them). */
export function readRiskFlags(signals: AiStateObject): string[] {
  const flags = signals['risk_flags'];
  return Array.isArray(flags)
    ? flags.filter((flag): flag is string => typeof flag === 'string')
    : [];
}

/** The signals with these flags raised as well — never one taken away. */
export function withRiskFlags(signals: AiStateObject, flags: readonly string[]): AiStateObject {
  if (flags.length === 0) return signals;
  const raised = [...new Set([...readRiskFlags(signals), ...flags])];
  return { ...signals, risk_flags: raised };
}

/** The more urgent of the triggers' priorities. */
function mostUrgent(triggers: readonly GuardrailTrigger[]): GuardrailPriority {
  const ranks = triggers.map((trigger) => GUARDRAIL_PRIORITIES.indexOf(trigger.rule.priority));
  return GUARDRAIL_PRIORITIES[Math.min(...ranks)] ?? 'normal';
}

/** The hits a set of triggers leaves: one per rule, at the input, with the words that set it off. */
function triggerHits(
  triggers: readonly GuardrailTrigger[],
  crisisSent: GuardrailTrigger | null,
): GuardrailHitRecord[] {
  return triggers.map((trigger) => {
    const evidence = triggerEvidence(trigger);
    return guardrailHit(
      { source: 'platform', id: trigger.rule.id },
      'input',
      trigger === crisisSent ? 'crisis_text' : 'handoff',
      evidence.quote,
      evidence.pattern,
    );
  });
}

/**
 * A turn a locked procedure (AI-15) answered for a message a rule set off
 * (AI-05: "hesabımı kapatın" always selects the locked self-exclusion
 * procedure): the platform's own procedure says what it says, and the turn
 * hands over all the same, in the same turn (AI-08 §3) — through the
 * procedure's own hand-over when it makes one, which then carries the rule's
 * priority, and the rule's routing topic when it names no team; with the
 * rule's hand-over when it does not.
 */
export function handOverAfterLockedProcedure(
  result: TurnResult,
  triggers: readonly GuardrailTrigger[],
  catalogVersion: string,
): TurnResult {
  const lead = leadingTrigger(triggers);
  if (!lead) return result;
  const priority = mostUrgent(triggers);
  const riskFlags = raisedRiskFlags(triggers);
  const routed = (effect: Extract<TurnSideEffect, { kind: 'handoff' }>) =>
    effect.team !== null || effect.groupId !== undefined || effect.topic !== undefined;
  const existing = result.sideEffects.find(
    (effect): effect is Extract<TurnSideEffect, { kind: 'handoff' }> => effect.kind === 'handoff',
  );
  const handoff: TurnSideEffect = existing
    ? {
        ...existing,
        priority,
        ...(!routed(existing) && lead.rule.target ? { topic: lead.rule.target } : {}),
      }
    : {
        kind: 'handoff',
        team: null,
        ...(lead.rule.target ? { topic: lead.rule.target } : {}),
        ...(lead.rule.handoffReason ? { reason: lead.rule.handoffReason } : {}),
        priority,
      };
  const record: GuardrailRecord = {
    catalog_version: catalogVersion,
    hits: [...(result.decisions.guardrails?.hits ?? []), ...triggerHits(triggers, null)],
    risk_flags: [...new Set([...(result.decisions.guardrails?.risk_flags ?? []), ...riskFlags])],
  };
  return {
    ...result,
    decisions: {
      ...result.decisions,
      outcome: 'handed_off',
      handoffReason: result.decisions.handoffReason ?? lead.rule.handoffReason,
      log: [
        ...result.decisions.log,
        {
          step: 'guardrail',
          detail: `${triggers.map((trigger) => describeTrigger(trigger)).join(', ')} — the locked procedure answered, and the turn hands over · priority ${priority}`,
          ok: true,
        },
      ],
      guardrails: record,
    },
    sideEffects: existing
      ? result.sideEffects.map((effect) => (effect === existing ? handoff : effect))
      : [...result.sideEffects, handoff],
    nextState: {
      ...result.nextState,
      signals: withRiskFlags(result.nextState.signals, riskFlags),
    },
  };
}

export interface GuardrailHandoffInput {
  readonly state: TurnState;
  readonly message: TurnMessage;
  readonly triggers: readonly GuardrailTrigger[];
  readonly answerIn: PersonaLanguage | null;
  readonly settings: GuardrailAgentSettings | null;
  readonly catalogVersion: string;
  /** What the turn already decided and cost (the understanding, the rule) and its log. */
  readonly decided: Partial<TurnDecisions>;
  /** Hits the turn found before this one — the abuse count's, the evidence. */
  readonly earlier?: readonly GuardrailHitRecord[];
}

/**
 * A hand-over a rule forces. The procedure in progress, if any, stays where
 * it stood — nothing of it ran — as with any forced hand-over; the flags the
 * rules raise go on the conversation, where a hand-back reads them (AI-11 §6).
 */
export function guardrailHandoffTurn(input: GuardrailHandoffInput): TurnResult {
  const { state, message, triggers, settings } = input;
  const lead = leadingTrigger(triggers);
  if (!lead) throw new Error('a guardrail hand-over needs a trigger');

  const crisis = triggers.find((trigger) => trigger.rule.tenantText === 'crisis') ?? null;
  const crisisText = crisis && settings?.crisisText?.trim() ? settings.crisisText : null;
  const complaintText =
    lead.rule.tenantText === 'complaint' && settings?.complaintText?.trim()
      ? settings.complaintText
      : null;
  // A person asked for (G16), or a conversation past its warnings (G19): "a
  // person takes over" says what happens. Everything else: the safe text.
  const reply = crisis
    ? (crisisText ?? safeText(input.answerIn))
    : (complaintText ??
      (lead.rule.handoffReason === 'player_request' || lead.rule.handoffReason === 'abuse'
        ? NO_ANSWER_PHRASES[input.answerIn ?? 'tr'].handingOver
        : safeText(input.answerIn)));

  const hits = triggerHits(triggers, crisisText ? crisis : null);
  const riskFlags = raisedRiskFlags(triggers);
  const priority = mostUrgent(triggers);
  const record: GuardrailRecord = {
    catalog_version: input.catalogVersion,
    hits: [...(input.earlier ?? []), ...hits],
    risk_flags: riskFlags,
  };

  const said = crisis
    ? crisisText
      ? `sent the crisis text${settings?.crisisApproved ? '' : ' (not approved yet)'}`
      : 'no crisis text is written — sent the safe text'
    : complaintText
      ? 'sent the complaint procedure'
      : 'said a person takes over';
  const line: SkillRunLogEntry = {
    step: 'guardrail',
    detail: [
      `${triggers.map((trigger) => describeTrigger(trigger)).join(', ')} — handed to a human`,
      lead.rule.target ? `topic ${lead.rule.target}` : '',
      `priority ${priority}`,
      said,
    ]
      .filter(Boolean)
      .join(' · '),
    ok: true,
  };

  return {
    reply,
    decisions: {
      outcome: 'handed_off',
      skillId: null,
      skillName: null,
      failure: null,
      capped: null,
      usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
      ...input.decided,
      replyKind: 'answer',
      handoffReason: lead.rule.handoffReason,
      log: [...(input.decided.log ?? []), line],
      guardrails: record,
    },
    sideEffects: [
      {
        kind: 'handoff',
        team: null,
        ...(lead.rule.target ? { topic: lead.rule.target } : {}),
        ...(lead.rule.handoffReason ? { reason: lead.rule.handoffReason } : {}),
        priority,
      },
    ],
    nextState: {
      ...state,
      signals: withRiskFlags(state.signals, riskFlags),
      counters: { ...state.counters, turns: turnsTaken(state) + 1 },
      lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
    },
  };
}

/** The hand-over reason of a turn a stored risk flag keeps from the AI (tm 302.2). */
export const RISK_FLAG_HANDOFF_REASON: HandoffReason = 'risk_flag';

/**
 * A turn a stored risk flag keeps from the AI (tm 302.2 · AI-27 §3,
 * `mustHandoff`): nothing is said — the flag says a person answers this
 * conversation — and it goes to the flag's team with its priority. The
 * procedure in progress stays where it stood, as with any forced hand-over.
 */
export function riskFlagHandoffTurn(
  state: TurnState,
  message: TurnMessage,
  risk: RiskPolicy,
): TurnResult {
  return {
    reply: null,
    decisions: {
      outcome: 'handed_off',
      skillId: null,
      skillName: null,
      replyKind: null,
      failure: null,
      capped: null,
      usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
      handoffReason: RISK_FLAG_HANDOFF_REASON,
      log: [
        {
          step: 'risk_flag',
          detail: [
            'the conversation carries a risk flag that keeps the AI out — handed to a human',
            risk.targetTeamKey ? `topic ${risk.targetTeamKey}` : '',
            `priority ${risk.priority}`,
          ]
            .filter(Boolean)
            .join(' · '),
          ok: true,
        },
      ],
    },
    sideEffects: [
      {
        kind: 'handoff',
        team: null,
        ...(risk.targetTeamKey ? { topic: risk.targetTeamKey } : {}),
        reason: RISK_FLAG_HANDOFF_REASON,
        priority: risk.priority,
      },
    ],
    nextState: {
      ...state,
      counters: { ...state.counters, turns: turnsTaken(state) + 1 },
      lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
    },
  };
}

/** "G1 (lexicon)", "G2 (signal rg_signal)": which rule and what set it off. */
function describeTrigger(trigger: GuardrailTrigger): string {
  const how = [
    trigger.matches.length > 0 ? 'lexicon' : '',
    ...trigger.signals.map((signal) => `signal ${signal}`),
  ].filter(Boolean);
  return `${trigger.rule.id} (${how.join(', ')})`;
}
