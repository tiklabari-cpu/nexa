/**
 * Queue settings and the iGaming queue template, pure half (tm 305.4 · AU-01 ·
 * K14). What is pinned: only changed queue fields are sent, held topics are
 * named, the template fills only what is missing — the Responsible Gambling
 * team with its training, the training found under either language's name —
 * and a topic someone else took meanwhile is skipped rather than failed.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';
import {
  applyQueueTemplate,
  expertiseSlug,
  findTraining,
  missingTopics,
  queueSettingsBody,
  queueSettingsValues,
  topicHolders,
  type QueueTemplateNames,
  type RoutingQueue,
} from './teamQueue.js';

const NAMES: QueueTemplateNames = {
  teams: {
    finance: 'Finans',
    kyc_risk: 'KYC / Risk',
    bonus: 'Bonus',
    responsible_gambling: 'Sorumlu Oyun',
    technical: 'Teknik',
    complaint: 'Şikâyet',
  },
  training: ['Sorumlu oyun eğitimi', 'Responsible gambling training', 'Sorumlu oyun eğitimi'],
};

function queues(held: Partial<Record<string, [number, string]>> = {}): RoutingQueue[] {
  return (
    ['finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint'] as const
  ).map((role) => ({
    topic_role: role,
    group_id: held[role]?.[0] ?? null,
    group_name: held[role]?.[1] ?? null,
    after_hours_mode: held[role] ? 'queue' : null,
  }));
}

/** A stub client: `get`/`post` are generic on the real one, plain mocks here. */
function client(fake: { get: unknown; post: unknown }): Pick<ApiClient, 'get' | 'post'> {
  return fake as Pick<ApiClient, 'get' | 'post'>;
}

function refusal(type: string, status: number): ApiClientError {
  return new ApiClientError({ type: type as never, status, message: type, requestId: 'r' });
}

describe('queue settings body', () => {
  const finance = {
    topic_role: 'finance' as const,
    after_hours_mode: 'queue' as const,
    required_expertise_ids: [7, 3],
  };

  it('sends nothing for a team whose queue settings did not change', () => {
    expect(queueSettingsBody(finance, queueSettingsValues(finance))).toEqual({});
  });

  it('sends each changed field, and clears a topic with null (FR-MOD-08.6.1)', () => {
    expect(
      queueSettingsBody(finance, {
        topic_role: '',
        after_hours_mode: 'ticket',
        required_expertise: '3',
      }),
    ).toEqual({ topic_role: null, after_hours_mode: 'ticket', required_expertise_ids: [3] });
  });

  it('compares the required skills as a set, whatever order the server listed them', () => {
    expect(queueSettingsValues(finance).required_expertise).toBe('3,7');
    expect(
      queueSettingsBody(finance, { ...queueSettingsValues(finance), required_expertise: '3,7' }),
    ).toEqual({});
  });

  it("leaves a new team's defaults to the server", () => {
    expect(queueSettingsBody(null, queueSettingsValues(null))).toEqual({});
    expect(
      queueSettingsBody(null, {
        topic_role: 'responsible_gambling',
        after_hours_mode: 'queue',
        required_expertise: '4',
      }),
    ).toEqual({ topic_role: 'responsible_gambling', required_expertise_ids: [4] });
  });

  it('names the team holding each topic, except the one being edited', () => {
    const teams = [
      { id: 1, name: 'Finans', topic_role: 'finance' as const },
      { id: 2, name: 'Destek', topic_role: null },
      { id: 3, name: 'Sorumlu Oyun', topic_role: 'responsible_gambling' as const },
    ];
    expect([...topicHolders(teams, 1)]).toEqual([['responsible_gambling', 'Sorumlu Oyun']]);
    expect(topicHolders(teams, null).get('finance')).toBe('Finans');
  });
});

describe('the iGaming queue template', () => {
  it('lists the topics no team serves, in the fixed order', () => {
    expect(missingTopics(queues({ bonus: [4, 'Bonus'], finance: [1, 'Money'] }))).toEqual([
      'kyc_risk',
      'responsible_gambling',
      'technical',
      'complaint',
    ]);
  });

  it('recognises the training skill under any case or spacing the server would refuse as similar', () => {
    expect(expertiseSlug('  Sorumlu   Oyun Eğitimi ')).toBe('sorumlu-oyun-eğitimi');
    const catalogue = [
      { id: 1, name: 'VIP', slug: 'vip' },
      { id: 9, name: 'Responsible Gambling Training', slug: 'responsible-gambling-training' },
    ];
    expect(findTraining(catalogue, NAMES.training)?.id).toBe(9);
    expect(findTraining(catalogue.slice(0, 1), NAMES.training)).toBeUndefined();
  });

  it('makes the training first, then all six teams — Responsible Gambling requiring it (FR-MOD-08.6.1 · FR-MOD-08.6.3)', async () => {
    const api = {
      get: vi.fn(async (path: string) =>
        path === '/routing/queues' ? { items: queues() } : { items: [] },
      ),
      post: vi.fn(async (path: string, body: unknown) =>
        path === '/settings/expertise' ? { id: 42, ...(body as object), slug: 's' } : body,
      ),
    };

    const result = await applyQueueTemplate(client(api), NAMES);

    expect(result).toEqual({
      created: ['finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint'],
      trainingCreated: true,
    });
    expect(api.post.mock.calls[0]).toEqual([
      '/settings/expertise',
      { name: 'Sorumlu oyun eğitimi' },
    ]);
    expect(api.post).toHaveBeenCalledWith('/groups', {
      name: 'Sorumlu Oyun',
      topic_role: 'responsible_gambling',
      required_expertise_ids: [42],
    });
    expect(api.post).toHaveBeenCalledWith('/groups', { name: 'Finans', topic_role: 'finance' });
    expect(api.post).toHaveBeenCalledTimes(7);
  });

  it('fills only what is missing, reusing a training skill made in the other language', async () => {
    const api = {
      get: vi.fn(async (path: string) =>
        path === '/routing/queues'
          ? { items: queues({ finance: [1, 'Money'], technical: [5, 'Tech'] }) }
          : {
              items: [
                {
                  id: 8,
                  name: 'Responsible gambling training',
                  slug: 'responsible-gambling-training',
                },
              ],
            },
      ),
      post: vi.fn(async (_path: string, body: unknown) => body),
    };

    const result = await applyQueueTemplate(client(api), NAMES);

    expect(result.created).toEqual(['kyc_risk', 'bonus', 'responsible_gambling', 'complaint']);
    expect(result.trainingCreated).toBe(false);
    expect(api.post).not.toHaveBeenCalledWith('/settings/expertise', expect.anything());
    expect(api.post).toHaveBeenCalledWith('/groups', {
      name: 'Sorumlu Oyun',
      topic_role: 'responsible_gambling',
      required_expertise_ids: [8],
    });
  });

  it('writes nothing once every topic is served — running it twice is safe', async () => {
    const all = Object.fromEntries(
      ['finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint'].map(
        (role, i) => [role, [i + 1, role] as [number, string]],
      ),
    );
    const api = { get: vi.fn(async () => ({ items: queues(all) })), post: vi.fn() };
    expect(await applyQueueTemplate(client(api), NAMES)).toEqual({
      created: [],
      trainingCreated: false,
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('skips a topic another console took meanwhile, and finds a training skill made meanwhile', async () => {
    let expertiseReads = 0;
    const api = {
      get: vi.fn(async (path: string) => {
        if (path === '/routing/queues') return { items: queues() };
        expertiseReads += 1;
        return {
          items:
            expertiseReads === 1
              ? []
              : [{ id: 3, name: 'Sorumlu oyun eğitimi', slug: 'sorumlu-oyun-eğitimi' }],
        };
      }),
      post: vi.fn(async (path: string, body: unknown) => {
        if (path === '/settings/expertise') throw refusal('not_allowed', 403);
        if ((body as { topic_role: string }).topic_role === 'bonus') {
          throw refusal('group_topic_role_taken', 409);
        }
        return body;
      }),
    };

    const result = await applyQueueTemplate(client(api), NAMES);

    expect(result.created).not.toContain('bonus');
    expect(result.created).toHaveLength(5);
    expect(api.post).toHaveBeenCalledWith(
      '/groups',
      expect.objectContaining({ required_expertise_ids: [3] }),
    );
  });

  it('stops at any other refusal, keeping what it made', async () => {
    const api = {
      get: vi.fn(async (path: string) =>
        path === '/routing/queues'
          ? { items: queues({ responsible_gambling: [3, 'RG'] }) }
          : { items: [] },
      ),
      post: vi.fn(async (_path: string, body: unknown) => {
        if ((body as { topic_role: string }).topic_role === 'kyc_risk') {
          throw refusal('authorization', 403);
        }
        return body;
      }),
    };

    await expect(applyQueueTemplate(client(api), NAMES)).rejects.toMatchObject({
      type: 'authorization',
    });
    // Finance was made before the refusal; nothing after it was tried.
    expect(
      api.post.mock.calls.map(([, body]) => (body as { topic_role: string }).topic_role),
    ).toEqual(['finance', 'kyc_risk']);
  });
});
