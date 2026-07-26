/**
 * Website knowledge crawl (FR-MOD-06.3.2), and the SSRF boundary around it.
 *
 * Fetching a URL the admin supplies means the *server* makes a request from
 * inside the network — the exact shape of an SSRF hole. So the negative cases
 * come first and carry the weight: a private, loopback, link-local or non-http
 * target must be refused with a 4xx and never reach a fetcher, never create a
 * source. Only then the positive: a public URL crawls, parses and indexes to a
 * searchable source. Cross-tenant isolation closes it out.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface SourceView {
  id: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
}

describe('knowledge website crawl', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentIdA: string;

  const write = async (tenant: 'a' | 'b', aiAgentId: string) => ({
    headers: {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx[tenant].licenseId,
        organizationId: fx[tenant].organizationId,
        ownerId: fx[tenant].ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    },
    aiAgentId,
  });

  async function sourceCount(licenseId: bigint): Promise<number> {
    return owner.knowledgeSource.count({ where: { licenseId } });
  }

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
      data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    agentIdA = agent.id;
  });

  // --- Negative: the SSRF boundary (before any positive case) ----------------

  const BLOCKED = [
    ['loopback IP', 'http://127.0.0.1/'],
    ['loopback name', 'http://localhost/internal'],
    ['private 10/8', 'http://10.0.0.5/'],
    ['private 192.168', 'http://192.168.0.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a url', 'definitely not a url'],
  ] as const;

  for (const [label, url] of BLOCKED) {
    it(`refuses to crawl ${label} and creates nothing`, async () => {
      const { headers, aiAgentId } = await write('a', agentIdA);
      const response = await server.post(
        '/knowledge-sources',
        { ai_agent_id: aiAgentId, name: 'Docs', type: 'website', source_url: url },
        headers,
      );
      expect(response.statusCode).toBe(400);
      expect(await sourceCount(fx.a.licenseId)).toBe(0);
    });
  }

  it('rejects a website source with no URL', async () => {
    const { headers, aiAgentId } = await write('a', agentIdA);
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: aiAgentId, name: 'Docs', type: 'website' },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  // --- Positive: a public URL crawls and indexes ----------------------------

  it('crawls a public URL into a searchable source with chunks', async () => {
    const { headers, aiAgentId } = await write('a', agentIdA);
    const response = await server.post(
      '/knowledge-sources',
      {
        ai_agent_id: aiAgentId,
        name: 'Delivery help',
        type: 'website',
        source_url: 'https://help.example.com/delivery',
      },
      headers,
    );
    expect(response.statusCode).toBe(201);
    const source = response.json() as SourceView;
    expect(source.type).toBe('website');
    expect(source.status).toBe('ready');
    expect(source.chunk_count).toBeGreaterThan(0);
    expect(source.source_url).toBe('https://help.example.com/delivery');

    // Actually indexed: chunks exist in the store for this license.
    const chunks = await owner.knowledgeChunk.count({ where: { licenseId: fx.a.licenseId } });
    expect(chunks).toBe(source.chunk_count);
  });

  it('still accepts a pasted-content source of another type', async () => {
    const { headers, aiAgentId } = await write('a', agentIdA);
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: aiAgentId, name: 'FAQ', type: 'faq', content: 'We are open 9 to 5, Monday to Friday.' },
      headers,
    );
    expect(response.statusCode).toBe(201);
    expect((response.json() as SourceView).chunk_count).toBeGreaterThan(0);
  });

  // --- Cross-tenant ----------------------------------------------------------

  it("never lets another tenant see a crawled source", async () => {
    const a = await write('a', agentIdA);
    await server.post(
      '/knowledge-sources',
      { ai_agent_id: a.aiAgentId, name: 'A secret', type: 'website', source_url: 'https://a.example.com/' },
      a.headers,
    );

    // Tenant B lists its own knowledge — A's source must not appear.
    const bHeaders = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
    const list = (await server.get('/knowledge-sources', bHeaders)).json() as { items: SourceView[] };
    expect(list.items).toHaveLength(0);
  });
});
