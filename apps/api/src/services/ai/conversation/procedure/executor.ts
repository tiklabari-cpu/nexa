/**
 * The procedure executor (tm 296.3 · SiyahTuş analysis AI-03 §3–§6 ·
 * ADR-14a §2.3).
 *
 * A procedure is an ordered step list that may wait for the player. One turn
 * of it, here, is pure: the definition the conversation pinned, where it
 * stands, the slots and what the understanding heard go in; what the turn
 * says, the tags, how it ended and the next slots come out. The conversation
 * engine (`conversation-engine.ts`) decides *which* procedure runs, writes the
 * knowledge answers and the composed text the parts below ask for, and turns
 * the result into the turn's next state.
 *
 * **Pinned (AI-03 §3 · ADR-14b §2.9).** When a procedure starts, its validated
 * definition is copied into `ai_conversations.procedure_snapshot`, and
 * `procedure_snapshot_hash` is the sha256 of its canonical JSON — the hand-off
 * card shows it, and a definition published while the conversation is under
 * way does not reach it: every later turn reads the snapshot, never the skill.
 *
 * **One turn (AI-03 §4).** First the understanding's slot values are applied
 * (`applyExtraction`); then the limits — a procedure past `limits.max_turns`
 * turns hands over with reason `max_turns`, and any `handoff.conditions` that
 * holds hands over before a step runs. Then the steps, from where the
 * procedure stands:
 *
 *   - a step whose `when` does not hold is passed;
 *   - `collect` asks for its required slots still open — at most
 *     `max_questions_per_message` — and the turn waits (`awaiting_answer`);
 *     nothing open, it passes; a required slot the player has refused hands over
 *     (`slot_refused`, the card says "verilmedi");
 *   - `check` takes `then` when its condition holds, else `else` or the next
 *     step: a `goto`, or a step written in place (which goes on after the check
 *     unless it ends the procedure);
 *   - `say` contributes its template, filled — or, when a variable is unknown,
 *     its instruction for the compose call (`templates.ts`);
 *   - `answer_from_knowledge` asks for a knowledge answer;
 *   - `handoff` and `resolve` end the procedure; `tag` tags;
 *   - `tool` is passive in F1 (AI-28): skipped, and the run log says so.
 *
 * **At most {@link MAX_INNER_STEPS} steps run in a turn** — the loop shield.
 * The save-time validator refuses a loop nothing in which waits for the
 * player, but a loop through a `collect` whose slots are all filled waits for
 * nothing: past the limit the turn stops where it is (`ready`) and the next
 * turn goes on from there. A step passed by its `when` does not count; every
 * loop runs a counted step.
 *
 * Every step's decision is in the trace — step id, type, the condition's
 * three-valued result, what it did — in the shape the decision record takes it
 * (ID-08, #296.6); the run log carries the same in words. Neither carries a
 * value: slots by name, conditions by what they could not decide.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_MAX_QUESTIONS_PER_MESSAGE,
  validateProcedure,
  type HandoffTarget,
  type PersonaLanguage,
  type ProcInlineStep,
  type ProcOutcome,
  type ProcStep,
  type ProcStepType,
  type Procedure,
  type SlotDef,
} from '@siyahtus/types';
import { canonicalJson } from '../../../audit/audit-chain.js';
import {
  applyExtraction,
  planQuestions,
  slotRecord,
  type SlotAttachment,
} from '../slots/extract.js';
import type { SlotEnumOption } from '../slots/validators.js';
import type { AiStateObject } from '../state-store.js';
import type { SkillRunLogEntry, TurnState } from '../turn.js';
import {
  evaluateCondition,
  isSlotRequired,
  type CondResult,
  type ProcedureFacts,
} from './conditions.js';
import { renderSay, renderTemplate, type TemplateContext } from './templates.js';
import type { ProcedureUnderstanding } from './understanding.js';

/** The steps one turn may run (AI-03 §4: the loop shield). */
export const MAX_INNER_STEPS = 8;

// ---------------------------------------------------------------------------
// The snapshot.
// ---------------------------------------------------------------------------

/** What `ai_conversations.procedure_snapshot` holds. */
export interface ProcedureSnapshot {
  /** The skill's name when the procedure started — what the run log and the summary call it. */
  readonly skill_name: string;
  /** The AI agent whose persona answers in it. */
  readonly ai_agent_id: string | null;
  /** A locked template copy (AI-15): no other topic takes over from it. */
  readonly locked: boolean;
  readonly procedure: Procedure;
}

/** sha256 of the definition's canonical JSON (ADR-14b §2.9) — key order never changes it. */
export function procedureHash(procedure: Procedure): string {
  return createHash('sha256').update(canonicalJson(procedure)).digest('hex');
}

/**
 * A stored snapshot, read back. The definition is judged again — it was valid
 * when it was copied, so a definition that fails now was edited by hand, and
 * a conversation is not run on it. Null for anything else.
 */
export function readSnapshot(raw: unknown): ProcedureSnapshot | null {
  if (!isObject(raw) || typeof raw['skill_name'] !== 'string') return null;
  const validated = validateProcedure(raw['procedure']);
  if (!validated.ok) return null;
  return {
    skill_name: raw['skill_name'],
    ai_agent_id: typeof raw['ai_agent_id'] === 'string' ? raw['ai_agent_id'] : null,
    locked: raw['locked'] === true,
    procedure: validated.procedure,
  };
}

// ---------------------------------------------------------------------------
// One turn.
// ---------------------------------------------------------------------------

/** One part of the turn's message, in the order the steps produced it. */
export type ReplyPart =
  /** A filled template — `verbatim` ones go out exactly as filled. */
  | { kind: 'template'; at: string; key: string; text: string; verbatim: boolean }
  /** What the compose call writes from: a `say` with no template it could send. */
  | { kind: 'instruction'; at: string; text: string }
  /** A `collect` question (AI-04 §7), worded by `planQuestions`. */
  | { kind: 'question'; at: string; slot: string; text: string }
  /** An answer from the knowledge base (AI-06); the hint, when the step gives one, joins the search. */
  | { kind: 'knowledge'; at: string; queryHint: string | null };

/** One step's decision — the decision record's shape (ID-08: step_id, type, cond_result, detail). */
export interface StepDecision {
  step_id: string;
  type: ProcStepType;
  /** A `when` or a `check` condition's result; null for a step that had none. */
  cond_result: CondResult | null;
  detail: string;
}

/** How the turn left the procedure. */
export type ProcedureEnd =
  /** A `collect` asked; the next turn reads the answer. */
  | { kind: 'awaiting'; stepId: string }
  /** The inner-step limit stopped the turn; the next one goes on from `stepId`. */
  | { kind: 'paused'; stepId: string }
  /** Handed over — by a step, a hand-over condition, the turn limit or a refused slot. */
  | { kind: 'handoff'; stepId: string | null; reason: string; target: HandoffTarget | null }
  | { kind: 'resolved'; stepId: string; outcome: ProcOutcome }
  /** The step list ran out without a `resolve` or a `handoff`. */
  | { kind: 'finished' };

export interface ProcedureTurnInput {
  readonly procedure: Procedure;
  /** Where it stands; null when the procedure starts with this turn. */
  readonly at: { readonly stepId: string | null } | null;
  /** The conversation's slots before the turn. */
  readonly slots: AiStateObject;
  /** The procedure's turns before this one (`counters.procedure_turns`). */
  readonly procedureTurns: number;
  /** The AI turn this is on the connection (`counters.turns` after it). */
  readonly turn: number;
  /** What the understanding heard; null applies no slot values (a resumed topic's "evet"). */
  readonly understanding: ProcedureUnderstanding | null;
  /** What the player wrote that the turn processes — the traceability shield's haystack. */
  readonly messages: readonly string[];
  readonly attachments?: readonly SlotAttachment[];
  readonly now: Date;
  readonly timeZone: string;
  readonly currency: string;
  readonly facts: ProcedureFacts;
  /** Table-sourced enum options by slot name (AI-13, #310). */
  readonly options?: Readonly<Record<string, readonly SlotEnumOption[]>>;
  /** The reply's language: the question phrasing (Turkish or English). */
  readonly language: PersonaLanguage | null;
  /** AI-07 `max_questions_per_message`. */
  readonly maxQuestions?: number;
}

export interface ProcedureTurnResult {
  parts: ReplyPart[];
  tags: string[];
  end: ProcedureEnd;
  /** The slots after the turn: extracted, asked (attempts counted), refused. */
  slots: Record<string, unknown>;
  trace: StepDecision[];
  log: SkillRunLogEntry[];
}

/** Run one turn of a procedure (see the file header). */
export function runProcedureTurn(input: ProcedureTurnInput): ProcedureTurnResult {
  const { procedure } = input;
  const log: SkillRunLogEntry[] = [];
  const trace: StepDecision[] = [];

  let slots: Record<string, unknown> = { ...input.slots };
  if (input.understanding) {
    const extraction = applyExtraction({
      defs: procedure.slots as SlotDef[],
      slots,
      understanding: {
        extracted: input.understanding.extracted,
        correction: input.understanding.correction,
      },
      messages: input.messages,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      turn: input.turn,
      now: input.now,
      timeZone: input.timeZone,
      currency: input.currency,
      ...(input.options ? { options: input.options } : {}),
    });
    slots = extraction.slots;
    log.push(...extraction.log);
  }

  const context = (): TemplateContext => ({
    slots,
    facts: input.facts,
    now: input.now,
    timeZone: input.timeZone,
    aiAnswers: input.understanding?.ai_conditions ?? {},
  });
  const done = (end: ProcedureEnd, parts: ReplyPart[] = [], tags: string[] = []) => ({
    parts,
    tags,
    end,
    slots,
    trace,
    log,
  });

  const stoppedAt = input.at?.stepId ?? null;
  if (input.procedureTurns >= procedure.limits.max_turns) {
    log.push({
      step: stoppedAt ?? 'limits',
      detail: `handing over — the procedure has taken its ${procedure.limits.max_turns} turns (max_turns)`,
      ok: true,
    });
    return done({
      kind: 'handoff',
      stepId: stoppedAt,
      reason: 'max_turns',
      target: procedure.handoff.target ?? null,
    });
  }

  for (const [n, cond] of procedure.handoff.conditions.entries()) {
    const key = `handoff.${n}`;
    const evaluation = evaluateCondition(cond, context(), key);
    log.push(...evaluation.log);
    if (!evaluation.holds) continue;
    log.push({ step: key, detail: 'handing over — a hand-over condition holds', ok: true });
    return done({
      kind: 'handoff',
      stepId: stoppedAt,
      reason: 'procedure_condition',
      target: procedure.handoff.target ?? null,
    });
  }

  const start = stoppedAt === null ? 0 : procedure.steps.findIndex((s) => s.id === stoppedAt);
  if (start < 0) {
    log.push({
      step: stoppedAt ?? 'steps',
      detail: 'the step the conversation stood at is not in its procedure — starting over',
      ok: false,
    });
  }

  const loop = runSteps({
    procedure,
    from: Math.max(0, start),
    slots,
    context,
    setSlots: (next) => {
      slots = next;
    },
    turn: input.turn,
    language: input.language,
    maxQuestions: input.maxQuestions ?? DEFAULT_MAX_QUESTIONS_PER_MESSAGE,
    trace,
    log,
  });
  return done(loop.end, loop.parts, loop.tags);
}

interface StepLoop {
  procedure: Procedure;
  from: number;
  slots: Record<string, unknown>;
  context: () => TemplateContext;
  setSlots: (slots: Record<string, unknown>) => void;
  turn: number;
  language: PersonaLanguage | null;
  maxQuestions: number;
  trace: StepDecision[];
  log: SkillRunLogEntry[];
}

/** The step loop: from `from` until a step waits or ends the procedure, or the limit stops it. */
function runSteps(loop: StepLoop): { parts: ReplyPart[]; tags: string[]; end: ProcedureEnd } {
  const { procedure, trace, log } = loop;
  const parts: ReplyPart[] = [];
  const tags: string[] = [];
  const indexOf = new Map(procedure.steps.map((step, index) => [step.id, index]));
  const defs = new Map(procedure.slots.map((def) => [def.name, def as SlotDef]));
  let slots = loop.slots;
  const record = (
    step: { id: string; type: ProcStepType },
    cond: CondResult | null,
    detail: string,
    ok = true,
  ) => {
    trace.push({ step_id: step.id, type: step.type, cond_result: cond, detail });
    log.push({ step: step.id, detail, ok });
  };

  /** A step that says, tags or ends — on its own, or written in a `check` branch (`at` is the check). */
  const perform = (
    step: ProcStep | ProcInlineStep,
    at: { id: string; type: ProcStepType },
    cond: CondResult | null,
    via = '',
  ): ProcedureEnd | null => {
    const label = (detail: string) => (via ? `${via}: ${detail}` : detail);
    switch (step.type) {
      case 'say': {
        const said = renderSay(step, procedure.templates, loop.context(), at.id, log);
        if (said.kind === 'template') {
          parts.push({
            kind: 'template',
            at: at.id,
            key: said.key,
            text: said.text,
            verbatim: said.verbatim,
          });
          record({ id: at.id, type: 'say' }, cond, label(`template ${said.key}`));
        } else if (said.kind === 'instruction') {
          parts.push({ kind: 'instruction', at: at.id, text: said.text });
          record({ id: at.id, type: 'say' }, cond, label('instruction for the reply'));
        } else {
          record({ id: at.id, type: 'say' }, cond, label('nothing to say'), false);
        }
        return null;
      }
      case 'answer_from_knowledge':
        parts.push({ kind: 'knowledge', at: at.id, queryHint: step.query_hint?.trim() || null });
        record(
          { id: at.id, type: 'answer_from_knowledge' },
          cond,
          label('answer from the knowledge base'),
        );
        return null;
      case 'tag':
        tags.push(step.tag);
        record({ id: at.id, type: 'tag' }, cond, label(`tagged "${step.tag}"`));
        return null;
      case 'handoff': {
        const target = step.target ?? procedure.handoff.target ?? null;
        record({ id: at.id, type: 'handoff' }, cond, label(`handing over (${step.reason_code})`));
        return { kind: 'handoff', stepId: at.id, reason: step.reason_code, target };
      }
      case 'resolve': {
        if (step.followup_template !== undefined) {
          const followup = renderTemplate(
            step.followup_template,
            procedure.templates,
            loop.context(),
            at.id,
            log,
          );
          if (followup) {
            parts.push({
              kind: 'template',
              at: at.id,
              key: followup.key,
              text: followup.text,
              verbatim: followup.verbatim,
            });
          }
        }
        record({ id: at.id, type: 'resolve' }, cond, label(`resolved (${step.outcome})`));
        return { kind: 'resolved', stepId: at.id, outcome: step.outcome };
      }
      default:
        return null;
    }
  };

  let index = loop.from;
  let executed = 0;
  for (;;) {
    const step = procedure.steps[index];
    if (step === undefined) {
      log.push({ step: 'steps', detail: 'the procedure ran to its last step', ok: true });
      return { parts, tags, end: { kind: 'finished' } };
    }
    if (executed >= MAX_INNER_STEPS) {
      log.push({
        step: step.id,
        detail: `stopped — ${MAX_INNER_STEPS} steps ran this turn; the next turn goes on from here`,
        ok: false,
      });
      return { parts, tags, end: { kind: 'paused', stepId: step.id } };
    }

    let cond: CondResult | null = null;
    if (step.type !== 'check' && step.when !== undefined) {
      const evaluation = evaluateCondition(step.when, loop.context(), step.id);
      log.push(...evaluation.log);
      if (!evaluation.holds) {
        record(step, evaluation.result, 'passed — its condition does not hold');
        index += 1;
        continue;
      }
      cond = evaluation.result;
    }
    executed += 1;

    switch (step.type) {
      case 'collect': {
        const context = loop.context();
        const required = new Set(
          step.slots.filter((name) => {
            const def = defs.get(name);
            return def !== undefined && isSlotRequired(def, context, log);
          }),
        );
        const plan = planQuestions({
          defs: procedure.slots as SlotDef[],
          slots,
          turn: loop.turn,
          only: step.slots,
          maxQuestions: loop.maxQuestions,
          language: loop.language,
          required: (def) => required.has(def.name),
        });
        const refused = step.slots.filter(
          (name) =>
            required.has(name) &&
            (plan.refused.includes(name) || slotRecord(slots[name]).status === 'refused'),
        );
        if (refused.length > 0) {
          // Only the refusals are kept: the questions the plan counted are not asked.
          slots = {
            ...slots,
            ...Object.fromEntries(plan.refused.map((name) => [name, plan.slots[name]])),
          };
          loop.setSlots(slots);
          log.push(...plan.log.filter((entry) => !entry.detail.startsWith('asked for')));
          record(
            step,
            cond,
            `handing over — the player has not given ${refused.join(', ')} (slot_refused)`,
          );
          return {
            parts,
            tags,
            end: {
              kind: 'handoff',
              stepId: step.id,
              reason: 'slot_refused',
              target: procedure.handoff.target ?? null,
            },
          };
        }
        slots = plan.slots;
        loop.setSlots(slots);
        log.push(...plan.log);
        if (plan.questions.length > 0) {
          for (const question of plan.questions) {
            parts.push({ kind: 'question', at: step.id, slot: question.slot, text: question.text });
          }
          record(
            step,
            cond,
            `asked for ${plan.questions.map((q) => q.slot).join(', ')} — waiting for the answer`,
          );
          return { parts, tags, end: { kind: 'awaiting', stepId: step.id } };
        }
        record(step, cond, 'nothing left to ask');
        index += 1;
        break;
      }

      case 'check': {
        const evaluation = evaluateCondition(step.when, loop.context(), step.id);
        log.push(...evaluation.log);
        const branch = evaluation.holds ? step.then : step.else;
        const side = evaluation.holds ? 'then' : 'else';
        if (branch === undefined) {
          record(step, evaluation.result, 'does not hold — on to the next step');
          index += 1;
          break;
        }
        if ('goto' in branch) {
          const target = indexOf.get(branch.goto);
          if (target === undefined) {
            // The validator refuses this; a snapshot edited by hand is the only way here.
            record(
              step,
              evaluation.result,
              `${side}: no step ${branch.goto} — on to the next step`,
              false,
            );
            index += 1;
            break;
          }
          record(step, evaluation.result, `${side}: go to ${branch.goto}`);
          index = target;
          break;
        }
        const ended = perform(branch, { id: step.id, type: branch.type }, evaluation.result, side);
        if (ended) return { parts, tags, end: ended };
        index += 1;
        break;
      }

      case 'tool':
        record(step, cond, `tool ${step.tool_key} is passive in F1 — skipped`);
        index += 1;
        break;

      default: {
        const ended = perform(step, step, cond);
        if (ended) return { parts, tags, end: ended };
        index += 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The state a procedure keeps between turns.
// ---------------------------------------------------------------------------

/** The procedure in progress on a connection, read from its state. */
export interface ActiveProcedure {
  readonly skillId: string;
  readonly snapshot: ProcedureSnapshot;
  readonly hash: string;
  readonly stepId: string | null;
  readonly stepStatus: 'awaiting_answer' | 'ready';
  /** `counters.procedure_turns`: the turns this procedure has taken. */
  readonly procedureTurns: number;
}

/**
 * The procedure the connection is in, or null: none started, the last one
 * ended (`done` — handed over or resolved), or its snapshot does not read.
 */
export function activeProcedure(state: TurnState): ActiveProcedure | null {
  if (state.activeSkillId === null || state.procedureSnapshotHash === null) return null;
  if (state.stepStatus !== 'awaiting_answer' && state.stepStatus !== 'ready') return null;
  const snapshot = readSnapshot(state.procedureSnapshot);
  if (snapshot === null) return null;
  return {
    skillId: state.activeSkillId,
    snapshot,
    hash: state.procedureSnapshotHash,
    stepId: state.stepId,
    stepStatus: state.stepStatus,
    procedureTurns: wholeNumber(state.counters['procedure_turns']),
  };
}

/** The one topic set aside for another (AI-03 §7) — `ai_conversations.suspended`. */
export interface SuspendedProcedure {
  readonly skill_id: string;
  readonly snapshot: ProcedureSnapshot;
  readonly snapshot_hash: string;
  readonly step_id: string | null;
  readonly step_status: 'awaiting_answer' | 'ready';
  readonly slots: Record<string, unknown>;
  readonly procedure_turns: number;
  readonly suspended_at: string;
  /** "Önceki konuya dönelim mi?" was asked; the next yes or no answers it. */
  readonly offered: boolean;
}

export function readSuspended(raw: unknown): SuspendedProcedure | null {
  if (!isObject(raw) || typeof raw['skill_id'] !== 'string') return null;
  const snapshot = readSnapshot(raw['snapshot']);
  if (snapshot === null || typeof raw['snapshot_hash'] !== 'string') return null;
  return {
    skill_id: raw['skill_id'],
    snapshot,
    snapshot_hash: raw['snapshot_hash'],
    step_id: typeof raw['step_id'] === 'string' ? raw['step_id'] : null,
    step_status: raw['step_status'] === 'ready' ? 'ready' : 'awaiting_answer',
    slots: isObject(raw['slots']) ? { ...raw['slots'] } : {},
    procedure_turns: wholeNumber(raw['procedure_turns']),
    suspended_at: typeof raw['suspended_at'] === 'string' ? raw['suspended_at'] : '',
    offered: raw['offered'] === true,
  };
}

/**
 * The active procedure set aside, with the slots it collected. The question
 * it was waiting on was not refused — the player changed the subject — so the
 * slots it asked for and did not get have that attempt back: taken up again,
 * they are asked as often as before (AI-04-S2 counts refusals, not topics).
 */
export function suspend(
  active: ActiveProcedure,
  slots: AiStateObject,
  now: Date,
): SuspendedProcedure {
  const kept: Record<string, unknown> = { ...slots };
  const waiting = active.snapshot.procedure.steps.find((step) => step.id === active.stepId);
  if (active.stepStatus === 'awaiting_answer' && waiting?.type === 'collect') {
    for (const name of waiting.slots) {
      const record = slotRecord(kept[name]);
      if (record.status === 'filled' || record.status === 'carried' || record.attempts === 0) {
        continue;
      }
      kept[name] = { ...record, attempts: record.attempts - 1 };
    }
  }
  return {
    skill_id: active.skillId,
    snapshot: active.snapshot,
    snapshot_hash: active.hash,
    step_id: active.stepId,
    step_status: active.stepStatus,
    slots: kept,
    procedure_turns: active.procedureTurns,
    suspended_at: now.toISOString(),
    offered: false,
  };
}

/** A set-aside topic taken up again — where it stood and what it had collected. */
export function resumed(suspended: SuspendedProcedure): ActiveProcedure {
  return {
    skillId: suspended.skill_id,
    snapshot: suspended.snapshot,
    hash: suspended.snapshot_hash,
    stepId: suspended.step_id,
    stepStatus: suspended.step_status,
    procedureTurns: suspended.procedure_turns,
  };
}

function wholeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
