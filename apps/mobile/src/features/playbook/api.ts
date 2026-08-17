/**
 * The four requests the Playbook screens make, kept apart the same way
 * `features/team/api.ts` is: path literals live here, not scattered across
 * components, so a screen — and a test of one — can hand in a plain object
 * instead of a real session and a real fetch.
 *
 * `getSkill` is a real per-id fetch (unlike Team's agent row): `GET
 * /skills/{skillId}` exists, so the detail screen reads its own copy rather
 * than trusting whatever the list screen passed through navigation params.
 * `listKnowledgeSources` reads the copilot's own knowledge base
 * (`/copilot/knowledge`), not `/knowledge-sources` — that one belongs to the
 * customer-facing AI agent and is skill/knowledge *authoring*, out of scope
 * for mobile the same way `POST /skills`, `PATCH /skills/{skillId}`,
 * `/skills/compile` and `/skills/preview` are (13.7-n KAPSAM).
 */
import type { SessionApiClient } from '../../api/client';
import type { KnowledgeSource, Skill, SkillDetail, SkillRun } from './types';

export interface PlaybookApi {
  listSkills(signal?: AbortSignal): Promise<Skill[]>;
  getSkill(skillId: string, signal?: AbortSignal): Promise<SkillDetail>;
  listSkillRuns(skillId: string, signal?: AbortSignal): Promise<SkillRun[]>;
  listKnowledgeSources(signal?: AbortSignal): Promise<KnowledgeSource[]>;
}

export function createPlaybookApi(client: SessionApiClient): PlaybookApi {
  return {
    listSkills(signal) {
      return client
        .request('get', '/skills', { ...(signal ? { signal } : {}) })
        .then((page) => page.items);
    },

    getSkill(skillId, signal) {
      return client.request('get', '/skills/{skillId}', {
        params: { skillId },
        ...(signal ? { signal } : {}),
      });
    },

    listSkillRuns(skillId, signal) {
      return client
        .request('get', '/skills/{skillId}/runs', {
          params: { skillId },
          ...(signal ? { signal } : {}),
        })
        .then((page) => page.items);
    },

    listKnowledgeSources(signal) {
      return client
        .request('get', '/copilot/knowledge', { ...(signal ? { signal } : {}) })
        .then((page) => page.items);
    },
  };
}
