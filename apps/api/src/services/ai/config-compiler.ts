/**
 * The AI configuration compiler (tm 316.5 · SiyahTuş analysis AI-20 · ADR-14b
 * `docs/adr/ai-config-versioning.md` §2.4, §2.10 (1)).
 *
 * The editing tables are the draft; what a version publishes is one immutable
 * JSON document compiled from them. {@link compileDraft} reads an agent's
 * draft — through the same seam a simulation of the draft reads
 * (`readAndCompile.forSimulation`, `target: 'draft'`), so a test run plays the
 * package that would be submitted — and judges it the way submitting does:
 *
 *   - every active one-message skill's steps pass `validateSteps`, and every
 *     procedure skill's definition passes `validateSkillProcedure` — a skill
 *     the turn would skip as malformed is a skill the reviewer never sees run;
 *   - no behaviour rule asks for what a locked platform rule forbids, and no
 *     two whose scopes overlap contradict each other (AI-07, the model-free
 *     reading `heuristicCheck` — a submission makes no model call);
 *   - every hand-over target names a team the workspace has: a step's
 *     `transfer_to_team`, a procedure's hand-over, a rule's target, a route;
 *   - the package fits {@link AI_CONFIG_PACKAGE_MAX_BYTES}.
 *
 * {@link diffAiConfig} tells a package against the published one it is based
 * on, item by item, and whether the difference touches compliance — the
 * workspace's guardrails or a locked procedure — which makes the owner the only
 * approver (AI-20 coding logic 2–3).
 *
 * Knowledge is not copied into the package: the manifest records each source's
 * chunk generation and scope, and the chunks stay where they are (§2.8).
 */
import { createHash } from 'node:crypto';
import { validateSteps, type SkillStep } from '@siyahtus/ai-mock';
import {
  AI_CONFIG_DIFF_ITEMS_MAX,
  AI_CONFIG_PACKAGE_FORMAT,
  AI_CONFIG_PACKAGE_FORMAT_BASELINE,
  AI_CONFIG_PACKAGE_MAX_BYTES,
  AI_CONFIG_SECTIONS,
  PLATFORM_GUARDRAILS_VERSION,
  readPersona,
  readPersonaStyle,
  validateSkillProcedure,
  type AiConfigComplianceReason,
  type AiConfigDiffKind,
  type AiConfigDiffSummary,
  type AiConfigFinding,
  type AiConfigKnowledgeManifestEntry,
  type AiConfigProblemCode,
  type AiConfigSection,
  type AiConfigSectionDiff,
  type AiConfigWarningCode,
  type Persona,
  type PersonaStyle,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { canonicalJson } from '../audit/audit-chain.js';
import { readAndCompile } from './conversation/turn-config.js';
import type { TurnConfig, TurnSkill } from './conversation/turn.js';
import { heuristicCheck, lockedRuleViolation, scopesOverlap } from './guidance-check.js';

/** `ai_config_versions.snapshot` of a compiled version. */
export interface AiConfigPackage {
  readonly package_format: typeof AI_CONFIG_PACKAGE_FORMAT;
  /** The platform's locked G1–G19 catalogue the package was compiled under (§2.2). */
  readonly guardrail_catalog_version: string;
  /** The agent's own voice; each skill of `turn` carries the same persona and style. */
  readonly agent: { readonly id: string; readonly persona: Persona; readonly style: PersonaStyle };
  /** What a turn runs on — `AiConfigSource`'s `pkg`. */
  readonly turn: TurnConfig;
}

export type AiConfigProblem = AiConfigFinding<AiConfigProblemCode>;
export type AiConfigWarning = AiConfigFinding<AiConfigWarningCode>;

/** A compiled draft, as a version row stores it. */
export interface CompiledAiConfig {
  readonly snapshot: AiConfigPackage;
  /** sha256 of the snapshot's canonical JSON, hex. */
  readonly snapshotHash: string;
  readonly packageFormat: typeof AI_CONFIG_PACKAGE_FORMAT;
  readonly knowledgeManifest: AiConfigKnowledgeManifestEntry[];
  /** The canonical JSON's size in bytes. */
  readonly bytes: number;
}

export type DraftCompilation =
  | {
      readonly ok: true;
      readonly compiled: CompiledAiConfig;
      /** The agent's `draft_revision` read in the same transaction. */
      readonly draftRevision: bigint;
      readonly warnings: AiConfigWarning[];
    }
  | {
      readonly ok: false;
      readonly problems: AiConfigProblem[];
      readonly draftRevision: bigint | null;
      readonly warnings: AiConfigWarning[];
    };

/**
 * An agent's draft compiled and judged. Reads under the transaction's tenant;
 * the revision it returns is the one the package was read at, so a caller that
 * must refuse a draft edited meanwhile locks the agent row first.
 */
export async function compileDraft(
  tx: TenantClient,
  aiAgentId: string,
  options: { maxBytes?: number } = {},
): Promise<DraftCompilation> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId, kind: 'ai_agent' },
    select: { id: true, tone: true, languages: true, persona: true, draftRevision: true },
  });
  if (!agent) {
    return {
      ok: false,
      problems: [
        finding(
          'agent_not_found',
          null,
          null,
          'There is no customer-facing AI agent with this id.',
        ),
      ],
      draftRevision: null,
      warnings: [],
    };
  }
  const { pkg: turn } = await readAndCompile.forSimulation(tx, { aiAgentId, target: 'draft' });
  const teams = await tx.group.findMany({ select: { id: true, name: true } });
  const sources = await tx.knowledgeSource.findMany({
    where: {
      retiredAt: null,
      audiences: { has: 'ai_agent' },
      OR: [{ aiAgentIds: { isEmpty: true } }, { aiAgentIds: { has: aiAgentId } }],
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      audiences: true,
      aiAgentIds: true,
      brandIds: true,
      language: true,
      validUntil: true,
      chunkGeneration: true,
    },
  });

  const snapshot = normalised<AiConfigPackage>({
    package_format: AI_CONFIG_PACKAGE_FORMAT,
    guardrail_catalog_version: turn.guardrails?.catalogVersion ?? PLATFORM_GUARDRAILS_VERSION,
    agent: {
      id: agent.id,
      persona: readPersona(agent),
      style: readPersonaStyle(agent.persona),
    },
    turn,
  });
  const knowledgeManifest = sources
    .map((source): AiConfigKnowledgeManifestEntry => ({
      source_id: source.id,
      generation: source.chunkGeneration,
      type: source.type,
      audiences: [...source.audiences].sort(),
      ai_agent_ids: [...source.aiAgentIds].sort(),
      brand_ids: [...source.brandIds].sort(),
      language: source.language,
      valid_until: source.validUntil?.toISOString() ?? null,
    }))
    .sort((a, b) => compareKeys(a.source_id, b.source_id));

  const text = canonicalJson(snapshot);
  const bytes = Buffer.byteLength(text, 'utf8');
  const problems = validatePackage(snapshot.turn, {
    teams: teams.map((team) => ({ id: Number(team.id), name: team.name })),
  });
  const maxBytes = options.maxBytes ?? AI_CONFIG_PACKAGE_MAX_BYTES;
  if (bytes > maxBytes) {
    problems.push(
      finding(
        'package_too_large',
        null,
        null,
        `The configuration compiles to ${bytes} bytes; the most a version holds is ${maxBytes}.`,
        { bytes, max_bytes: maxBytes },
      ),
    );
  }
  const warnings = [
    ...packageWarnings(snapshot.turn),
    ...sources
      .filter((source) => source.status !== 'ready')
      .sort((a, b) => compareKeys(a.id, b.id))
      .map((source) =>
        finding(
          'knowledge_source_not_ready',
          'knowledge',
          source.id,
          `"${source.name}" is still ${source.status}: the version publishes the chunks it has now.`,
          { status: source.status },
        ),
      ),
  ];

  if (problems.length > 0) {
    return { ok: false, problems, draftRevision: agent.draftRevision, warnings };
  }
  return {
    ok: true,
    compiled: {
      snapshot,
      snapshotHash: createHash('sha256').update(text, 'utf8').digest('hex'),
      packageFormat: AI_CONFIG_PACKAGE_FORMAT,
      knowledgeManifest,
      bytes,
    },
    draftRevision: agent.draftRevision,
    warnings,
  };
}

/** What the package is judged against: the workspace's teams. */
export interface PackageContext {
  teams: ReadonlyArray<{ id: number; name: string }>;
}

/** Everything that stops a turn configuration from being submitted, in package order. */
export function validatePackage(turn: TurnConfig, context: PackageContext): AiConfigProblem[] {
  const problems: AiConfigProblem[] = [];
  const teamIds = new Set(context.teams.map((team) => team.id));
  const teamNames = new Set(context.teams.map((team) => team.name));
  const unknownTeam = (
    section: AiConfigSection,
    key: string,
    what: string,
    details: Record<string, string | number | null>,
  ) =>
    finding(
      'handoff_target_unknown_team',
      section,
      key,
      `${what} hands over to a team this workspace does not have.`,
      details,
    );

  for (const skill of turn.skills) {
    if (skill.mode === 'procedure') {
      const verdict = validateSkillProcedure(skill.definition ?? {}, { groupIds: teamIds });
      if (!verdict.ok) {
        const [problem] = verdict.problems;
        problems.push(
          finding(
            'skill_procedure_invalid',
            'skills',
            skill.id,
            `"${skill.name}": ${problem?.message ?? 'the procedure does not validate'}.`,
            {
              reason: problem?.code ?? null,
              procedure_section: problem?.section ?? null,
              field: problem?.field ?? null,
            },
          ),
        );
      }
      continue;
    }
    const parsed = validateSteps(skill.steps);
    if (!parsed.ok) {
      problems.push(
        finding('skill_steps_invalid', 'skills', skill.id, `"${skill.name}": ${parsed.reason}.`, {
          reason: parsed.code,
          step: parsed.index >= 0 ? parsed.index + 1 : null,
        }),
      );
      continue;
    }
    for (const [index, step] of parsed.steps.entries()) {
      const target = transferTarget(step);
      if (!target) continue;
      const known =
        target.groupId !== null ? teamIds.has(target.groupId) : teamNames.has(target.name ?? '');
      if (known) continue;
      problems.push(
        unknownTeam('skills', skill.id, `"${skill.name}" step ${index + 1}`, {
          group_id: target.groupId,
          group: target.name,
          step: index + 1,
        }),
      );
    }
  }

  const rules = turn.guidance ?? [];
  for (const [index, rule] of rules.entries()) {
    const locked = lockedRuleViolation(rule.body);
    if (locked) {
      problems.push(
        finding('guidance_locked_rule', 'guidance', rule.id, locked.explanation, {
          locked_rule: locked.locked_rule,
        }),
      );
    }
    const later = rules.slice(index + 1).filter((other) => scopesOverlap(rule.scope, other.scope));
    for (const conflict of heuristicCheck(rule, later).conflicts) {
      problems.push(
        finding('guidance_conflict', 'guidance', rule.id, conflict.explanation, {
          other_rule_id: conflict.rule_id,
        }),
      );
    }
  }

  for (const rule of turn.handoff?.rules ?? []) {
    if (rule.target && 'group_id' in rule.target && !teamIds.has(rule.target.group_id)) {
      problems.push(
        unknownTeam('handoff', `rule:${rule.id}`, `Rule "${rule.title}"`, {
          group_id: rule.target.group_id,
        }),
      );
    }
  }
  for (const route of turn.handoff?.routes ?? []) {
    if (!teamIds.has(route.groupId)) {
      problems.push(
        unknownTeam('handoff', `route:${route.id}`, `Route "${route.matchKey}"`, {
          group_id: route.groupId,
        }),
      );
    }
  }
  return problems;
}

/** What a submitter is told about the package without being stopped. */
function packageWarnings(turn: TurnConfig): AiConfigWarning[] {
  const warnings: AiConfigWarning[] = [];
  const rules = turn.guidance ?? [];
  for (const [index, rule] of rules.entries()) {
    const later = rules.slice(index + 1).filter((other) => scopesOverlap(rule.scope, other.scope));
    for (const duplicate of heuristicCheck(rule, later).duplicates) {
      warnings.push(
        finding('guidance_duplicate', 'guidance', rule.id, duplicate.explanation, {
          other_rule_id: duplicate.rule_id,
        }),
      );
    }
  }
  const procedures = new Set(
    turn.skills.filter((skill) => skill.mode === 'procedure').map((skill) => skill.id),
  );
  for (const rule of turn.handoff?.rules ?? []) {
    if (rule.trigger.type === 'procedure' && !procedures.has(rule.trigger.value)) {
      warnings.push(
        finding(
          'handoff_rule_procedure_inactive',
          'handoff',
          `rule:${rule.id}`,
          `Rule "${rule.title}" waits for a procedure this version does not run: it never fires.`,
          { skill_id: rule.trigger.value },
        ),
      );
    }
  }
  return warnings;
}

function transferTarget(step: SkillStep): { groupId: number | null; name: string | null } | null {
  if (step.type !== 'transfer_to_team') return null;
  return { groupId: step.group_id ?? null, name: step.group ?? null };
}

// ---------------------------------------------------------------------------
// The difference.
// ---------------------------------------------------------------------------

/** A version as the difference reads it: the row's package columns. */
export interface StoredAiConfig {
  /** The version's id; null for the draft being compiled. */
  readonly versionId: string | null;
  readonly packageFormat: number;
  readonly snapshot: unknown;
  readonly knowledgeManifest: unknown;
}

/**
 * `next` against `base` — the published version it would replace, or null
 * when the agent has none. A base still at the migration's uncompiled v1
 * (`package_format` 0) holds nothing to compare, so the package is told
 * against nothing: everything in it is added, and any guardrail of the
 * workspace's makes it a compliance change — the first compiled version is
 * the owner's to approve.
 */
export function diffAiConfig(
  base: StoredAiConfig | null,
  next: Pick<StoredAiConfig, 'snapshot' | 'knowledgeManifest'>,
): AiConfigDiffSummary {
  const fromBaseline = base !== null && base.packageFormat === AI_CONFIG_PACKAGE_FORMAT_BASELINE;
  const before = base && !fromBaseline ? readItems(base) : emptyItems();
  const after = readItems(next);

  const sections: AiConfigSectionDiff[] = [];
  for (const section of AI_CONFIG_SECTIONS) {
    const items = diffItems(before[section], after[section]);
    if (items.length === 0) continue;
    const count = (kind: AiConfigDiffKind) => items.filter((item) => item.kind === kind).length;
    sections.push({
      section,
      added: count('added'),
      removed: count('removed'),
      changed: count('changed'),
      items: items.slice(0, AI_CONFIG_DIFF_ITEMS_MAX),
    });
  }

  const compliance: AiConfigComplianceReason[] = [];
  if (sections.some((section) => section.section === 'guardrails')) compliance.push('guardrails');
  const lockedSkills = new Set([...before.lockedSkills, ...after.lockedSkills]);
  const skillDiff = diffItems(before.skills, after.skills);
  if (skillDiff.some((item) => lockedSkills.has(item.key))) compliance.push('locked_procedure');

  return {
    base_version_id: base?.versionId ?? null,
    from_baseline: fromBaseline,
    changes: sections.reduce(
      (sum, section) => sum + section.added + section.removed + section.changed,
      0,
    ),
    sections,
    touches_compliance: compliance.length > 0,
    compliance,
  };
}

/** A package as keyed items: each section's item key → its canonical JSON. */
type PackageItems = Record<AiConfigSection, Map<string, string>> & {
  lockedSkills: Set<string>;
};

function emptyItems(): PackageItems {
  return {
    agent: new Map(),
    skills: new Map(),
    guidance: new Map(),
    guardrails: new Map(),
    handoff: new Map(),
    knowledge: new Map(),
    lockedSkills: new Set(),
  };
}

function readItems(version: Pick<StoredAiConfig, 'snapshot' | 'knowledgeManifest'>): PackageItems {
  const items = emptyItems();
  const pkg = version.snapshot as Partial<AiConfigPackage> | null;
  const turn: Partial<TurnConfig> = pkg?.turn ?? {};
  const put = (section: AiConfigSection, key: string, value: unknown) => {
    if (value !== undefined) items[section].set(key, canonicalJson(value));
  };

  put('agent', 'persona', pkg?.agent?.persona);
  put('agent', 'style', pkg?.agent?.style);
  put('agent', 'batch_window_seconds', turn.batchWindowSeconds);
  put('agent', 'daily_memory', turn.dailyMemory);
  put('agent', 'clarify_thresholds', turn.clarifyThresholds);

  for (const skill of turn.skills ?? []) {
    // The agent's persona rides on every skill; it is told once, under `agent`.
    const { persona: _persona, style: _style, ...own } = skill as TurnSkill;
    put('skills', skill.id, own);
    if (skill.locked) items.lockedSkills.add(skill.id);
  }
  for (const rule of turn.guidance ?? []) put('guidance', rule.id, rule);

  const guardrails = turn.guardrails;
  for (const settings of guardrails?.settings ?? []) {
    put('guardrails', `settings:${settings.aiAgentId}`, settings);
  }
  for (const rule of guardrails?.rules ?? []) put('guardrails', `rule:${rule.id}`, rule);
  for (const phrase of guardrails?.phrases ?? []) put('guardrails', `phrase:${phrase.id}`, phrase);

  if (turn.handoff) {
    const { rules, routes, ...settings } = turn.handoff;
    put('handoff', 'settings', settings);
    for (const rule of rules ?? []) put('handoff', `rule:${rule.id}`, rule);
    for (const route of routes ?? []) put('handoff', `route:${route.id}`, route);
  }

  const manifest = Array.isArray(version.knowledgeManifest)
    ? (version.knowledgeManifest as AiConfigKnowledgeManifestEntry[])
    : [];
  for (const entry of manifest) put('knowledge', entry.source_id, entry);
  return items;
}

function diffItems(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Array<{ key: string; kind: AiConfigDiffKind }> {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(compareKeys);
  return keys.flatMap((key): Array<{ key: string; kind: AiConfigDiffKind }> => {
    const was = before.get(key);
    const is = after.get(key);
    if (was === undefined) return [{ key, kind: 'added' }];
    if (is === undefined) return [{ key, kind: 'removed' }];
    return was === is ? [] : [{ key, kind: 'changed' }];
  });
}

// ---------------------------------------------------------------------------

/** The value as it reads back from `jsonb`: no `undefined`, keys in one order. */
function normalised<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function finding<Code extends AiConfigProblemCode | AiConfigWarningCode>(
  code: Code,
  section: AiConfigSection | null,
  key: string | null,
  message: string,
  details?: Record<string, string | number | null>,
): AiConfigFinding<Code> {
  return { code, section, key, message, ...(details ? { details } : {}) };
}
