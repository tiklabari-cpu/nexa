/**
 * When the AI may say a matter is solved (tm 303.4 · SiyahTuş analysis AI-09,
 * owner decision K9).
 *
 * K9: the AI decides whether the conversation is solved, and decides it by the
 * workspace's "resolved" criteria — per procedure ("the slots are filled and
 * the player said yes", `Procedure.resolution_criteria`), else the
 * workspace's default (`ai_handoff_settings.resolution_criteria`), else the
 * platform's: the player's explicit yes ({@link DEFAULT_RESOLUTION_CRITERIA}).
 * The criteria are written in the procedure condition language (`Cond`,
 * `procedure.ts`); `player_confirmed()` is the player's answer to the AI's
 * "is it solved?".
 *
 * A `resolve` step whose criteria do not hold does not resolve: when the
 * player's yes would satisfy them it asks ({@link RESOLUTION_PHRASES}) and
 * waits; otherwise, or when the answer is a no, a person takes over — the
 * hand-over's catalogue reason is `player_said_unresolved`, which the
 * workspace's "AI could not solve it" rule routes (`handoff-rules.ts`). An
 * answer that is neither yes nor no claims nothing and sends nobody: the
 * procedure is let go and the message is taken as a new one. Every
 * decision goes into the decision record (ID-08) as a {@link ResolutionRecord}:
 * what was decided, by which criteria, and why — names, never values.
 *
 * AI-25 (#320) measures "the AI said solved" and "the player confirmed"
 * apart; `decision: 'resolved'` with `confirmation: 'yes'` is both.
 */
import type { PersonaLanguage } from './persona.js';
import { validateResolutionCriteria, type Cond, type ProcOutcome } from './procedure.js';

/** The platform's default: the player said yes to "is it solved?". */
export const DEFAULT_RESOLUTION_CRITERIA: Cond = {
  fn: { name: 'player_confirmed', args: [] },
};

/** Whose criteria decided: the procedure's own, the workspace's default, the platform's. */
export const RESOLUTION_BASES = ['procedure', 'workspace', 'platform'] as const;
export type ResolutionBasis = (typeof RESOLUTION_BASES)[number];

/**
 * What the AI decided about the matter being solved.
 *
 *   - `resolved`    — the criteria hold: the AI says it is solved.
 *   - `asked`       — they do not hold yet, the player's yes would make them:
 *                     the AI asks "is it solved?" and waits.
 *   - `unresolved`  — they do not hold and will not: a person takes over.
 *   - `not_claimed` — an answer that was not a `resolve` step (a knowledge
 *                     answer): the AI claims nothing until the criteria hold.
 */
export const RESOLUTION_DECISIONS = ['resolved', 'asked', 'unresolved', 'not_claimed'] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

/**
 * Why — a code, never words:
 *
 *   - `criteria_met`          — they hold.
 *   - `awaiting_confirmation` — only the player's yes is missing.
 *   - `player_said_no`        — the player answered "is it solved?" with no.
 *   - `not_confirmed`         — asked, and the answer was neither yes nor no.
 *   - `criteria_unmet`        — something other than the player's yes is
 *                               missing or false (a slot, an `ai` question).
 */
export const RESOLUTION_REASONS = [
  'criteria_met',
  'awaiting_confirmation',
  'player_said_no',
  'not_confirmed',
  'criteria_unmet',
] as const;
export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

/** The player's answer to "is it solved?" — null when it was not asked, or not answered either way. */
export type ResolutionConfirmation = 'yes' | 'no' | null;

/** One resolution decision as the decision record keeps it (ID-08 `details.resolution`). */
export interface ResolutionRecord {
  decision: ResolutionDecision;
  reason: ResolutionReason;
  basis: ResolutionBasis;
  /** The criteria's three-valued result, before unknown counts as false. */
  result: boolean | 'unknown';
  /** What could not be decided, by name (`fn player_confirmed`, `slot yontem`, `ai`). */
  unknown: string[];
  confirmation: ResolutionConfirmation;
  /** The `resolve` step's outcome, on a procedure turn. */
  outcome?: ProcOutcome;
  /** The step that decided — a `resolve` step, or the `check` it is written in. */
  step_id?: string;
}

/**
 * The procedure's own hand-over reason when its criteria are not met and the
 * player did not say no (the card shows it; the catalogue reads it as
 * `player_said_unresolved`).
 */
export const RESOLUTION_UNMET_REASON = 'resolution_criteria_unmet';

/** What the AI says around the decision, in the persona's language (said as written, no model). */
export const RESOLUTION_PHRASES: Readonly<
  Record<
    PersonaLanguage,
    {
      /** "Is it solved?", by the `resolve` step's outcome. */
      readonly confirm: Readonly<Record<ProcOutcome, string>>;
      /** After the player's yes, when nothing else is said. */
      readonly thanks: string;
    }
  >
> = {
  tr: {
    confirm: {
      resolved: 'Sorununuz çözüldü mü?',
      resolved_waiting: 'Bu bilgiler işinize yaradı mı?',
    },
    thanks: 'Sevindim! Başka bir konuda yardımcı olabileceğim bir şey olursa yazmanız yeterli.',
  },
  en: {
    confirm: {
      resolved: 'Has this solved your problem?',
      resolved_waiting: 'Was this information helpful?',
    },
    thanks: 'Glad to hear it! If there is anything else, just write to us.',
  },
  de: {
    confirm: {
      resolved: 'Ist Ihr Anliegen damit gelöst?',
      resolved_waiting: 'Waren diese Informationen hilfreich?',
    },
    thanks: 'Das freut mich! Wenn Sie noch etwas brauchen, schreiben Sie uns einfach.',
  },
  fr: {
    confirm: {
      resolved: 'Votre problème est-il résolu ?',
      resolved_waiting: 'Ces informations vous ont-elles été utiles ?',
    },
    thanks: 'Ravi de l’entendre ! Pour toute autre question, écrivez-nous.',
  },
  es: {
    confirm: {
      resolved: '¿Se ha resuelto su problema?',
      resolved_waiting: '¿Le ha resultado útil esta información?',
    },
    thanks: '¡Me alegro! Si necesita algo más, escríbanos.',
  },
};

/**
 * The stored workspace default (`ai_handoff_settings.resolution_criteria`),
 * read the way the API reads it: a value that is not valid criteria — written
 * past the API — is no default, so the platform's applies.
 */
export function readResolutionCriteria(raw: unknown): Cond | null {
  if (raw === null || raw === undefined) return null;
  const validated = validateResolutionCriteria(raw);
  return validated.ok ? validated.criteria : null;
}
