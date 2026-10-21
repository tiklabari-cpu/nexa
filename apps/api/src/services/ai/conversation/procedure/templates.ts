/**
 * Filling a procedure's reply templates (tm 296.7 · SiyahTuş analysis AI-03
 * §4 `say`, §5).
 *
 * A template is the author's text with `{variable}`s — a slot (`{yontem}`), a
 * fact (`{method.expected_minutes}`), a function (`{elapsed_minutes(islem_zamani)}`)
 * or a tenant placeholder the template catalogue declares (#311). The
 * save-time validator made sure every variable names something; whether the
 * conversation *knows* it is a run-time question, and the rule is strict:
 *
 *   **a template with a variable that cannot be filled is not sent.**
 *
 * "Beklenen süre {method.expected_minutes}" with no payment-method row would
 * otherwise reach the player as "Beklenen süre " or "{method.expected_minutes}".
 * Instead the run log records the template and the variables it lacked (names
 * only, never a value), and a `say` step falls back to its `instruction`, which
 * the compose call (#296.3) writes the reply from. A `verbatim` template — a
 * legal notice — goes out exactly as filled; the model does not rephrase it.
 *
 * What a variable reads as:
 *
 *   - a slot — its `display` ("2.500 TRY", "16.10.2026 21:40"), once settled.
 *     A `pii: 'high'` slot is never put into a message: its value stays on its
 *     record for the card (AI-04 §9), so a template asking for it is not sent;
 *   - a fact — the column's value: minutes and hours as a duration ("30 dk",
 *     "1 saat"), other numbers with Turkish grouping, a yes/no as "evet"/"hayır";
 *   - `elapsed_minutes` as a duration, `within_working_hours` as "evet"/"hayır",
 *     `next_window` as a moment on the tenant's clock ("17.10.2026 09:00").
 *
 * Pure, like `conditions.ts`, whose values it shows.
 */
import {
  parseProcedureReference,
  type ProcInlineStep,
  type ProcSayStep,
  type ProcTemplate,
} from '@siyahtus/types';
import { formatDateTime, formatDuration } from '../slots/normalize-tr.js';
import { slotRecord } from '../slots/extract.js';
import type { SkillRunLogEntry } from '../turn.js';
import {
  factValue,
  functionValue,
  slotSettled,
  zonedMoment,
  type ProcLookup,
  type ProcValue,
  type ProcedureEvalContext,
} from './conditions.js';

/** Why one variable could not be filled. */
export const TEMPLATE_MISS_REASONS = [
  /** Not a slot, a fact, a function or a placeholder by the grammar (`{yöntem}`). */
  'not_a_variable',
  /** The slot is not settled, the fact or function has no answer, the placeholder has no value. */
  'unknown',
  /** A `pii: 'high'` slot — kept for the card, never written into a message. */
  'sensitive',
] as const;
export type TemplateMissReason = (typeof TEMPLATE_MISS_REASONS)[number];

export interface TemplateMiss {
  /** As written between the braces. */
  variable: string;
  reason: TemplateMissReason;
}

export interface TemplateContext extends ProcedureEvalContext {
  /** The tenant placeholders' values (`{site_adi}`), by name — #311's template catalogue. */
  placeholders?: Readonly<Record<string, string>>;
}

export type TemplateFill = { ok: true; text: string } | { ok: false; missing: TemplateMiss[] };

/** One variable's text, or why there is none. Also what the hand-off card (AI-10) shows for a field. */
export function variableText(
  variable: string,
  ctx: TemplateContext,
): { ok: true; text: string } | { ok: false; reason: TemplateMissReason } {
  const placeholder = ctx.placeholders?.[variable] ?? ctx.placeholders?.[variable.trim()];
  if (placeholder !== undefined) {
    return placeholder.trim() ? { ok: true, text: placeholder } : miss('unknown');
  }
  const reference = parseProcedureReference(variable);
  if (reference === null) return miss('not_a_variable');
  switch (reference.kind) {
    case 'slot': {
      if (!slotSettled(ctx.slots, reference.name)) return miss('unknown');
      const record = slotRecord(ctx.slots[reference.name]);
      if (record.pii === 'high') return miss('sensitive');
      if (record.display !== null) return { ok: true, text: record.display };
      return typeof record.value === 'string' || typeof record.value === 'number'
        ? { ok: true, text: String(record.value) }
        : miss('unknown');
    }
    case 'fact':
      return lookupText(factValue(ctx.facts, reference.path, ctx.slots), ctx, reference.path);
    case 'fn':
      return lookupText(functionValue(reference.name, reference.args, ctx), ctx, reference.name);
  }
}

/** Fill every `{variable}` — all of them, or none: the misses come back instead of a text. */
export function fillTemplate(text: string, ctx: TemplateContext): TemplateFill {
  const missing: TemplateMiss[] = [];
  const filled = text.replace(/\{([^{}]*)\}/g, (whole, variable: string) => {
    const value = variableText(variable, ctx);
    if (value.ok) return value.text;
    missing.push({ variable, reason: value.reason });
    return whole;
  });
  return missing.length === 0 ? { ok: true, text: filled } : { ok: false, missing };
}

/** A filled template, ready for the reply. */
export interface RenderedTemplate {
  key: string;
  text: string;
  verbatim: boolean;
}

/**
 * The template `key` of the procedure, filled — or null, with the reason in
 * the run log under `at` (the step's id): a key the snapshot does not have, or
 * the variables it lacked.
 */
export function renderTemplate(
  key: string,
  templates: readonly ProcTemplate[],
  ctx: TemplateContext,
  at: string,
  log: SkillRunLogEntry[],
): RenderedTemplate | null {
  const template = templates.find((candidate) => candidate.key === key);
  if (template === undefined) {
    log.push({ step: at, detail: `template ${key} not sent: no such template`, ok: false });
    return null;
  }
  const fill = fillTemplate(template.text, ctx);
  if (!fill.ok) {
    const lacking = fill.missing.map((m) => `{${m.variable}} ${m.reason}`).join(', ');
    log.push({ step: at, detail: `template ${key} not sent: ${lacking}`, ok: false });
    return null;
  }
  return { key, text: fill.text, verbatim: template.verbatim === true };
}

/**
 * What a `say` step contributes to the turn's one message: its template,
 * filled; otherwise its instruction, for the compose call to write from;
 * otherwise nothing (logged — the validator requires one of the two, so only a
 * template that could not be filled on a step without an instruction gets
 * here).
 */
export type SayContribution =
  | { kind: 'template'; key: string; text: string; verbatim: boolean }
  | { kind: 'instruction'; text: string }
  | { kind: 'nothing' };

export function renderSay(
  step: ProcSayStep | Extract<ProcInlineStep, { type: 'say' }>,
  templates: readonly ProcTemplate[],
  ctx: TemplateContext,
  at: string,
  log: SkillRunLogEntry[],
): SayContribution {
  if (step.template_key !== undefined) {
    const rendered = renderTemplate(step.template_key, templates, ctx, at, log);
    if (rendered !== null) return { kind: 'template', ...rendered };
  }
  const instruction = step.instruction?.trim();
  if (instruction) return { kind: 'instruction', text: instruction };
  log.push({ step: at, detail: 'say step has nothing to say', ok: false });
  return { kind: 'nothing' };
}

function miss(reason: TemplateMissReason): { ok: false; reason: TemplateMissReason } {
  return { ok: false, reason };
}

function lookupText(
  lookup: ProcLookup,
  ctx: TemplateContext,
  name: string,
): { ok: true; text: string } | { ok: false; reason: TemplateMissReason } {
  if (!lookup.known) return miss('unknown');
  const text = valueText(lookup.value, ctx, name);
  return text === null ? miss('unknown') : { ok: true, text };
}

const NUMBER_FORMAT = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/** A value as the player reads it. `name` is the fact path or function, which says what a number counts. */
function valueText(value: ProcValue, ctx: TemplateContext, name: string): string | null {
  switch (value.kind) {
    case 'number':
      if (name.endsWith('_minutes')) return durationText(value.value);
      if (name.endsWith('_hours')) return durationText(value.value * 60);
      return NUMBER_FORMAT.format(value.value);
    case 'boolean':
      return value.value ? 'evet' : 'hayır';
    case 'text':
      return value.value.trim() || null;
    case 'moment': {
      const moment =
        value.value instanceof Date ? zonedMoment(value.value, ctx.timeZone) : value.value;
      return moment === null ? null : formatDateTime(moment);
    }
    case 'file':
      return null;
  }
}

/** "30 dk", "1 saat 20 dk"; zero is "0 dk", not an empty string. */
function durationText(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  return whole === 0 ? '0 dk' : formatDuration(whole);
}
