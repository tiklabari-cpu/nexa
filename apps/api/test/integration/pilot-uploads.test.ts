/**
 * The public pilot shares files (owner decision 2026-11-06, tm 418).
 *
 * An earlier plan for tm 418 switched chat attachments off under
 * `PILOT_MODE=true`; the owner rejected it, and the task became "keep the files"
 * instead: docker-compose.pilot.yml points STORAGE_LOCAL_DIR at a named volume
 * that the daily backup archives. This file holds the half of that decision a
 * compose file cannot: with the pilot flag set, nothing in the API refuses a
 * file. The switch reads on, an attachment goes through grant → signed PUT →
 * GET with the same bytes, a knowledge-base document is stored, and both land
 * under STORAGE_LOCAL_DIR — the directory the pilot mounts its volume on.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { storedObjectPath } from '../../src/services/storage/upload-url.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('PILOT_MODE=true keeps file sharing on (tm 418)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let storageDir: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  /** Where LocalStore keeps a key: one directory per licence (`storedObjectPath`). */
  const onDisk = (key: string): string => join(storageDir, ...storedObjectPath(key)!.split('/'));
  const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

  beforeAll(async () => {
    owner = ownerClient();
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-pilot-uploads-'));
    server = await startTestServer({
      PILOT_MODE: 'true',
      PILOT_CONTACT_EMAIL: 'pilot-contact@example.test',
      STORAGE_LOCAL_DIR: storageDir,
    });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents-bot--all:rw'],
    });
  });

  /** grant → signed PUT, as the composer and the knowledge editor do it. */
  async function upload(
    body: Buffer,
    contentType: string,
    purpose: 'attachment' | 'knowledge_document',
  ) {
    const granted = await server.post(
      '/uploads',
      { content_type: contentType, size_bytes: body.byteLength, purpose },
      auth(),
    );
    expect(granted.statusCode, granted.body).toBe(201);
    const put = await server.app.inject({
      method: 'PUT',
      url: granted.json().upload_url,
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(put.statusCode, put.body).toBe(201);
    return { grant: granted.json(), stored: put.json() };
  }

  it('reports the switch on, as on any other deployment', async () => {
    const response = await server.get('/uploads-policy', auth());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ file_sharing_enabled: true });
  });

  it('takes a chat attachment and serves the same bytes back from STORAGE_LOCAL_DIR', async () => {
    const { grant, stored } = await upload(PNG, 'image/png', 'attachment');
    expect(stored.checksum_sha256).toBe(sha256(PNG));

    const fetched = await server.get(grant.file_url.replace('/api/v1', ''), auth());
    expect(fetched.statusCode).toBe(200);
    expect(sha256(Buffer.from(fetched.rawPayload))).toBe(sha256(PNG));
    // Written where the pilot mounts its volume, not anywhere else.
    expect(sha256(readFileSync(onDisk(grant.upload_id)))).toBe(sha256(PNG));
  });

  it('stores a knowledge-base document there too', async () => {
    const { grant, stored } = await upload(PDF, 'application/pdf', 'knowledge_document');
    expect(stored.checksum_sha256).toBe(sha256(PDF));

    expect(sha256(readFileSync(onDisk(grant.upload_id)))).toBe(sha256(PDF));
  });
});
