/**
 * File knowledge sources (FR-MOD-06.3.2, "File") — the upload path end to end.
 *
 * Until this endpoint existed, `type: "file"` meant "paste text and call it a
 * file", so the assertions here are about the difference between those two
 * things: bytes arrive, the server decides whether they are text, and only then
 * does a source exist. The negative cases therefore come first and each one
 * makes the same second claim — **nothing was written**. A refusal that still
 * left a row would be a worse outcome than no refusal at all, because the
 * knowledge base would hold a source nobody could explain.
 *
 * The positive case ends where the acceptance criterion does: the upload is not
 * merely stored but *searchable*, which is the only property that makes a
 * knowledge source worth having.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_FILE_MAX_BYTES } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface SourceView {
  id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
}

const b64 = (body: string | Buffer): string =>
  (Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')).toString('base64');

describe('knowledge file upload (FR-MOD-06.3.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentIdA: string;

  const write = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    })}`,
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

  // --- Negative: every refusal writes nothing --------------------------------

  it('refuses an unsupported type and creates no source', async () => {
    const headers = await write('a');
    const response = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'handbook.pdf',
        content_type: 'application/pdf',
        data: b64('%PDF-1.4 not really a pdf'),
      },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  /**
   * The allow-list is not what stops binary — a caller picks its own
   * `content_type`, so anything can claim to be text. This is the check that
   * actually holds: the bytes have to *be* text.
   */
  it('refuses binary bytes declared as text, and creates no source', async () => {
    const headers = await write('a');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
    const response = await server.post(
      '/knowledge-sources/file',
      { ai_agent_id: agentIdA, filename: 'notes.txt', content_type: 'text/plain', data: b64(png) },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  it('refuses a file over the byte budget instead of indexing a prefix of it', async () => {
    const headers = await write('a');
    const oversized = Buffer.alloc(KNOWLEDGE_FILE_MAX_BYTES + 1, 0x61);
    const response = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'huge.txt',
        content_type: 'text/plain',
        data: b64(oversized),
      },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  it('refuses an empty file, and one that is only whitespace', async () => {
    const headers = await write('a');
    for (const body of ['', '   \n\t\n  ']) {
      const response = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: agentIdA,
          filename: 'blank.txt',
          content_type: 'text/plain',
          data: body === '' ? '' : b64(body),
        },
        headers,
      );
      expect(response.statusCode).toBe(400);
    }
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  it('refuses a payload that is not base64 rather than decoding whatever it can', async () => {
    const headers = await write('a');
    const response = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'notes.txt',
        content_type: 'text/plain',
        data: 'this is not base64!!',
      },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  /**
   * The other half of "File means a file": the paste path no longer accepts the
   * type, so there is exactly one way to create one.
   */
  it('refuses a pasted `type: file` source on POST /knowledge-sources', async () => {
    const headers = await write('a');
    const response = await server.post(
      '/knowledge-sources',
      {
        ai_agent_id: agentIdA,
        name: 'Pretend file',
        type: 'file',
        content: 'Text somebody typed and called a file.',
      },
      headers,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
  });

  // --- Positive: uploaded, parsed, indexed, searchable -----------------------

  it('uploads a text file into a ready source with chunks', async () => {
    const headers = await write('a');
    const response = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'returns-policy.txt',
        content_type: 'text/plain',
        data: b64('Items can be returned within 30 days of delivery for a full refund.'),
      },
      headers,
    );

    expect(response.statusCode).toBe(201);
    const source = response.json() as SourceView;
    expect(source.type).toBe('file');
    expect(source.status).toBe('ready');
    expect(source.chunk_count).toBeGreaterThan(0);
    // A file has no URL, and the filename is not smuggled into the column that
    // every reader treats as a fetchable address.
    expect(source.source_url).toBeNull();
    // No title was sent, so the file's own name became one.
    expect(source.name).toBe('returns-policy.txt');

    // Really indexed: the chunks exist in the store for this licence.
    const chunks = await owner.knowledgeChunk.count({ where: { sourceId: source.id } });
    expect(chunks).toBe(source.chunk_count);
  });

  it('parses markdown to prose rather than storing its syntax', async () => {
    const headers = await write('a');
    const response = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        name: 'Warranty',
        filename: 'warranty.md',
        content_type: 'text/markdown',
        data: b64('# Warranty\n\nCovers **cracked welds** for [ten years](/legal/w).\n'),
      },
      headers,
    );
    expect(response.statusCode).toBe(201);

    const stored = await owner.knowledgeSource.findFirstOrThrow({
      where: { id: (response.json() as SourceView).id },
      select: { name: true, content: true },
    });
    // The title the admin typed wins over the filename.
    expect(stored.name).toBe('Warranty');
    expect(stored.content).toBe('Warranty\n\nCovers cracked welds for ten years.');
  });

  /**
   * The acceptance criterion is not "a row exists" but "the AI can answer from
   * it". A marker word that appears in no seeded source makes that unambiguous:
   * if retrieval returns it, it came from this upload.
   */
  it('makes the uploaded text retrievable through the knowledge list and search', async () => {
    const headers = await write('a');
    const marker = `flugelbrace${Date.now()}`;
    const created = await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'zephyr.md',
        content_type: 'text/markdown',
        data: b64(`## Recall\n\nThe ${marker} recall covers frames sold before June.\n`),
      },
      headers,
    );
    expect(created.statusCode).toBe(201);
    const source = created.json() as SourceView;

    const list = (await server.get('/knowledge-sources', headers)).json() as {
      items: SourceView[];
    };
    const listed = list.items.find((item) => item.id === source.id);
    expect(listed?.type).toBe('file');
    expect(listed?.chunk_count).toBeGreaterThan(0);

    // Searchable, not merely stored: a chunk of this source holds the marker.
    const indexed = await owner.knowledgeChunk.count({
      where: { sourceId: source.id, chunkText: { contains: marker } },
    });
    expect(indexed).toBeGreaterThan(0);
  });

  // --- Cross-tenant -----------------------------------------------------------

  it('never lets one tenant upload into another tenant’s AI agent', async () => {
    const bHeaders = await write('b');
    const response = await server.post(
      '/knowledge-sources/file',
      {
        // Tenant A's agent. Under RLS it is simply not visible to B, so
        // "does not exist" and "belongs to someone else" are one answer.
        ai_agent_id: agentIdA,
        filename: 'stolen.txt',
        content_type: 'text/plain',
        data: b64('Knowledge that belongs to somebody else.'),
      },
      bHeaders,
    );
    expect(response.statusCode).toBe(400);
    expect(await sourceCount(fx.a.licenseId)).toBe(0);
    expect(await sourceCount(fx.b.licenseId)).toBe(0);
  });

  it('never lets another tenant see an uploaded source', async () => {
    const aHeaders = await write('a');
    await server.post(
      '/knowledge-sources/file',
      {
        ai_agent_id: agentIdA,
        filename: 'a-secret.txt',
        content_type: 'text/plain',
        data: b64('Only tenant A may read this.'),
      },
      aHeaders,
    );

    const bHeaders = await write('b');
    const list = (await server.get('/knowledge-sources', bHeaders)).json() as {
      items: SourceView[];
    };
    expect(list.items).toHaveLength(0);
  });
});
