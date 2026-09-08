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
