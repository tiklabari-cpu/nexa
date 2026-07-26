/**
 * Ticket email template variables (FR-MOD-08.7.5).
 *
 * A ticket email template is branded, reusable text a workspace authors once — an
 * acknowledgement, a resolution note — carrying `{{ placeholders }}` that are
 * filled in per ticket when the mail goes out. The requirement the feature turns
 * on (KK "Geçersiz değişken/format engeli") is that a placeholder may only name a
 * variable the product actually knows how to fill: a typo like `{{ticket.titel}}`
 * or a stray `{{` has to be caught while the template is being written, not
 * discovered as a literal `{{ticket.titel}}` sitting in a customer's inbox.
 *
 * The catalogue and the validator live here, in @nexa/types, so the authoring
 * form (web) and the endpoint that stores a template (api) both judge "valid" by
 * one definition instead of drifting apart.
 */

/**
 * The variables a template may reference, each `group.field`. Adding one is a
 * one-line change here that the validator, the renderer and the authoring hints
 * all pick up — the single source of truth for "what can I put in a template".
 */
export const TEMPLATE_VARIABLES = [
  'ticket.id',
  'ticket.subject',
  'ticket.status',
  'ticket.priority',
  'customer.name',
  'customer.email',
  'agent.name',
  'company.name',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const KNOWN: ReadonlySet<string> = new Set(TEMPLATE_VARIABLES);

/**
 * A placeholder: `{{`, optional spaces, a `group.field` name, optional spaces,
 * `}}`. The inner class `[^{}]` is what makes the checks below honest — a single
 * placeholder can never swallow the next one, and an unclosed or nested brace
 * fails to match here and falls through to the leftover-braces check instead.
 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** A well-formed variable name inside a placeholder: lower dotted identifiers. */
const VARIABLE_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

/** Which half of a template a problem sits in. */
export type TemplateField = 'subject' | 'body';

export interface TemplateProblem {
  field: TemplateField;
  /** The offending placeholder or brace, verbatim, so the author can find it. */
  token: string;
  reason: 'unknown_variable' | 'malformed';
  message: string;
}

/**
 * Every problem in one piece of template text, in reading order. An empty list
 * means the text is safe to store and to render. Two kinds are caught:
 *  - a placeholder naming a variable the product cannot fill (`unknown_variable`);
 *  - a malformed placeholder — an empty `{{}}`, a bad name, or an unbalanced or
 *    nested `{{`/`}}` left over once the well-formed ones are removed (`malformed`).
 */
export function findTemplateProblems(field: TemplateField, text: string): TemplateProblem[] {
  const problems: TemplateProblem[] = [];

  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER.exec(text)) !== null) {
    const token = match[0];
    const name = match[1] ?? '';
    if (!name) {
      problems.push({ field, token, reason: 'malformed', message: `Empty placeholder ${token}.` });
    } else if (!VARIABLE_NAME.test(name)) {
      problems.push({ field, token, reason: 'malformed', message: `Malformed variable ${token}.` });
    } else if (!KNOWN.has(name)) {
      problems.push({
        field,
        token,
        reason: 'unknown_variable',
        message: `Unknown variable {{${name}}} — use one of: ${TEMPLATE_VARIABLES.join(', ')}.`,
      });
    }
  }

  // Anything shaped like a placeholder brace that survived the pass above is
  // unbalanced or nested — `{{ticket.id}`, `}}`, `{{ {{x}} }}` — and malformed.
  const leftover = text.replace(PLACEHOLDER, '');
  if (leftover.includes('{{') || leftover.includes('}}')) {
    const token = leftover.includes('{{') ? '{{' : '}}';
    problems.push({ field, token, reason: 'malformed', message: `Unbalanced ${token} in ${field}.` });
  }

  return problems;
}

/** Problems across a template's subject and body together, subject first. */
export function findTemplateProblemsIn(parts: { subject: string; body: string }): TemplateProblem[] {
  return [
    ...findTemplateProblems('subject', parts.subject),
    ...findTemplateProblems('body', parts.body),
  ];
}

/** A template is valid when neither its subject nor its body has any problem. */
export function isTemplateValid(parts: { subject: string; body: string }): boolean {
  return findTemplateProblemsIn(parts).length === 0;
}

/** The per-variable values used to fill a template at send time. */
export type TemplateContext = Partial<Record<TemplateVariable, string>>;

/**
 * Fill a validated template's placeholders from `context`. Because a template is
 * validated before it is stored, every placeholder reaching here names a known
 * variable; a value the context happens not to carry renders as empty rather
 * than leaving a raw `{{…}}` in the message. A placeholder that somehow names an
 * unknown variable (unvalidated text) is left untouched, never guessed at.
 */
export function renderTemplate(text: string, context: TemplateContext): string {
  return text.replace(PLACEHOLDER, (whole: string, rawName: string) => {
    const name = rawName.trim();
    if (!KNOWN.has(name)) return whole;
    return context[name as TemplateVariable] ?? '';
  });
}
