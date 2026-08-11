/**
 * The AI agent persona (FR-MOD-06.4).
 *
 * The persona is what a visitor sees — name, face, tone, languages, how long an
 * answer runs. It has to survive a round trip through `PATCH /ai-agents/:id` and
 * come back on the next read exactly as stored, because the widget reads it to
 * decide who the visitor is talking to. `answer_length` lives inside the persona
 * JSON, so the test that matters most is the merge one: setting it must not wipe
 * a signature an admin set separately.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface AgentView {
  id: string;
  name: string;
  tone: string | null;
  avatar_url: string | null;
  languages: string[];
  answer_length: string | null;
  active: boolean;
}

describe('AI agent profile', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentId: string;

  const write = async (tenant: 'a' | 'b'): Promise<Record<string, string>> => {
    const token = await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    return { authorization: `Bearer ${token}` };
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const agent = await owner.aiAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'ai_agent',
        name: 'Ada',
        tone: 'friendly',
        languages: ['en'],
        persona: { answerLength: 'short', signature: '— Ada' },
      },
      select: { id: true },
    });
    agentId = agent.id;
  });

  it('lists the persona fields the widget reads', async () => {
    const response = await server.get('/ai-agents', await write('a'));
    expect(response.statusCode).toBe(200);
    const { items } = response.json() as { items: AgentView[] };
    const ada = items.find((a) => a.id === agentId);
    expect(ada).toMatchObject({
      name: 'Ada',
      tone: 'friendly',
      languages: ['en'],
      answer_length: 'short',
    });
  });

  it('persists a persona edit and returns it, so the next read matches the reply', async () => {
    const patch = await server.patch(
      `/ai-agents/${agentId}`,
      {
        name: 'Nova',
        tone: 'professional',
        avatar_url: 'https://cdn.example/nova.png',
        languages: ['en', 'tr', 'de'],
        answer_length: 'long',
      },
      await write('a'),
    );
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as AgentView;
    expect(patched).toMatchObject({
      name: 'Nova',
      tone: 'professional',
      avatar_url: 'https://cdn.example/nova.png',
      languages: ['en', 'tr', 'de'],
      answer_length: 'long',
    });

    // The reply is not a hand-assembled echo: a fresh read agrees with it.
    const after = (
      (await server.get('/ai-agents', await write('a'))).json() as { items: AgentView[] }
    ).items.find((a) => a.id === agentId);
    expect(after).toMatchObject({
      name: 'Nova',
      languages: ['en', 'tr', 'de'],
      answer_length: 'long',
    });
  });

  it('merges answer_length into the persona without dropping the signature', async () => {
    await server.patch(`/ai-agents/${agentId}`, { answer_length: 'medium' }, await write('a'));
    const stored = await owner.aiAgent.findUnique({
      where: { id: agentId },
      select: { persona: true },
    });
    // The unrelated key survives the merge.
    expect(stored?.persona).toMatchObject({ answerLength: 'medium', signature: '— Ada' });
  });

  it('clears answer_length with null but leaves the rest of the persona', async () => {
    await server.patch(`/ai-agents/${agentId}`, { answer_length: null }, await write('a'));
    const stored = await owner.aiAgent.findUnique({
      where: { id: agentId },
      select: { persona: true },
    });
    expect(stored?.persona).toMatchObject({ signature: '— Ada' });
    expect((stored?.persona as Record<string, unknown>)['answerLength']).toBeUndefined();
  });

  it('rejects an empty name', async () => {
    const response = await server.patch(`/ai-agents/${agentId}`, { name: '  ' }, await write('a'));
    expect(response.statusCode).toBe(400);
  });

  it("never edits another tenant's agent — a 404, not a 403, so IDs stay opaque", async () => {
    const response = await server.patch(
      `/ai-agents/${agentId}`,
      { name: 'Hijacked' },
      await write('b'),
    );
    expect(response.statusCode).toBe(404);
    const unchanged = await owner.aiAgent.findUnique({
      where: { id: agentId },
      select: { name: true },
    });
    expect(unchanged?.name).toBe('Ada');
  });
});
