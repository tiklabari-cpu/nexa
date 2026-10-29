/**
 * Custom fields for tickets and contacts (FR-MOD-08.7.6).
 *
 * A workspace defines extra fields the product does not ship with — for SiyahTuş,
 * things like a player id, a KYC status or an account balance — and those
 * fields then show up on the ticket Details pane and in the CRM. A definition
 * carries the two properties the requirement turns on (KK "Tip/zorunluluk"): a
 * `type`, which says how a value is validated, and `required`, which says a
 * value may not be left blank.
 *
 * The catalogue of types and the value validator live here, in @siyahtus/types, so
 * the authoring/editing form (web) and the endpoint that stores a value (api)
 * judge "is this a valid value for this field" by one definition rather than
 * drifting apart — the same single-source approach the ticket e-mail templates
 * use for their placeholder check.
 */

/** The two things a custom field can hang off. */
export const CUSTOM_FIELD_ENTITIES = ['ticket', 'contact'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/**
 * Where a field is also asked as a form in the widget (FR-MOD-08.7.7, "Forms
 * builder (pre-chat/post-chat/ticket/prospect)"). A `null` placement is a plain
 * CRM field that is never asked in the widget.
 *
 * The four the PRD names are the four cells of two axes — *when* the widget
 * asks, and *what the answer is about*:
 *
 *   - `pre_chat`  — before the conversation starts; about the person.
 *   - `post_chat` — once it ends, on the same screen as the CSAT prompt; about
 *     the person.
 *   - `ticket`    — when nobody is available and the visitor leaves a message
 *     instead of holding a conversation; about the **request**, so the answer
 *     lands on the ticket that message opens.
 *   - `prospect`  — asked in that same breath, but about the **person** who
 *     left it, so the answer lands on the contact like the two chat forms'.
 *
 * A placement therefore decides which entity a field may hang off, which is
 * what {@link formPlacementEntity} maps and a CHECK in the migration enforces:
 * three of them are contact fields, `ticket` is a ticket field.
 */
export const FORM_PLACEMENTS = ['pre_chat', 'post_chat', 'ticket', 'prospect'] as const;
export type FormPlacement = (typeof FORM_PLACEMENTS)[number];

/**
 * The entity a placement's answers land on — the single mapping the authoring
 * form, the definition endpoint, the widget delivery and the migration's CHECK
 * all read, so "which form may a ticket field be on" has one answer rather than
 * four that can drift.
 *
 * Note what this is *not*: a second identity for the visitor. `prospect` names a
 * moment the widget asks, not a state on a row — the funnel's own predicate
 * (`customers.is_lead`, FR-MOD-13.3 `lead_captured`) is untouched and stays the
 * only thing that makes somebody a lead.
 */
export const FORM_PLACEMENT_ENTITY: Record<FormPlacement, CustomFieldEntity> = {
  pre_chat: 'contact',
  post_chat: 'contact',
  ticket: 'ticket',
  prospect: 'contact',
};

/** The entity a form field with this placement must hang off. */
export function formPlacementEntity(placement: FormPlacement): CustomFieldEntity {
  return FORM_PLACEMENT_ENTITY[placement];
}

/**
 * The placements asked on the widget's offline "leave a message" form — the one
 * moment that writes to two entities at once (the request and the person). Read
 * by the token mint, the endpoint that stores the answers and the widget, so
 * "which forms make up that screen" is stated once.
 */
export const TICKET_FORM_PLACEMENTS = ['ticket', 'prospect'] as const;

/**
 * How a value is validated and rendered. `text` is free text; `number` a finite
 * number; `boolean` a true/false; `date` a calendar day.
 *
 * The last three pick from the definition's own `options` (WG-04): `select`
 * one of them, `multiselect` any number of them, and `topic` one of them *and*
 * that choice routes the conversation — an option may name the team it goes to
 * ("Para çekme" → Finans). A topic is a pre-chat question only, at most one per
 * workspace: it is asked before the conversation exists, and two of them could
 * name two teams.
 */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'topic',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** The types whose value is picked from `options` rather than typed in. */
export const CHOICE_FIELD_TYPES = ['select', 'multiselect', 'topic'] as const;
export type ChoiceFieldType = (typeof CHOICE_FIELD_TYPES)[number];

/** True for a type that carries `options` (and must carry at least one). */
export function isChoiceFieldType(type: CustomFieldType): type is ChoiceFieldType {
  return type === 'select' || type === 'multiselect' || type === 'topic';
}

/** Options one choice field may offer — a list a visitor can still read. */
export const CUSTOM_FIELD_OPTIONS_MAX = 50;
/** Longest option label (and stored value) — one line in the widget. */
export const CUSTOM_FIELD_OPTION_LABEL_MAX = 80;

/**
 * One choice of a `select` / `multiselect` / `topic` field. `value` is what is
 * stored and stays put when the label is reworded, so an answer given last
 * month still reads as the same choice; `label` is what the visitor sees.
 *
 * `target_group_id` is a topic's routing: the team a conversation opened with
 * this choice goes to. It is never sent to the widget — the visitor picks
 * "Para çekme", not the queue behind it — and a team deleted since is ignored
 * (routing falls back to its rules), never an error for the visitor.
 */
export interface CustomFieldOption {
  value: string;
  label: string;
  target_group_id?: number | null;
}

/** An option as the widget renders it: no routing. */
export interface WidgetFormOption {
  value: string;
  label: string;
}

/**
 * Why a definition's `options` cannot be saved for this type, or `null` when
 * they can — the rule the endpoint enforces and the authoring form shows. A
 * choice type needs 1–50 options with distinct values, each value and label
 * 1–80 characters; only a topic may route; any other type takes none.
 */
export function customFieldOptionsProblem(
  type: CustomFieldType,
  options: readonly CustomFieldOption[] | null | undefined,
): string | null {
  if (!isChoiceFieldType(type)) {
    return options && options.length > 0 ? `options: a ${type} field has no options.` : null;
  }
  if (!options || options.length === 0) return 'options: add at least one option.';
  if (options.length > CUSTOM_FIELD_OPTIONS_MAX) {
    return `options: at most ${CUSTOM_FIELD_OPTIONS_MAX} options.`;
  }
  const seen = new Set<string>();
  for (const option of options) {
    const value = option.value.trim();
    const label = option.label.trim();
    if (!value || !label) return 'options: every option needs a label.';
    if (
      value.length > CUSTOM_FIELD_OPTION_LABEL_MAX ||
      label.length > CUSTOM_FIELD_OPTION_LABEL_MAX
    ) {
      return `options: an option is at most ${CUSTOM_FIELD_OPTION_LABEL_MAX} characters.`;
    }
    if (seen.has(value)) return `options: “${label}” is listed twice.`;
    seen.add(value);
    if (type !== 'topic' && option.target_group_id != null) {
      return 'options: only a topic field routes to a team.';
    }
  }
  return null;
}

/** A field a workspace has defined for one of its entities. */
export interface CustomFieldDefinition {
  id: string;
  entity: CustomFieldEntity;
  label: string;
  type: CustomFieldType;
  /** When true, a value may not be left blank (KK "zorunluluk"). */
  required: boolean;
  /**
   * Where this field is asked as a widget form, or `null` for a CRM-only field
   * (FR-MOD-08.7.7). A placement implies the `entity` — see
   * {@link formPlacementEntity} — so `ticket` appears only on a ticket field
   * and the other three only on a contact field.
   */
  form_placement: FormPlacement | null;
  /**
   * Whether this field also renders as a row-inline column on the Contacts
   * table (FR-MOD-03.2.3), rather than only in the Details/CRM panel. Only
   * meaningful on `contact` fields — always false on a `ticket` field.
   */
  show_in_table: boolean;
  /** The choices of a `select` / `multiselect` / `topic` field; null otherwise. */
  options: CustomFieldOption[] | null;
  /**
   * Order within its form (or, for a CRM-only field, among the entity's other
   * CRM fields) — 0 first. Lists and the widget read fields in this order.
   */
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * A field as the widget needs it to render one row of a form (FR-MOD-08.7.7):
 * the label to prompt with, the `type` that picks the input and validates the
 * answer, whether it is `required`, and the `definition_id` the answer is
 * written back under. One shape for all four placements — the widget renders
 * every form field identically; what differs is *when* it asks, how the answer
 * travels (pre-chat rides the first message, post-chat posts to
 * `/customer/chat/form-response`, the ticket and prospect forms post together to
 * `/customer/ticket`) and, for `ticket`, that the answer is stored on the ticket
 * rather than on the contact. The widget imports this type-only.
 */
export interface WidgetFormField {
  definition_id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  /** The choices of a choice type, in order, without their routing; absent otherwise. */
  options?: WidgetFormOption[];
}

/**
 * A field as it appears on one entity: the definition's metadata joined with the
 * stored value, or `null` when nothing has been set. The Details pane and the
 * CRM render this directly — one entry per definition, so a field with no value
 * yet still shows (as empty) rather than silently vanishing.
 */
export interface CustomFieldValue {
  definition_id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  value: string | null;
  /**
   * Carried through from the definition so a reader can tell a form answer
   * apart from a plain CRM field without a second lookup (FR-MOD-13.2, the
   * Traffic visitor 360° panel). On a `ticket` field this is either `ticket` —
   * a question the visitor answered when they left the message — or `null` for
   * a field only an agent fills in.
   */
  form_placement: FormPlacement | null;
  /**
   * Carried through from the definition (FR-MOD-03.2.3): whether this field
   * also renders as a row-inline column on the Contacts table. Always false on
   * a `ticket` field, which has no table row to hang a column value off.
   */
  show_in_table: boolean;
  /** The definition's choices, so a reader can show a label for a stored value. */
  options?: CustomFieldOption[] | null;
}

/** Why a raw value was rejected: it was blank on a required field, or ill-typed. */
export interface CustomFieldProblem {
  reason: 'required' | 'type';
  message: string;
}

/** A value that passed validation, in its canonical stored form (or cleared). */
export interface CustomFieldOk {
  value: string | null;
}

/** `YYYY-MM-DD` — a calendar day, no time or zone. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The fields of a definition the value check reads. */
export interface CustomFieldRule {
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: readonly Pick<CustomFieldOption, 'value'>[] | null;
}

/**
 * A `multiselect` answer's values: a JSON array of strings (`["a","b"]`), the
 * form it is sent and stored in. `null` when the raw text is not one.
 */
export function parseMultiselectValue(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/**
 * Validate a raw string against a field's `type` and `required`, and normalise
 * it to the form that gets stored. A blank value clears the field unless it is
 * required (then it is a problem); a present value must parse as its type — and
 * a choice must be one of the field's options (WG-04). The one judgement both
 * the form and the endpoint make.
 */
export function checkCustomFieldValue(
  field: CustomFieldRule,
  raw: string | null | undefined,
): CustomFieldOk | { problem: CustomFieldProblem } {
  let trimmed = typeof raw === 'string' ? raw.trim() : '';
  const values = field.type === 'multiselect' && trimmed ? parseMultiselectValue(trimmed) : null;
  // An empty selection is a blank answer, judged by `required` like any other.
  if (values?.length === 0) trimmed = '';

  if (!trimmed) {
    if (field.required) {
      return { problem: { reason: 'required', message: `${field.label} is required.` } };
    }
    return { value: null };
  }

  switch (field.type) {
    case 'text':
      return { value: trimmed };
    case 'number': {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        return { problem: { reason: 'type', message: `${field.label} must be a number.` } };
      }
      // Store the canonical numeric form, so "01" and "1.0" read back the same.
      return { value: String(parsed) };
    }
    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (lower !== 'true' && lower !== 'false') {
        return { problem: { reason: 'type', message: `${field.label} must be true or false.` } };
      }
      return { value: lower };
    }
    case 'date': {
      // A well-formed shape *and* a real day: `2026-13-40` matches the regex but
      // is not a date, so parse it too.
      if (!ISO_DATE.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
        return {
          problem: { reason: 'type', message: `${field.label} must be a date (YYYY-MM-DD).` },
        };
      }
      return { value: trimmed };
    }
    case 'select':
    case 'topic': {
      if (!(field.options ?? []).some((option) => option.value === trimmed)) {
        return {
          problem: { reason: 'type', message: `${field.label} must be one of its options.` },
        };
      }
      return { value: trimmed };
    }
    case 'multiselect': {
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!values || values.some((value) => !allowed.includes(value))) {
        return {
          problem: { reason: 'type', message: `${field.label} must be one of its options.` },
        };
      }
      // Canonical: each choice once, in the options' order — so the same
      // selection always reads back as the same text.
      return { value: JSON.stringify(allowed.filter((value) => values.includes(value))) };
    }
  }
}

/**
 * A stored value as a person reads it: a choice's label (labels joined for a
 * multiselect) rather than its stored value; anything else as stored. A value
 * whose option was since removed shows as stored rather than vanishing.
 */
export function customFieldDisplayValue(
  field: { type: CustomFieldType; options?: readonly CustomFieldOption[] | null },
  value: string | null,
): string | null {
  if (value === null || !isChoiceFieldType(field.type)) return value;
  const labelOf = (stored: string): string =>
    field.options?.find((option) => option.value === stored)?.label ?? stored;
  if (field.type !== 'multiselect') return labelOf(value);
  const values = parseMultiselectValue(value);
  return values ? values.map(labelOf).join(', ') : value;
}

/** True when `checkCustomFieldValue` returned a problem rather than a value. */
export function isCustomFieldProblem(
  result: CustomFieldOk | { problem: CustomFieldProblem },
): result is { problem: CustomFieldProblem } {
  return 'problem' in result;
}

/**
 * The field-under error message for a raw value, or `null` when it is
 * acceptable — the shape the web form's validator wants, judged from the same
 * rule the server enforces.
 */
export function customFieldError(
  field: CustomFieldRule,
  raw: string | null | undefined,
): string | null {
  const result = checkCustomFieldValue(field, raw);
  return isCustomFieldProblem(result) ? result.problem.message : null;
}
