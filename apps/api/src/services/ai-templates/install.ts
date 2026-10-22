/**
 * Installing the platform's ready-made procedure templates (tm 311.3 ·
 * SiyahTuş analysis AI-15 · ADR `docs/adr/ai-template-catalog.md` §2.3–§2.4).
 *
 * An install is a copy, never a live reference: the template's procedure
 * becomes an ordinary procedure skill of one AI agent, switched off (the
 * draft until AI-20's versions, tm 316), carrying `template_key` and
 * `template_version` — what the gallery's "yeni sürüm var" badge and the root
 * panel's counts read (installed: `template_key` set, at `created_at`;
 * published: `active`). Its forbidden phrases (AI-08) go with it, scoped to
 * the copy. A newer template version never touches a copy.
 *
 *   - **Idempotent** per agent and template: a copy already there is returned
 *     and nothing is written, unless `force_copy`. One installer per agent at
 *     a time — a transaction-scoped advisory lock taken first — so two
 *     installs at once leave one copy; `force_copy` rules out a unique index.
 *   - **Topics, not teams.** A template hands over to a routing topic;
 *     `route_mapping` writes the hand-over routes (AI-12) that send it to a
 *     team. A topic nothing serves does not stop the install — it stops
 *     publishing ({@link templatePublishProblem}).
 *   - **The lock** is the copy's template's (`isLockedTemplateKey`), set on
 *     the row by the server and read back from either: a locked copy is never
 *     switched off or deleted (409 `template_locked`).
 *   - **The pack** (`igaming_core`) installs every template the same way, then
 *     the default behaviour rules (AI-07), switched off, and the "örnek —
 *     doğrulayın" table rows (AI-13, `source = 'sample'`: the AI reads none
 *     until a person edits or reviews it), and — only with `create_groups` —
 *     a team per topic nothing serves.
 *
 * Every write goes through `config-draft.ts`, a team's through
 * `group-service.ts`, a table row's through the tables' writer.
 */
import type { Prisma, Skill } from '@prisma/client';
import {
  IGAMING_CORE_PACK,
  igamingTemplate,
  isLockedTemplateKey,
  procedureTopics,
  templatePlaceholders,
  templateSkillFields,
  templateTopics,
  type AiTemplate,
  type AiTemplatePack,
  type TemplateForbiddenPhrase,
  type TemplateProcedure,
} from '@siyahtus/ai-templates';
import {
  FORBIDDEN_PHRASES_PER_AGENT_MAX,
  FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX,
  GUIDANCE_RULES_PER_AGENT_MAX,
  GUIDANCE_SCOPE_IDS_MAX,
  HANDOFF_ROUTES_MAX,
  RESPONSIBLE_GAMBLING_ROLE,
  foldGuardrailText,
  handoffTopicRole,
  procedureProblemDetails,
  readGuidanceScope,
  splitSkillProcedure,
  validateSkillProcedure,
  type GuidanceScope,
  type KnowledgeTable,
  type QueueTopicRole,
} from '@siyahtus/types';
import type { AiGuidanceRule } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { AuditContext } from '../audit/audit-log.js';
import {
  createForbiddenPhraseDraft,
  createGuidanceRuleDraft,
  createHandoffRouteDraft,
  createSkillDraft,
  markKnowledgeTableRowsSampleDraft,
  updateForbiddenPhraseDraft,
  updateHandoffRouteDraft,
} from '../ai/config-draft.js';
import { importKnowledgeTableRows } from '../knowledge-tables/writer.js';
import { createGroup } from '../team/group-service.js';

/** Who installs, for which workspace. */
export interface TemplateInstaller {
  licenseId: bigint;
  /** The person (`accounts.id`); null for a token that is no one's. */
  accountId: string | null;
  audit: AuditContext;
}

/** The catalogue's template of this key, or null. */
export function aiTemplateOf(key: string | null | undefined): AiTemplate | null {
  return typeof key === 'string' ? igamingTemplate(key) : null;
}

/** The catalogue's pack of this key, or null. */
export function aiTemplatePackOf(key: string): AiTemplatePack | null {
  return key === IGAMING_CORE_PACK.key ? IGAMING_CORE_PACK : null;
}

/**
 * Whether a skill is a locked template copy: the server's flag on the row,
 * or its template's lock — never something a request wrote (ADR §2.4).
 */
export function isLockedCopy(skill: { locked: boolean; templateKey: string | null }): boolean {
  return skill.locked || (skill.templateKey !== null && isLockedTemplateKey(skill.templateKey));
}

/** 409 `template_locked`: switching off or deleting a locked copy. */
export function templateLocked(action: 'switched off' | 'deleted' | 'given examples'): ApiError {
  return new ApiError(
    'template_locked',
    `A procedure installed from a locked template cannot be ${action}; only its texts and its team change.`,
  );
}

/**
 * The placeholders a copy's texts may hold — its template's — for the
 * procedure validator, which refuses any other unknown variable.
 */
export function copyPlaceholders(templateKey: string | null): ReadonlySet<string> | undefined {
  const template = aiTemplateOf(templateKey);
  return template ? new Set(templatePlaceholders(template)) : undefined;
}

/** A copy's definition, as the row stores it. */
export interface CopyDefinition {
  whenToUse: string | null;
  slots: unknown;
  procedure: unknown;
}

/** The template's placeholders the copy still holds as `{key}`, in checklist order. */
export function unfilledPlaceholders(template: AiTemplate, copy: CopyDefinition): string[] {
  const text = JSON.stringify([copy.whenToUse, copy.slots, copy.procedure]);
  return templatePlaceholders(template).filter((key) => text.includes(`{${key}}`));
}

/** The topics a stored procedure hands over to; none when it is not one. */
export function copyTopics(procedure: unknown): string[] {
  if (procedure === null || typeof procedure !== 'object') return [];
  const body = procedure as Partial<Pick<TemplateProcedure, 'handoff' | 'steps'>>;
  if (!Array.isArray(body.steps) || body.handoff === null || typeof body.handoff !== 'object') {
    return [];
  }
  return procedureTopics({ handoff: body.handoff, steps: body.steps });
}

/**
 * The topics no team serves: a topic is served by an active hand-over route
 * for it whose team still exists — any brand's — or by the team holding its
 * queue role (AU-01), the two ways a hand-over resolves a topic
 * (`target-resolver.ts` step 3). A topic that is no queue role reaches no team.
 */
export async function unmappedTopics(
  tx: TenantClient,
  topics: readonly string[],
): Promise<string[]> {
  if (topics.length === 0) return [];
  const roles = [
    ...new Set(topics.map(handoffTopicRole).filter((r): r is QueueTopicRole => r !== null)),
  ];
  const routes =
    roles.length === 0
      ? []
      : await tx.handoffRoute.findMany({
          where: { matchType: 'topic', active: true, matchKey: { in: roles } },
          select: { matchKey: true, groupId: true },
        });
  const teams =
    roles.length === 0
      ? []
      : await tx.group.findMany({
          where: {
            OR: [{ topicRole: { in: roles } }, { id: { in: routes.map((r) => r.groupId) } }],
          },
          select: { id: true, topicRole: true },
        });
  const teamIds = new Set(teams.map((team) => team.id));
  const served = (role: QueueTopicRole) =>
    teams.some((team) => team.topicRole === role) ||
    routes.some((route) => route.matchKey === role && teamIds.has(route.groupId));
  return topics.filter((topic) => {
    const role = handoffTopicRole(topic);
    return role === null || !served(role);
  });
}

/** Why a copy cannot be switched on, or null (AI-15 §3–§4). */
export type TemplatePublishProblem =
  | { reason: 'template_unfilled'; placeholders: string[] }
  | { reason: 'template_unmapped'; topics: string[] };

export async function templatePublishProblem(
  tx: TenantClient,
  copy: CopyDefinition & { templateKey: string | null },
): Promise<TemplatePublishProblem | null> {
  const template = aiTemplateOf(copy.templateKey);
  if (template) {
    const placeholders = unfilledPlaceholders(template, copy);
    if (placeholders.length > 0) return { reason: 'template_unfilled', placeholders };
  }
  if (copy.templateKey === null) return null;
  const topics = await unmappedTopics(tx, copyTopics(copy.procedure));
  return topics.length > 0 ? { reason: 'template_unmapped', topics } : null;
}

/** The refusal of {@link templatePublishProblem}: 400 `validation`. */
export function refuseTemplatePublish(problem: TemplatePublishProblem): never {
  throw ApiError.validation(
    problem.reason === 'template_unfilled'
      ? `Replace the placeholders first: ${problem.placeholders.map((key) => `{${key}}`).join(', ')}.`
      : `Send these topics to a team first: ${problem.topics.join(', ')}.`,
    { ...problem },
  );
}

/** The customer-facing agent, under RLS; a validation error otherwise. */
export async function requireTemplateAgent(tx: TenantClient, aiAgentId: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.validation('That AI agent does not exist.');
}

/** One installer per workspace and agent, until this transaction ends. */
async function lockInstalls(tx: TenantClient, licenseId: bigint, aiAgentId: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`ai_template_install:${licenseId}:${aiAgentId}`}, 0))`;
}

// ---------------------------------------------------------------------------
// Routes and teams.
// ---------------------------------------------------------------------------

/**
 * `route_mapping`: a topic route per mapped topic, for every brand or for each
 * of `brandIds`; the route already there for that topic and brand is pointed
 * at the team. Only the topics the templates hand over to may be mapped.
 */
export async function applyRouteMapping(
  tx: TenantClient,
  installer: TemplateInstaller,
  input: {
    mapping: Readonly<Record<string, number>>;
    brandIds: readonly string[] | undefined;
    topics: readonly string[];
  },
): Promise<void> {
  const entries = Object.entries(input.mapping);
  if (entries.length === 0) return;
  for (const [topic] of entries) {
    if (!input.topics.includes(topic) || handoffTopicRole(topic) === null) {
      throw ApiError.validation(
        `route_mapping.${topic}: not a topic these templates hand over to.`,
        {
          reason: 'template_route_unknown_topic',
          topic,
        },
      );
    }
  }
  const groupIds = [...new Set(entries.map(([, groupId]) => BigInt(groupId)))];
  const groups = await tx.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true },
  });
  const known = new Set(groups.map((group) => group.id));
  const unknown = groupIds.find((id) => !known.has(id));
  if (unknown !== undefined) {
    throw ApiError.validation('route_mapping: not a team of this workspace.', {
      reason: 'handoff_route_unknown_team',
      group_id: Number(unknown),
    });
  }
  if (input.brandIds !== undefined) {
    const found = await tx.brand.count({ where: { id: { in: [...input.brandIds] } } });
    if (found !== new Set(input.brandIds).size) {
      throw ApiError.validation('brand_ids: every id must be a brand of this workspace.', {
        reason: 'handoff_route_unknown_brand',
      });
    }
  }

  const brands: Array<string | null> = input.brandIds ? [...new Set(input.brandIds)] : [null];
  let held = await tx.handoffRoute.count();
  for (const [topic, groupId] of entries) {
    const role = handoffTopicRole(topic)!;
    for (const brandId of brands) {
      const existing = await tx.handoffRoute.findFirst({
        where: { matchType: 'topic', matchKey: role, brandId },
        select: { id: true, groupId: true, active: true },
      });
      if (existing) {
        if (existing.groupId !== BigInt(groupId) || !existing.active) {
          await updateHandoffRouteDraft(tx, existing.id, {
            groupId: BigInt(groupId),
            active: true,
            updatedBy: installer.accountId,
          });
        }
        continue;
      }
      if (held >= HANDOFF_ROUTES_MAX) {
        throw ApiError.validation(`A workspace holds at most ${HANDOFF_ROUTES_MAX} routes.`, {
          reason: 'handoff_routes_limit',
          limit: HANDOFF_ROUTES_MAX,
        });
      }
      await createHandoffRouteDraft(tx, {
        licenseId: installer.licenseId,
        brandId,
        matchType: 'topic',
        matchKey: role,
        groupId: BigInt(groupId),
        createdBy: installer.accountId,
        updatedBy: installer.accountId,
      });
      held += 1;
    }
  }
}

/** The teams `create_groups` makes, by queue role (K14's six queues, AI-12 §8). */
export const TEMPLATE_TEAM_NAMES: Readonly<Record<QueueTopicRole, string>> = {
  finance: 'Finans',
  kyc_risk: 'KYC ve Risk',
  bonus: 'Bonus',
  responsible_gambling: 'Sorumlu Oyun',
  technical: 'Teknik Destek',
  complaint: 'Şikâyetler',
};

/** The training the Responsible Gambling team requires (K14) when the pack makes it. */
export const RESPONSIBLE_GAMBLING_EXPERTISE = {
  name: 'Sorumlu Oyun eğitimi',
  slug: 'sorumlu-oyun-eğitimi',
} as const;

/**
 * A team for every topic nothing serves yet, holding the topic's queue role —
 * the Responsible Gambling team with its training as the requirement (the
 * expertise made when the workspace has none of that slug).
 */
async function createTopicTeams(
  tx: TenantClient,
  installer: TemplateInstaller,
  topics: readonly string[],
): Promise<Array<{ id: number; name: string; topic_role: QueueTopicRole }>> {
  const missing = await unmappedTopics(tx, topics);
  const roles = [
    ...new Set(missing.map(handoffTopicRole).filter((r): r is QueueTopicRole => r !== null)),
  ];
  const created: Array<{ id: number; name: string; topic_role: QueueTopicRole }> = [];
  for (const role of roles) {
    let requiredExpertiseIds: bigint[] = [];
    if (role === RESPONSIBLE_GAMBLING_ROLE) {
      const expertise =
        (await tx.expertise.findFirst({
          where: { slug: RESPONSIBLE_GAMBLING_EXPERTISE.slug },
          select: { id: true, archived: true },
        })) ??
        (await tx.expertise.create({
          data: { licenseId: installer.licenseId, ...RESPONSIBLE_GAMBLING_EXPERTISE },
          select: { id: true, archived: true },
        }));
      if (expertise.archived) {
        await tx.expertise.update({
          where: { licenseId_id: { licenseId: installer.licenseId, id: expertise.id } },
          data: { archived: false },
        });
      }
      requiredExpertiseIds = [expertise.id];
    }
    const group = await createGroup(tx, installer.audit, installer.licenseId, {
      name: TEMPLATE_TEAM_NAMES[role],
      topicRole: role,
      requiredExpertiseIds,
    });
    created.push({ id: Number(group.id), name: group.name, topic_role: role });
  }
  return created;
}

// ---------------------------------------------------------------------------
// One template.
// ---------------------------------------------------------------------------

/**
 * The template's forbidden phrases for its copy: a phrase the agent already
 * holds for every reply needs nothing, one held for some skills takes the copy
 * into its scope, any other is a new phrase scoped to the copy.
 */
async function installForbiddenPhrases(
  tx: TenantClient,
  installer: TemplateInstaller,
  aiAgentId: string,
  skillId: string,
  phrases: readonly TemplateForbiddenPhrase[],
): Promise<void> {
  const held = await tx.aiForbiddenPhrase.findMany({
    where: { aiAgentId },
    select: { id: true, phrase: true, match: true, scope: true },
  });
  const key = (phrase: string, match: string) =>
    match === 'regex' ? phrase.trim() : foldGuardrailText(phrase.trim());
  let total = held.length;
  let regexes = held.filter((row) => row.match === 'regex').length;
  for (const phrase of phrases) {
    const twin = held.find(
      (row) =>
        row.match === phrase.match &&
        key(row.phrase, row.match) === key(phrase.phrase, phrase.match),
    );
    const scope = twin ? readGuidanceScope(twin.scope) : null;
    if (twin && scope && 'all' in scope) continue;
    if (twin && scope && 'skill_ids' in scope) {
      if (scope.skill_ids.includes(skillId)) continue;
      if (scope.skill_ids.length < GUIDANCE_SCOPE_IDS_MAX) {
        const next: GuidanceScope = { skill_ids: [...scope.skill_ids, skillId] };
        await updateForbiddenPhraseDraft(tx, twin.id, {
          scope: next as Prisma.InputJsonValue,
          updatedBy: installer.accountId,
        });
        twin.scope = next;
        continue;
      }
    }
    if (total >= FORBIDDEN_PHRASES_PER_AGENT_MAX) {
      throw ApiError.validation(
        `An AI agent holds at most ${FORBIDDEN_PHRASES_PER_AGENT_MAX} forbidden phrases.`,
        { reason: 'forbidden_phrases_limit', limit: FORBIDDEN_PHRASES_PER_AGENT_MAX },
      );
    }
    if (phrase.match === 'regex' && regexes >= FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX) {
      throw ApiError.validation(
        `An AI agent holds at most ${FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX} pattern phrases.`,
        { reason: 'forbidden_phrase_regex_limit', limit: FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX },
      );
    }
    const scoped: GuidanceScope = { skill_ids: [skillId] };
    const row = await createForbiddenPhraseDraft(tx, {
      licenseId: installer.licenseId,
      aiAgentId,
      phrase: phrase.phrase,
      match: phrase.match,
      lang: null,
      scope: scoped as Prisma.InputJsonValue,
      action: 'block',
      active: true,
      createdBy: installer.accountId,
      updatedBy: installer.accountId,
    });
    held.push({ id: row.id, phrase: row.phrase, match: row.match, scope: row.scope });
    total += 1;
    if (phrase.match === 'regex') regexes += 1;
  }
}

/** The copy, judged as `PATCH /skills` judges a procedure, and written switched off. */
async function writeCopy(
  tx: TenantClient,
  installer: TemplateInstaller,
  template: AiTemplate,
  aiAgentId: string,
): Promise<Skill> {
  const fields = templateSkillFields(template);
  const groups = await tx.group.findMany({ select: { id: true } });
  const result = validateSkillProcedure(fields, {
    groupIds: new Set(groups.map((group) => Number(group.id))),
    placeholders: new Set(templatePlaceholders(template)),
  });
  if (!result.ok) {
    const problem = result.problems[0]!;
    throw ApiError.validation(problem.message, { ...procedureProblemDetails(problem) });
  }
  const split = splitSkillProcedure(result.procedure);
  const skill = await createSkillDraft(tx, {
    licenseId: installer.licenseId,
    aiAgentId,
    name: template.name,
    kind: 'ai_agent',
    mode: 'procedure',
    whenToUse: split.when_to_use,
    examples: split.examples,
    priority: split.priority,
    slots: split.slots as unknown as Prisma.InputJsonValue,
    procedure: split.procedure as unknown as Prisma.InputJsonValue,
    steps: [],
    locked: isLockedTemplateKey(template.key),
    templateKey: template.key,
    templateVersion: template.version,
    active: false,
    createdBy: installer.accountId,
  });
  await installForbiddenPhrases(tx, installer, aiAgentId, skill.id, template.forbidden_phrases);
  return skill;
}

/** What one template's install left, for its response. */
export interface TemplateInstallOutcome {
  skill: Skill;
  created: boolean;
  unfilledPlaceholders: string[];
  unmappedTopics: string[];
}

async function outcomeOf(
  tx: TenantClient,
  template: AiTemplate,
  skill: Skill,
  created: boolean,
): Promise<TemplateInstallOutcome> {
  return {
    skill,
    created,
    unfilledPlaceholders: unfilledPlaceholders(template, skill),
    unmappedTopics: await unmappedTopics(tx, copyTopics(skill.procedure)),
  };
}

/** The agent's copy, or a new one; the caller holds the agent's install lock. */
async function copyOf(
  tx: TenantClient,
  installer: TemplateInstaller,
  template: AiTemplate,
  aiAgentId: string,
  forceCopy: boolean,
): Promise<{ skill: Skill; created: boolean }> {
  if (!forceCopy) {
    const existing = await tx.skill.findFirst({
      where: { aiAgentId, kind: 'ai_agent', templateKey: template.key },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (existing) return { skill: existing, created: false };
  }
  return { skill: await writeCopy(tx, installer, template, aiAgentId), created: true };
}

/** `POST /ai-templates/{key}/install`, in the caller's transaction. */
export async function installTemplate(
  tx: TenantClient,
  installer: TemplateInstaller,
  template: AiTemplate,
  input: {
    aiAgentId: string;
    brandIds?: readonly string[];
    routeMapping?: Readonly<Record<string, number>>;
    forceCopy?: boolean;
  },
): Promise<TemplateInstallOutcome> {
  await requireTemplateAgent(tx, input.aiAgentId);
  await lockInstalls(tx, installer.licenseId, input.aiAgentId);
  await applyRouteMapping(tx, installer, {
    mapping: input.routeMapping ?? {},
    brandIds: input.brandIds,
    topics: templateTopics(template),
  });
  const { skill, created } = await copyOf(
    tx,
    installer,
    template,
    input.aiAgentId,
    input.forceCopy === true,
  );
  return outcomeOf(tx, template, skill, created);
}

// ---------------------------------------------------------------------------
// A pack.
// ---------------------------------------------------------------------------

/** What a pack's install left, for its response. */
export interface PackInstallOutcome {
  templates: Array<{ template: AiTemplate; outcome: TemplateInstallOutcome }>;
  rulesCreated: AiGuidanceRule[];
  rulesExisting: number;
  sampleRows: {
    created: number;
    skipped: number;
    ids: Array<{ table: KnowledgeTable; id: string }>;
  };
  groupsCreated: Array<{ id: number; name: string; topic_role: QueueTopicRole }>;
  unmappedTopics: string[];
}

/** Whether anything was written. */
export function packWroteAnything(outcome: PackInstallOutcome): boolean {
  return (
    outcome.templates.some(({ outcome: one }) => one.created) ||
    outcome.rulesCreated.length > 0 ||
    outcome.sampleRows.created > 0 ||
    outcome.groupsCreated.length > 0
  );
}

const SAMPLE_TABLES = ['payment_methods', 'bonuses', 'kyc_documents', 'rules'] as const;

/**
 * `POST /ai-templates/packs/{pack}/install`, in the caller's transaction: the
 * routes, the teams (`createGroups` only), every template's copy, the default
 * rules a re-install matches by title (written switched off), and the
 * example rows a re-install finds by name (marked `sample`).
 */
export async function installPack(
  tx: TenantClient,
  installer: TemplateInstaller,
  pack: AiTemplatePack,
  input: {
    aiAgentId: string;
    brandIds?: readonly string[];
    routeMapping?: Readonly<Record<string, number>>;
    createGroups?: boolean;
  },
): Promise<PackInstallOutcome> {
  await requireTemplateAgent(tx, input.aiAgentId);
  await lockInstalls(tx, installer.licenseId, input.aiAgentId);
  const templates = pack.template_keys.map((key) => igamingTemplate(key)!);
  const topics = [...new Set(templates.flatMap((template) => templateTopics(template)))];

  await applyRouteMapping(tx, installer, {
    mapping: input.routeMapping ?? {},
    brandIds: input.brandIds,
    topics,
  });
  const groupsCreated = input.createGroups ? await createTopicTeams(tx, installer, topics) : [];

  const copies: Array<{ template: AiTemplate; skill: Skill; created: boolean }> = [];
  for (const template of templates) {
    copies.push({ template, ...(await copyOf(tx, installer, template, input.aiAgentId, false)) });
  }

  // The default rules: one per title on this agent.
  const rules = await tx.aiGuidanceRule.findMany({
    where: { aiAgentId: input.aiAgentId },
    select: { title: true },
  });
  const titles = new Set(rules.map((rule) => rule.title.trim()));
  let held = rules.length;
  const rulesCreated: AiGuidanceRule[] = [];
  let rulesExisting = 0;
  for (const rule of pack.default_rules) {
    if (titles.has(rule.title)) {
      rulesExisting += 1;
      continue;
    }
    if (held >= GUIDANCE_RULES_PER_AGENT_MAX) {
      throw ApiError.validation(
        `An AI agent holds at most ${GUIDANCE_RULES_PER_AGENT_MAX} behaviour rules.`,
        { reason: 'guidance_rules_limit', limit: GUIDANCE_RULES_PER_AGENT_MAX },
      );
    }
    const skillIds = rule.template_keys
      ? copies
          .filter((copy) => rule.template_keys!.includes(copy.template.key))
          .map((copy) => copy.skill.id)
          .slice(0, GUIDANCE_SCOPE_IDS_MAX)
      : [];
    const scope: GuidanceScope = skillIds.length > 0 ? { skill_ids: skillIds } : { all: true };
    rulesCreated.push(
      await createGuidanceRuleDraft(tx, {
        licenseId: installer.licenseId,
        aiAgentId: input.aiAgentId,
        title: rule.title,
        body: rule.body,
        category: rule.category,
        scope: scope as Prisma.InputJsonValue,
        priority: rule.priority,
        active: false,
        ownerId: null,
        createdBy: installer.accountId,
        updatedBy: installer.accountId,
      }),
    );
    titles.add(rule.title);
    held += 1;
  }

  // The example rows: a row the table already answers to by name is skipped.
  const sampleRows: PackInstallOutcome['sampleRows'] = { created: 0, skipped: 0, ids: [] };
  for (const table of SAMPLE_TABLES) {
    const rows = pack.sample_rows[table] as unknown as ReadonlyArray<Record<string, unknown>>;
    if (rows.length === 0) continue;
    const { verdicts, created } = await importKnowledgeTableRows(
      tx,
      { licenseId: installer.licenseId, accountId: installer.accountId },
      table,
      rows.map((row, index) => ({
        line: index + 1,
        row,
        problems: [],
      })),
      false,
    );
    await markKnowledgeTableRowsSampleDraft(
      tx,
      table,
      created.map((record) => record.id),
    );
    sampleRows.created += created.length;
    sampleRows.skipped += verdicts.length - created.length;
    sampleRows.ids.push(...created.map((record) => ({ table, id: record.id })));
  }

  const outcomes: PackInstallOutcome['templates'] = [];
  for (const copy of copies) {
    outcomes.push({
      template: copy.template,
      outcome: await outcomeOf(tx, copy.template, copy.skill, copy.created),
    });
  }
  return {
    templates: outcomes,
    rulesCreated,
    rulesExisting,
    sampleRows,
    groupsCreated,
    unmappedTopics: await unmappedTopics(tx, topics),
  };
}
