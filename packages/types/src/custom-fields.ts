/**
 * Custom fields for tickets and contacts (FR-MOD-08.7.6).
 *
 * A workspace defines extra fields the product does not ship with — for Nexa,
 * things like a player id, a KYC status or an account balance — and those
 * fields then show up on the ticket Details pane and in the CRM. A definition
 * carries the two properties the requirement turns on (KK "Tip/zorunluluk"): a
 * `type`, which says how a value is validated, and `required`, which says a
 * value may not be left blank.
 *
 * The catalogue of types and the value validator live here, in @nexa/types, so
 * the authoring/editing form (web) and the endpoint that stores a value (api)
 * judge "is this a valid value for this field" by one definition rather than
 * drifting apart — the same single-source approach the ticket e-mail templates
 * use for their placeholder check.
 */

/** The two things a custom field can hang off. */
export const CUSTOM_FIELD_ENTITIES = ['ticket', 'contact'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/**
 * Where a contact field is also asked as a form in the widget (FR-MOD-08.7.7,
 * "Forms builder (pre/post-chat)"). `pre_chat` shows the field on the widget's
 * pre-chat form, before the conversation starts; a `null` placement is a plain
 * CRM field that is never asked in the widget. Only `contact` fields may carry a
 * placement — there is no ticket to hang a value on before a chat exists — which
 * a CHECK in the migration enforces. `post_chat` is reserved for a later slice.
 */
export const FORM_PLACEMENTS = ['pre_chat'] as const;
export type FormPlacement = (typeof FORM_PLACEMENTS)[number];

/**
 * How a value is validated and rendered. `text` is free text; `number` a finite
 * number; `boolean` a true/false; `date` a calendar day. Adding a type is a
 * one-line change here that the validator and the authoring form both pick up.
 */
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'boolean', 'date'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

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
   * (FR-MOD-08.7.7). Only meaningful on `contact` fields.
   */
  form_placement: FormPlacement | null;
  created_at: string;
  updated_at: string;
}

/**
 * A contact field as the widget needs it to render one row of the pre-chat form
 * (FR-MOD-08.7.7): the label to prompt with, the `type` that picks the input and
 * validates the answer, whether it is `required`, and the `definition_id` the
 * answer is written back under. The widget imports this type-only; the answer it
 * collects rides along with the first message and is stored on the contact.
 */
export interface PreChatFormField {
  definition_id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
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

/**
 * Validate a raw string against a field's `type` and `required`, and normalise
 * it to the form that gets stored. A blank value clears the field unless it is
 * required (then it is a problem); a present value must parse as its type. The
 * one judgement both the form and the endpoint make.
 */
export function checkCustomFieldValue(
  field: { label: string; type: CustomFieldType; required: boolean },
  raw: string | null | undefined,
): CustomFieldOk | { problem: CustomFieldProblem } {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

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
  }
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
  field: { label: string; type: CustomFieldType; required: boolean },
  raw: string | null | undefined,
): string | null {
  const result = checkCustomFieldValue(field, raw);
  return isCustomFieldProblem(result) ? result.problem.message : null;
}
