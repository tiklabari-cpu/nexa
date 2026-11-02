/**
 * The iGaming tool catalogue — the tool slot's F1 half (tm 321 · SiyahTuş
 * analysis AI-28 · ADR-14a §2.6).
 *
 * A procedure's `tool` step names one of these: "here the deposit is looked up
 * in the operator's system". In F1 nothing is connected — there is no
 * `tool_connections` table, no dispatcher and no outbound request. The engine
 * passes the step (`tool_not_connected` in the decision record), keeps a
 * pending check (`signals.pending_checks`) and the hand-over card lists it as
 * "Kontrol edilmesi gereken"; a simulation scenario may stand in a tool's
 * output (`tool_outputs`) so the branches F2 will take can be tested today.
 *
 * **The rules F2 must keep (written now, built in #322):**
 *
 *   - S2: the procedure engine calls the tool, deterministically — never the
 *     model (`docs/adr/pilot-llm-embedding-provider.md` §6 stays true).
 *   - The inputs come from the procedure's slots, validated; a tool with
 *     `requires_verified_identity` takes the player's identity from the
 *     verified session (the operator-signed widget token, #388), never from a
 *     slot — the slot is what the player *said*, the card marks it "beyan".
 *   - The output is data, not instructions: it reaches a branch as a field
 *     value and the player is told what the procedure's template says.
 *   - Write tools stay off (`kind: 'write'` is in the type, no entry has it).
 *
 * Each schema is versioned (`input_schema_version`): a vendor adapter in F2
 * may need another shape, and a stored procedure says which one it mapped.
 *
 * Pure literals and function declarations only — the widget loader imports
 * the package barrel (memory "types top-level calls bloat the widget loader").
 */

/** What a tool does to the operator's system. F1 ships read tools only. */
export type ToolKind = 'read' | 'write';

/** When the tool runs: every entry is F2's — none runs in this release. */
export type ToolPhase = 'f2';

/** One property of a tool's JSON Schema. `title` is the Turkish label the card shows. */
export interface ToolSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean';
  readonly title: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly format?: 'date-time';
}

/** A tool's input or output, as JSON Schema (an object of scalar properties). */
export interface ToolSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolSchemaProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface ToolDefinition {
  /** Lower snake_case — what a `tool` step's `tool_key` names. */
  readonly key: string;
  /** The Turkish name the card and the editor show: "yatırım sorgusu". */
  readonly title_tr: string;
  readonly title_en: string;
  /** What it looks up, in English, for API callers. */
  readonly description: string;
  readonly input_schema: ToolSchema;
  readonly output_schema: ToolSchema;
  readonly kind: ToolKind;
  /**
   * The player's identity comes from the verified session in F2, not from
   * the slot mapped to {@link identity_inputs}.
   */
  readonly requires_verified_identity: boolean;
  /** The inputs that say who the player is — "(beyan)" on the card in F1. */
  readonly identity_inputs: readonly string[];
  readonly timeout_ms: number;
  readonly phase: ToolPhase;
  readonly input_schema_version: number;
}

/** The catalogue's version — the root panel shows it beside the keys. */
export const IGAMING_TOOL_CATALOG_VERSION = '1';

/** How long a tool may take, in F2. */
export const IGAMING_TOOL_TIMEOUT_MS = 5000;

const USER_ID: ToolSchemaProperty = {
  type: 'string',
  title: 'kullanıcı adı',
  description: "The player's username or member number on the site.",
};
const AMOUNT: ToolSchemaProperty = { type: 'number', title: 'tutar' };
const TIME: ToolSchemaProperty = { type: 'string', title: 'işlem zamanı', format: 'date-time' };
const METHOD: ToolSchemaProperty = { type: 'string', title: 'yöntem' };

/**
 * The platform's catalogue (AI-28): seven read tools. The order is the
 * editor's and the root panel's.
 */
export const IGAMING_TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    key: 'deposit_lookup',
    title_tr: 'yatırım sorgusu',
    title_en: 'deposit lookup',
    description: 'Whether a deposit reached the player account, and when.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: USER_ID,
        amount: AMOUNT,
        time: TIME,
        method: METHOD,
        reference: { type: 'string', title: 'referans no' },
      },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['credited', 'pending', 'rejected', 'not_found'],
        },
        credited_at: { type: 'string', title: 'hesaba geçtiği an', format: 'date-time' },
        amount: AMOUNT,
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'withdrawal_status',
    title_tr: 'çekim durumu',
    title_en: 'withdrawal status',
    description: 'Where a withdrawal request stands.',
    input_schema: {
      type: 'object',
      properties: { user_id: USER_ID, amount: AMOUNT, time: TIME, method: METHOD },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['paid', 'processing', 'pending_review', 'rejected', 'not_found'],
        },
        reason_code: { type: 'string', title: 'neden' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'kyc_status',
    title_tr: 'kimlik doğrulama durumu',
    title_en: 'KYC status',
    description: "The player's identity verification state.",
    input_schema: {
      type: 'object',
      properties: { user_id: USER_ID },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['verified', 'pending', 'rejected', 'not_started'],
        },
        missing_document: { type: 'string', title: 'eksik belge' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'bonus_status',
    title_tr: 'bonus durumu',
    title_en: 'bonus status',
    description: "A bonus on the player's account and its wagering.",
    input_schema: {
      type: 'object',
      properties: { user_id: USER_ID, bonus_name: { type: 'string', title: 'bonus adı' } },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['active', 'completed', 'expired', 'forfeited', 'not_found'],
        },
        wagering_remaining: { type: 'number', title: 'kalan çevrim' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'bet_lookup',
    title_tr: 'bahis sorgusu',
    title_en: 'bet lookup',
    description: 'A bet slip and how it was settled.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: USER_ID,
        bet_id: { type: 'string', title: 'kupon no' },
        time: TIME,
      },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['open', 'won', 'lost', 'void', 'cashed_out', 'not_found'],
        },
        settled_at: { type: 'string', title: 'sonuçlandığı an', format: 'date-time' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'account_status',
    title_tr: 'hesap durumu',
    title_en: 'account status',
    description: "Whether the player's account is open, suspended, closed or self-excluded.",
    input_schema: {
      type: 'object',
      properties: { user_id: USER_ID },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['active', 'suspended', 'closed', 'self_excluded'],
        },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
  {
    key: 'limit_status',
    title_tr: 'limit durumu',
    title_en: 'limit status',
    description: 'The deposit, loss or session limits on the player account.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: USER_ID,
        limit_type: {
          type: 'string',
          title: 'limit türü',
          enum: ['deposit', 'loss', 'wager', 'session'],
        },
      },
      required: ['user_id'],
      additionalProperties: false,
    },
    output_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'durum',
          enum: ['none', 'active', 'pending_change'],
        },
        limit_amount: { type: 'number', title: 'limit tutarı' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    kind: 'read',
    requires_verified_identity: true,
    identity_inputs: ['user_id'],
    timeout_ms: IGAMING_TOOL_TIMEOUT_MS,
    phase: 'f2',
    input_schema_version: 1,
  },
];

/** The catalogue's entry for a key, or undefined. */
export function igamingTool(key: string): ToolDefinition | undefined {
  return IGAMING_TOOL_CATALOG.find((tool) => tool.key === key);
}

/** A scalar an output field may hold — what a branch compares with. */
export type ToolOutputValue = string | number | boolean;

/** Whether `value` fits the output field `field` of `tool` (its type, its enum). */
export function toolOutputValueFits(
  tool: ToolDefinition,
  field: string,
  value: unknown,
): value is ToolOutputValue {
  const property = Object.hasOwn(tool.output_schema.properties, field)
    ? tool.output_schema.properties[field]
    : undefined;
  if (property === undefined) return false;
  if (property.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (property.type === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  return property.enum === undefined || property.enum.includes(value);
}

/**
 * A check a tool step could not make (AI-28 `signals.pending_checks`): the
 * tool, the step and its input mapping — slot names, never values. The card
 * reads the values from the slots when it is built.
 */
export interface PendingCheck {
  tool: string;
  step_id: string;
  inputs: Record<string, string>;
}

/** Where pending checks are kept between turns (`ai_conversations.signals`). */
export const PENDING_CHECKS_SIGNAL = 'pending_checks';

/** The decision record's word for a tool step that had nothing to call (AI-28). */
export const TOOL_NOT_CONNECTED = 'tool_not_connected';

/** The hand-over reasons a tool step gives — both count as a procedure rule (AI-09). */
export const TOOL_HANDOFF_REASONS = ['tool_not_connected', 'tool_error'] as const;
export type ToolHandoffReason = (typeof TOOL_HANDOFF_REASONS)[number];

/** What a tool step does when no tool is connected: go on, or hand over. */
export const TOOL_ON_UNAVAILABLE = ['continue', 'handoff'] as const;
export type ToolOnUnavailable = (typeof TOOL_ON_UNAVAILABLE)[number];

/** What a tool step does when the tool fails. Only a hand-over, in this release. */
export const TOOL_ON_ERROR = ['handoff'] as const;
export type ToolOnError = (typeof TOOL_ON_ERROR)[number];
