/**
 * Which procedure a turn runs (tm 296.3 · SiyahTuş analysis AI-03 §7, AI-05
 * §4; assumption AI-03-S3).
 *
 * The part of the decision order (AI-05 §4, #297 `policy.ts`) that is about
 * procedures already under way — what the understanding's candidate does to
 * the one in progress and to the one set aside:
 *
 *   1. **"Önceki konuya dönelim mi?"** — asked when a topic ended with another
 *      one set aside — is answered first: yes takes the set-aside topic up
 *      where it stood, with what it had collected; no lets it go.
 *   2. **The active procedure carries on** unless the understanding is sure
 *      (the agent's `clarify_thresholds.high`) the message is about another
 *      one, and neither carries the active one on (`is_continuation`) nor
 *      answers the question the AI is waiting on. Then the new topic starts,
 *      and the active one is **set aside** if it was waiting for the player —
 *      over any topic already set aside: at most one (AI-03-S3). One that was
 *      not waiting (stopped by the step limit) is left.
 *   3. **A locked procedure** (self-exclusion, responsible gaming — AI-15 G1/G2/G5)
 *      goes before everything: it takes over from any active procedure that is
 *      not locked itself, and the topic set aside is dropped, never offered back.
 *   4. With nothing active, the best candidate starts — the set-aside topic
 *      itself, when that is what the message is about, is taken up instead.
 *
 * Pure: no clock but the one handed in, nothing written.
 */
import type { AiStateObject } from '../state-store.js';
import type { SkillRunLogEntry } from '../turn.js';
import { resumed, suspend, type ActiveProcedure, type SuspendedProcedure } from './executor.js';
import {
  rankProcedures,
  type CatalogueEntry,
  type ProcedureUnderstanding,
} from './understanding.js';

export type ProcedureSelection =
  /** No procedure this turn: the single-message skills are tried, as before. */
  | { kind: 'none' }
  | { kind: 'continue'; active: ActiveProcedure }
  /** A procedure from the catalogue starts. */
  | { kind: 'start'; key: string }
  /** The set-aside topic is taken up again. */
  | { kind: 'resume'; active: ActiveProcedure }
  /** The player said no to the set-aside topic and nothing else is asked for. */
  | { kind: 'declined'; skillId: string; skillName: string };

export interface SelectionInput {
  readonly understanding: ProcedureUnderstanding;
  readonly catalogue: readonly CatalogueEntry[];
  readonly active: ActiveProcedure | null;
  readonly suspended: SuspendedProcedure | null;
  /** The conversation's slots — the active procedure's, which go aside with it. */
  readonly slots: AiStateObject;
  readonly now: Date;
  /** The confidence a procedure starts at — the agent's `clarify_thresholds.high`. */
  readonly high?: number;
}

export interface SelectionResult {
  readonly selection: ProcedureSelection;
  /** What `ai_conversations.suspended` holds after the turn. */
  readonly suspended: SuspendedProcedure | null;
  readonly log: SkillRunLogEntry[];
}

export function selectProcedure(input: SelectionInput): SelectionResult {
  const log: SkillRunLogEntry[] = [];
  const note = (detail: string) => log.push({ step: 'procedure', detail, ok: true });
  const { active, understanding } = input;
  let suspended = input.suspended;
  const best = rankProcedures(understanding, input.catalogue, input.high)[0] ?? null;

  // 1. The question about the set-aside topic.
  let declined: SuspendedProcedure | null = null;
  if (active === null && suspended?.offered) {
    if (
      understanding.yes_no === 'yes' &&
      (best === null || best.entry.key === suspended.skill_id)
    ) {
      note(`going back to ${suspended.snapshot.skill_name}, as the player asked`);
      return { selection: { kind: 'resume', active: resumed(suspended) }, suspended: null, log };
    }
    if (understanding.yes_no === 'no') {
      note(`not going back to ${suspended.snapshot.skill_name} — the player said no`);
      declined = suspended;
      suspended = null;
    }
  }

  // 2–3. The procedure in progress.
  if (active !== null) {
    if (best === null || best.entry.key === active.skillId) {
      return { selection: { kind: 'continue', active }, suspended, log };
    }
    if (best.entry.locked && !active.snapshot.locked) {
      note(`${best.entry.name} is locked: it takes over from ${active.snapshot.skill_name}`);
      if (suspended) note(`${suspended.snapshot.skill_name} is no longer set aside`);
      return { selection: { kind: 'start', key: best.entry.key }, suspended: null, log };
    }
    if (
      active.snapshot.locked ||
      understanding.answers_pending_question === true ||
      understanding.intent.is_continuation === true
    ) {
      return { selection: { kind: 'continue', active }, suspended, log };
    }
    if (active.stepStatus === 'awaiting_answer') {
      note(
        `${active.snapshot.skill_name} set aside for ${best.entry.name}` +
          (suspended ? ` (in place of ${suspended.snapshot.skill_name})` : ''),
      );
      return {
        selection: { kind: 'start', key: best.entry.key },
        suspended: suspend(active, input.slots, input.now),
        log,
      };
    }
    note(`${active.snapshot.skill_name} left for ${best.entry.name}`);
    return { selection: { kind: 'start', key: best.entry.key }, suspended, log };
  }

  // 4. Nothing in progress.
  if (best !== null) {
    if (suspended && best.entry.key === suspended.skill_id) {
      note(`going back to ${suspended.snapshot.skill_name} — the message is about it`);
      return { selection: { kind: 'resume', active: resumed(suspended) }, suspended: null, log };
    }
    if (best.entry.locked && suspended) {
      note(`${best.entry.name} is locked: ${suspended.snapshot.skill_name} is no longer set aside`);
      suspended = null;
    }
    return { selection: { kind: 'start', key: best.entry.key }, suspended, log };
  }
  if (declined) {
    return {
      selection: {
        kind: 'declined',
        skillId: declined.skill_id,
        skillName: declined.snapshot.skill_name,
      },
      suspended: null,
      log,
    };
  }
  return { selection: { kind: 'none' }, suspended, log };
}
