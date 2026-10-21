/**
 * Ready-made procedure templates (tm 311.1 · SiyahTuş analysis AI-15 · ADR
 * `docs/adr/ai-template-catalog.md`).
 *
 * A tenant writing twenty iGaming procedures from scratch takes weeks and gets
 * the sensitive ones wrong — an AI that tries to talk a self-exclusion request
 * out of it. The platform drafts them instead: each template is a whole AI-03
 * procedure (slots, ordered steps, reply templates, hand-over by topic) plus
 * what the gallery and the installer need around it — the phrases its replies
 * must never carry (AI-08), the scenario seeds the test bench runs (AI-19),
 * whether it is locked, what the tenant must fill in before it can be
 * published, and its version.
 *
 * Installing one copies it into a skill row (`POST /ai-templates/{key}/install`,
 * #311.3); the copy is the tenant's from then on and does not change when the
 * template's version does.
 *
 * This module is types, closed lists and pure helpers only — it imports
 * nothing but types, so the API image loads it without `@siyahtus/types` at
 * run time (`package.test.ts`). The judgement is `validate.ts`'s.
 */
import type {
  Cond,
  ForbiddenPhraseMatch,
  GuardrailTenantText,
  HandoffTarget,
  ProcHandoff,
  ProcLimits,
  ProcStep,
  ProcTemplate,
  ProcedureFactPath,
  QueueTopicRole,
  SlotDef,
  SlotEnumSource,
} from '@siyahtus/types';

/** The industries a template is written for (v1: `igaming`); `GET /ai-templates?industry=`. */
export const AI_TEMPLATE_INDUSTRIES = ['igaming'] as const;
export type AiTemplateIndustry = (typeof AI_TEMPLATE_INDUSTRIES)[number];

/** The languages a template is written in (v1: `tr`, AI-15-S3); `GET /ai-templates?lang=`. */
export const AI_TEMPLATE_LANGS = ['tr'] as const;
export type AiTemplateLang = (typeof AI_TEMPLATE_LANGS)[number];

/**
 * The twenty iGaming topics (research §3, AI-15). The responsible gambling
 * signal is spelt with ADR-08a's queue role (`responsible_gambling`), not the
 * analysis' `responsible_gaming` (ADR `ai-template-catalog.md` §3.2). Self-harm
 * (G3) and a suspected minor (G5) are AI-08 guardrails, not procedures.
 */
export const IGAMING_TEMPLATE_KEYS = [
  'deposit_not_credited',
  'withdrawal_pending',
  'withdrawal_rejected',
  'kyc_documents',
  'bonus_claim',
  'wagering_rules',
  'bet_settlement_dispute',
  'game_technical_issue',
  'login_password',
  'account_locked',
  'self_exclusion',
  'responsible_gambling_signal',
  'limit_change',
  'payment_methods_info',
  'wrong_account_or_network',
  'promotion_info',
  'account_details_change',
  'complaint_formal',
  'site_access',
  'multi_account_third_party',
] as const;
export type IgamingTemplateKey = (typeof IGAMING_TEMPLATE_KEYS)[number];

/**
 * The templates a tenant cannot switch off or delete, nor change the structure
 * of — only the wording of their texts and their team (AI-15-S2). The server
 * derives the lock from the installed copy's `template_key`, never from a flag
 * the tenant could write (ADR §2.4).
 */
export const LOCKED_TEMPLATE_KEYS = [
  'self_exclusion',
  'responsible_gambling_signal',
] as const satisfies readonly IgamingTemplateKey[];

/** The one pack v1 ships: `POST /ai-templates/packs/igaming_core/install`. */
export const AI_TEMPLATE_PACK_KEYS = ['igaming_core'] as const;
export type AiTemplatePackKey = (typeof AI_TEMPLATE_PACK_KEYS)[number];

// ---------------------------------------------------------------------------
// The procedure as a template writes it.
// ---------------------------------------------------------------------------

/**
 * A slot as the template writes it: the four fields every slot needs, the rest
 * left to their defaults (`SLOT_DEF_DEFAULTS`) unless the template says otherwise.
 */
export type TemplateSlot = Pick<SlotDef<Cond>, 'name' | 'label' | 'type' | 'ask'> &
  Partial<Omit<SlotDef<Cond>, 'name' | 'label' | 'type' | 'ask'>>;

/**
 * The procedure, in the shape `validateProcedure` takes and a skill stores
 * (#296.2): `when_to_use`, `examples`, `priority` and `slots` are the skill's
 * own fields, the rest its `procedure`. Hand-overs name a routing topic
 * (`{ topic: 'finance' }`), never a team id — the installer maps topics to the
 * tenant's teams (`route_mapping`, AI-12).
 */
export interface TemplateProcedure {
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: TemplateSlot[];
  steps: ProcStep[];
  templates: ProcTemplate[];
  handoff: ProcHandoff;
  limits: ProcLimits;
  resolution_criteria?: Cond;
}

// ---------------------------------------------------------------------------
// What the tenant must fill in (AI-15-S1).
// ---------------------------------------------------------------------------

export const TENANT_MUST_FILL_KINDS = ['placeholder', 'table', 'setting'] as const;
export type TenantMustFillKind = (typeof TENANT_MUST_FILL_KINDS)[number];

/**
 * One item of the "Kiracının doldurması gerekenler" checklist the install
 * returns:
 *
 *   - `placeholder` — a `{key}` left in a reply text for the tenant to replace
 *                     (`{sikayet_suresi}`, `{adr_kurumu}`). Publishing with one
 *                     unresolved is `400 template_unfilled`. `example` is the
 *                     "örnek — doğrulayın" value the scenarios run with; it is
 *                     never installed;
 *   - `table`       — the AI-13 table rows the procedure reads, and which of
 *                     their columns (`method.expected_minutes`): the procedure
 *                     asks and branches on them, so a missing row is a wrong reply;
 *   - `setting`     — a workspace text the procedure relies on: the crisis text
 *                     (G3), the complaint procedure (G15), the access information (K13).
 */
export type TenantMustFill =
  | { kind: 'placeholder'; key: string; label: string; example: string }
  | { kind: 'table'; table: SlotEnumSource; columns: ProcedureFactPath[]; label: string }
  | { kind: 'setting'; setting: GuardrailTenantText; label: string };

// ---------------------------------------------------------------------------
// Forbidden phrases (AI-08) and scenario seeds (AI-19).
// ---------------------------------------------------------------------------

/**
 * A phrase the procedure's replies must never carry — research §3.1's "yasak
 * yanıtlar" — matched as the workspace's own forbidden phrases are
 * (`compileForbiddenPhrase`). Installed with the template; `why` is shown to the tenant.
 */
export interface TemplateForbiddenPhrase {
  phrase: string;
  match: ForbiddenPhraseMatch;
  why: string;
}

/**
 * The player personas a scenario plays (AI-19 `SCENARIO_PERSONAS`, 05 § AI-19);
 * #314 moves the list to `@siyahtus/types` when the test bench arrives.
 */
export const SCENARIO_PERSONAS = [
  'normal',
  'sabirsiz',
  'kizgin',
  'eksik_bilgi',
  'sorumlu_oyun_sinyali',
  'resit_olmayan',
  'insan_istiyor',
  'yabanci_dil',
] as const;
export type ScenarioPersona = (typeof SCENARIO_PERSONAS)[number];

/**
 * How a scenario must end: the procedure resolved the matter, resolved it
 * pending the wait it explained, or handed it to a person.
 */
export const SCENARIO_OUTCOMES = ['resolved', 'resolved_waiting', 'handoff'] as const;
export type ScenarioOutcome = (typeof SCENARIO_OUTCOMES)[number];

/** A value an enum slot may take in a scenario: the table row's name and its aliases. */
export interface ScenarioOption {
  value: string;
  aliases?: string[];
}

/**
 * A scripted test conversation (AI-19 §1 "scripted"): the player's messages in
 * order, at a frozen moment, against one table row's facts. The engine with the
 * mock model must end it as `expect` says, collect `required_slots`, and send no
 * reply that carries a forbidden phrase or trips an output guardrail.
 */
export interface TemplateScenario {
  key: string;
  name: string;
  persona: ScenarioPersona;
  /** When the conversation happens, ISO 8601 with its offset. */
  simulated_now: string;
  turns: string[];
  /** The table row the player's method (bonus, document) resolves to — "örnek — doğrulayın" values. */
  facts: Partial<Record<ProcedureFactPath, string | number | boolean>>;
  /** The rows an enum slot matches the player's words against, by slot name. */
  options?: Record<string, ScenarioOption[]>;
  /** Whether the method processes at the moment asked about; omitted: yes. */
  within_working_hours?: boolean;
  /** The method's next processing window, ISO 8601; omitted: none. */
  next_window?: string;
  expect: {
    outcome: ScenarioOutcome;
    /** A hand-over's `reason_code` — one of the procedure's. */
    reason_code?: string;
    /** A hand-over's routing topic. */
    topic?: QueueTopicRole;
    /** Slots filled when the conversation ends. */
    required_slots: string[];
    /** What some of them hold, as the card shows it (`2.500 TRY`, `18.10.2026 12:00`). */
    values?: Record<string, string>;
    /** Phrases this scenario's replies must not carry, beyond the template's own. */
    forbidden_phrases?: string[];
  };
}

/** At least this many scenarios per template (AI-15 acceptance). */
export const TEMPLATE_SCENARIOS_MIN = 3;

// ---------------------------------------------------------------------------
// The template.
// ---------------------------------------------------------------------------

export interface AiTemplate {
  key: IgamingTemplateKey;
  /** A whole number from 1; raised when the platform changes the template. */
  version: number;
  industry: AiTemplateIndustry;
  lang: AiTemplateLang;
  /** The gallery's title: "Yatırım hesaba geçmedi". */
  name: string;
  /** One or two sentences for the gallery card. */
  summary: string;
  /** Must equal membership in {@link LOCKED_TEMPLATE_KEYS}. */
  locked: boolean;
  procedure: TemplateProcedure;
  forbidden_phrases: TemplateForbiddenPhrase[];
  tenant_must_fill: TenantMustFill[];
  scenarios: TemplateScenario[];
  /** What the agent's hand-over card looks like for this topic (research §3.1), for the preview. */
  card_example?: string;
}

/** The gallery title and the card summary, in characters. */
export const AI_TEMPLATE_NAME_MAX = 80;
export const AI_TEMPLATE_SUMMARY_MAX = 300;

/**
 * A pack: templates installed together. v1's `igaming_core` is the twenty; its
 * default behaviour rules (AI-07) and "örnek — doğrulayın" table rows (AI-13)
 * come with #311.2. `version` is the package's own (`package.json`).
 */
export interface AiTemplatePack {
  key: AiTemplatePackKey;
  version: string;
  industry: AiTemplateIndustry;
  lang: AiTemplateLang;
  template_keys: IgamingTemplateKey[];
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Whether a key names a locked template. */
export function isLockedTemplateKey(key: string): boolean {
  return (LOCKED_TEMPLATE_KEYS as readonly string[]).includes(key);
}

function targetTopic(target: HandoffTarget | undefined): string | undefined {
  return target !== undefined && 'topic' in target ? target.topic : undefined;
}

/**
 * The routing topics the template hands over to, once each, in order of first
 * mention: the procedure's own target, then its steps' and their branches'.
 * The keys `route_mapping` maps to teams; one left unmapped blocks publishing.
 */
export function templateTopics(template: AiTemplate): string[] {
  const topics = new Set<string>();
  const add = (target: HandoffTarget | undefined) => {
    const topic = targetTopic(target);
    if (topic !== undefined) topics.add(topic);
  };
  add(template.procedure.handoff.target);
  for (const step of template.procedure.steps) {
    if (step.type === 'handoff') add(step.target);
    if (step.type === 'check') {
      for (const branch of [step.then, step.else]) {
        if (branch !== undefined && 'type' in branch && branch.type === 'handoff') {
          add(branch.target);
        }
      }
    }
  }
  return [...topics];
}

/** The `{key}` placeholders the tenant must replace, from the checklist. */
export function templatePlaceholders(template: AiTemplate): string[] {
  return template.tenant_must_fill.flatMap((item) =>
    item.kind === 'placeholder' ? [item.key] : [],
  );
}

/**
 * The template as a skill row stores it (#296.2): the skill's own four fields,
 * and the rest as its `procedure`. Deep copies — an install never shares
 * objects with the catalogue.
 */
export function templateSkillFields(template: AiTemplate): {
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: TemplateSlot[];
  procedure: Pick<
    TemplateProcedure,
    'steps' | 'templates' | 'handoff' | 'limits' | 'resolution_criteria'
  >;
} {
  const copy = JSON.parse(JSON.stringify(template.procedure)) as TemplateProcedure;
  const { when_to_use, examples, priority, slots, ...procedure } = copy;
  return { when_to_use, examples, priority, slots, procedure };
}
