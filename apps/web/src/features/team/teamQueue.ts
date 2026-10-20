/**
 * A team's queue settings and the iGaming queue template (AU-01 · K14 ·
 * ADR-08a) — the pure half of `TeamEditor`'s queue section and
 * `QueueTemplateButton`.
 *
 * Queue settings are three fields of `PATCH`/`POST /groups` (tm 305.1): the
 * topic the team's queue serves (`topic_role`, at most one team per role),
 * what the queue does out of hours (`after_hours_mode`), and the skills an
 * agent needs — every one — to join the team and be given its conversations
 * (`required_expertise_ids`). The Responsible Gambling team is the one with
 * rules of its own (tm 305.3): it keeps its role, it cannot be deleted, and it
 * always requires its training.
 *
 * The template is a deliberate action, not a migration: it creates a team for
 * each of the six topics no team serves yet, and the training skill the
 * Responsible Gambling team requires. It reads what is held at the moment it
 * runs (`GET /routing/queues`), so running it twice — or after a teammate ran
 * it — only fills what is still missing.
 */
import {
  DEFAULT_AFTER_HOURS_MODE,
  QUEUE_TOPIC_ROLES,
  RESPONSIBLE_GAMBLING_ROLE,
  isQueueTopicRole,
  type AfterHoursMode,
  type QueueTopicRole,
} from '@siyahtus/types';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';

/** The fields of a team the queue settings read. */
export interface QueueSettings {
  topic_role: QueueTopicRole | null;
  after_hours_mode: AfterHoursMode;
  required_expertise_ids: number[];
}

/** What `PATCH`/`POST /groups` is sent for the queue settings. */
export type QueueSettingsBody = Partial<QueueSettings>;

/** The form's spelling of the settings: `''` is "no topic", ids are `"3,7"`. */
export interface QueueSettingsValues {
  topic_role: string;
  after_hours_mode: string;
  required_expertise: string;
}

export function isResponsibleGambling(team: { topic_role: QueueTopicRole | null } | null): boolean {
  return team?.topic_role === RESPONSIBLE_GAMBLING_ROLE;
}

/** A set of ids as the form holds it — ascending, so equal sets compare equal. */
export function formatIdList(ids: readonly number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',');
}

export function parseIdList(raw: string): number[] {
  return raw === ''
    ? []
    : raw
        .split(',')
        .map(Number)
        .filter((id) => Number.isInteger(id));
}

/** The form's starting values for a team, or for a new one. */
export function queueSettingsValues(team: QueueSettings | null): QueueSettingsValues {
  return {
    topic_role: team?.topic_role ?? '',
    after_hours_mode: team?.after_hours_mode ?? DEFAULT_AFTER_HOURS_MODE,
    required_expertise: formatIdList(team?.required_expertise_ids ?? []),
  };
}

/**
 * The queue fields to send: only what differs from the team as it stands (or,
 * for a new team, from the server's defaults). Re-sending an unchanged role
 * is harmless, but a body that names only what changed is one a reviewer can
 * read — and one that leaves the server's defaults to the server.
 */
export function queueSettingsBody(
  team: QueueSettings | null,
  values: QueueSettingsValues,
): QueueSettingsBody {
  const before = queueSettingsValues(team);
  const body: QueueSettingsBody = {};
  if (values.topic_role !== before.topic_role) {
    body.topic_role = isQueueTopicRole(values.topic_role) ? values.topic_role : null;
  }
  if (values.after_hours_mode !== before.after_hours_mode) {
    body.after_hours_mode = values.after_hours_mode as AfterHoursMode;
  }
  if (values.required_expertise !== before.required_expertise) {
    body.required_expertise_ids = parseIdList(values.required_expertise);
  }
  return body;
}

/**
 * Which team holds each topic, leaving out `selfId` — the roles the topic
 * picker offers as taken (`group_topic_role_taken` would refuse them).
 */
export function topicHolders(
  teams: ReadonlyArray<{ id: number; name: string; topic_role: QueueTopicRole | null }>,
  selfId: number | null,
): Map<QueueTopicRole, string> {
  const held = new Map<QueueTopicRole, string>();
  for (const team of teams) {
    if (team.topic_role !== null && team.id !== selfId) held.set(team.topic_role, team.name);
  }
  return held;
}

// --- The iGaming queue template ---------------------------------------------

/** One topic role and the team serving it (`GET /routing/queues`). */
export interface RoutingQueue {
  topic_role: QueueTopicRole;
  group_id: number | null;
  group_name: string | null;
  after_hours_mode: AfterHoursMode | null;
}

/** A skill as `GET /settings/expertise` lists it. */
export interface ExpertiseArea {
  id: number;
  name: string;
  slug: string;
}

/** The topics no team serves yet, in `QUEUE_TOPIC_ROLES` order. */
export function missingTopics(queues: readonly RoutingQueue[]): QueueTopicRole[] {
  const held = new Set(queues.filter((q) => q.group_id !== null).map((q) => q.topic_role));
  return QUEUE_TOPIC_ROLES.filter((role) => !held.has(role));
}

/**
 * The slug the server derives from a skill's name (`routes/settings.ts`
 * `expertiseSlug`) — what "a skill with a similar name already exists" is
 * decided on, so it is also how the template recognises the training skill
 * someone already made, whatever its case or spacing.
 */
export function expertiseSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** The training skill, if the catalogue already holds it under any of its names. */
export function findTraining(
  catalogue: readonly ExpertiseArea[],
  names: readonly string[],
): ExpertiseArea | undefined {
  const slugs = new Set(names.map(expertiseSlug));
  return catalogue.find((area) => slugs.has(area.slug));
}

export interface QueueTemplateNames {
  /** The team made for each topic, in the console's language. */
  teams: Record<QueueTopicRole, string>;
  /** The training skill's name: the first is created, any is recognised. */
  training: readonly string[];
}

export interface QueueTemplateResult {
  /** The topics a team was made for. */
  created: QueueTopicRole[];
  /** The training skill made for the Responsible Gambling team, if one was. */
  trainingCreated: boolean;
}

/**
 * Run the template: the training skill first (the Responsible Gambling team
 * is refused without it — `group_protected`), then one team per missing topic.
 *
 * A topic another console took meanwhile (`group_topic_role_taken`) is
 * skipped, not an error — it is served, which is all the template wants. Any
 * other refusal stops the run where it is: what was made stays made, and the
 * next run makes the rest.
 */
export async function applyQueueTemplate(
  api: Pick<ApiClient, 'get' | 'post'>,
  names: QueueTemplateNames,
): Promise<QueueTemplateResult> {
  const queues = await api.get<{ items: RoutingQueue[] }>('/routing/queues');
  const missing = missingTopics(queues.items);
  const result: QueueTemplateResult = { created: [], trainingCreated: false };
  if (missing.length === 0) return result;

  let trainingId: number | null = null;
  if (missing.includes(RESPONSIBLE_GAMBLING_ROLE)) {
    const training = await ensureTraining(api, names.training);
    trainingId = training.area.id;
    result.trainingCreated = training.created;
  }

  for (const role of missing) {
    try {
      await api.post('/groups', {
        name: names.teams[role],
        topic_role: role,
        ...(role === RESPONSIBLE_GAMBLING_ROLE && trainingId !== null
          ? { required_expertise_ids: [trainingId] }
          : {}),
      });
      result.created.push(role);
    } catch (error) {
      if (error instanceof ApiClientError && error.type === 'group_topic_role_taken') continue;
      throw error;
    }
  }
  return result;
}

async function ensureTraining(
  api: Pick<ApiClient, 'get' | 'post'>,
  names: readonly string[],
): Promise<{ area: ExpertiseArea; created: boolean }> {
  const read = async () =>
    findTraining((await api.get<{ items: ExpertiseArea[] }>('/settings/expertise')).items, names);
  const existing = await read();
  if (existing) return { area: existing, created: false };
  try {
    return {
      area: await api.post<ExpertiseArea>('/settings/expertise', { name: names[0] }),
      created: true,
    };
  } catch (error) {
    // Made by someone else between the read and the write: the server refuses
    // the similar name (`not_allowed`, `routes/settings.ts`), and the
    // catalogue now holds it. Any other refusal — a role that may not edit
    // the catalogue — finds nothing on the re-read and is thrown as it came.
    if (error instanceof ApiClientError && error.type === 'not_allowed') {
      const raced = await read();
      if (raced) return { area: raced, created: false };
    }
    throw error;
  }
}
