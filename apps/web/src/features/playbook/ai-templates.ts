/**
 * The ready-made iGaming procedure templates' pure half (tm 311.4 · AI-15):
 * `GET /ai-templates`, `GET /ai-templates/{key}`, `POST /ai-templates/{key}/install`
 * and `POST /ai-templates/packs/igaming_core/install`.
 *
 * The catalogue is the server's — twenty Turkish templates the platform
 * drafts — so unlike `templates.ts` (a static English seed) nothing here
 * lists a template; this file only shapes what the screen reads and sends.
 * Browsing writes nothing; an install writes a switched-off copy that the
 * workspace then owns, which is why "newer version out" is a badge and never
 * a silent change.
 */
import { QUEUE_TOPIC_ROLES, type CompanySector } from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import type { Skill } from './types.js';

/** The gallery tab's id for this catalogue. */
export const IGAMING_CATEGORY = 'igaming';

export const aiTemplatesKey = ['playbook', 'ai-templates'] as const;

/** `AiTemplateTenantMustFill` of the contract — one item of "Kiracının doldurması gerekenler". */
export interface TemplateMustFill {
  kind: 'placeholder' | 'table' | 'setting';
  label: string;
  key?: string;
  example?: string;
  table?: string;
  columns?: string[];
  setting?: 'crisis' | 'complaint' | 'access_info';
}

/** `AiTemplateSummary` of the contract. */
export interface AiTemplateSummary {
  key: string;
  name: string;
  summary: string;
  version: number;
  locked: boolean;
  topics: string[];
  tenant_must_fill_count: number;
  installed_version: number | null;
}

export interface AiTemplatePackSummary {
  key: string;
  version: string;
  template_keys: string[];
  default_rules_count: number;
  sample_rows_count: number;
}

export interface AiTemplateList {
  items: AiTemplateSummary[];
  packs: AiTemplatePackSummary[];
}

/** `AiTemplate` of the contract, the part the preview reads. */
export interface AiTemplateDetail extends AiTemplateSummary {
  when_to_use: string;
  examples: string[];
  forbidden_phrases: Array<{ phrase: string; why: string }>;
  tenant_must_fill: TemplateMustFill[];
  scenarios: Array<{ key: string; name: string }>;
  card_example?: string | null;
}

export interface AiTemplateInstallResult {
  created: boolean;
  skill: Skill;
  tenant_must_fill: TemplateMustFill[];
  unfilled_placeholders: string[];
  unmapped_topics: string[];
}

export interface AiTemplatePackInstallResult {
  pack: string;
  version: string;
  templates: Array<{
    template_key: string;
    skill_id: string;
    created: boolean;
    tenant_must_fill: TemplateMustFill[];
    unfilled_placeholders: string[];
    unmapped_topics: string[];
  }>;
  rules: { created: unknown[]; existing: number };
  sample_rows: { created: number; skipped: number };
  groups_created: Array<{ id: number; name: string; topic_role: string }>;
  persona_style: { address_form: string; emoji: string; max_questions_per_message: number };
  unmapped_topics: string[];
}

/** The one pack v1 has. */
export const IGAMING_PACK_KEY = 'igaming_core';

/** The topics a pack's templates can hand over to — the six queue roles. */
export const PACK_TOPICS: readonly string[] = QUEUE_TOPIC_ROLES;

/** A workspace in this sector sees iGaming first and opens the gallery on it. */
export function galleryStartsOnIgaming(sector: CompanySector | string | null | undefined): boolean {
  return sector === 'gaming_gambling';
}

export type TemplateInstallState = 'available' | 'installed' | 'update';

/** Where a template stands for this workspace: not installed, installed, or installed with a newer version out. */
export function installState(template: AiTemplateSummary): TemplateInstallState {
  if (template.installed_version === null) return 'available';
  return template.installed_version < template.version ? 'update' : 'installed';
}

/**
 * The `route_mapping` of an install: the topics given a team, as `{ topic: id }`.
 * Undefined when nothing was chosen — the body then carries no key at all, so a
 * workspace without `access_rules:rw` is never refused for a mapping it did not make.
 */
export function routeMappingBody(
  chosen: Record<string, string>,
): Record<string, number> | undefined {
  const entries = Object.entries(chosen).filter(([, team]) => team !== '');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([topic, team]) => [topic, Number(team)]));
}

/** What a refusal's `details.reason` says that `common.errors` does not. */
const INSTALL_REFUSALS: ReadonlySet<string> = new Set([
  'template_route_unknown_topic',
  'handoff_route_unknown_team',
  'handoff_route_unknown_brand',
  'handoff_routes_limit',
  'forbidden_phrases_limit',
]);

export function installErrorKey(error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'validation') {
    const reason = error.details?.['reason'];
    if (typeof reason === 'string' && INSTALL_REFUSALS.has(reason)) {
      return `playbook.aiTemplates.error.${reason}`;
    }
  }
  return errorMessageKey(error);
}

/** The placeholders left in a pack install, across its templates, once each. */
export function packUnfilled(result: AiTemplatePackInstallResult): string[] {
  const seen = new Set<string>();
  for (const template of result.templates) {
    for (const key of template.unfilled_placeholders) seen.add(key);
  }
  return [...seen];
}
