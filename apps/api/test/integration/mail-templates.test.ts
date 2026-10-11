/**
 * The mail templates, through the real routes (tm 265).
 *
 * What the unit tests cannot see: that a request carrying the panel's language
 * gets its mail in that language, that the panel's language is remembered on
 * the membership for mail sent later, and that what leaves carries both halves
 * — the text every client shows and the HTML the shared frame draws.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('mail in the reader’s language (tm 265 · NFR-I18N2)', () => {
  let owner: PrismaClient;
  let dir: string;
  let mailer: FileMailer;
  let server: TestServer;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    dir = await mkdtemp(join(tmpdir(), 'siyahtus-mail-templates-'));
    mailer = new FileMailer(dir);
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(dir, { recursive: true, force: true });
  });

  async function resetMailFor(headers: Record<string, string>) {
    await server.post('/auth/password-reset', { email: fx.a.ownerEmail }, headers);
    await server.app.backgroundMail.settled();
    const outbox = await mailer.outbox();
    expect(outbox).toHaveLength(1);
    return outbox[0]!;
  }

  it('writes the reset mail in the language the panel was showing', async () => {
    const mail = await resetMailFor({ 'x-siyahtus-locale': 'tr', 'accept-language': 'en-US' });
    expect(mail.subject).toBe('SiyahTuş şifrenizi sıfırlayın');
    expect(mail.locale).toBe('tr');
    expect(mail.body).toContain('Yeni şifre belirle');
    expect(mail.body).toMatch(/\/reset-password\?token=\S+\n/);
    expect(mail.html).toContain('<html lang="tr"');
    expect(mail.html).toContain('Yeni şifre belirle');
  });

  it('falls back to the browser, then English', async () => {
    expect((await resetMailFor({ 'accept-language': 'tr-TR,tr;q=0.9' })).subject).toBe(
      'SiyahTuş şifrenizi sıfırlayın',
    );
    await rm(dir, { recursive: true, force: true });
    await clearRateLimits(server.app);
    const english = await resetMailFor({});
    expect(english.subject).toBe('Reset your SiyahTuş password');
    expect(english.html).toContain('Choose a new password');
  });

  it('remembers the panel language on the membership, and only writes when it changes', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--my:ro'],
    });
    const membership = () =>
      owner.agentMembership.findUniqueOrThrow({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
        select: { locale: true },
      });
    expect((await membership()).locale).toBeNull();

    const me = (locale?: string) =>
      server.get('/auth/me', {
        authorization: `Bearer ${token}`,
        ...(locale ? { 'x-siyahtus-locale': locale } : {}),
      });
    expect((await me('tr')).statusCode).toBe(200);
    expect((await membership()).locale).toBe('tr');
    // No header, or one naming a language the mail is not written in: kept.
    await me();
    await me('de');
    expect((await membership()).locale).toBe('tr');
    await me('en');
    expect((await membership()).locale).toBe('en');
  });

  it('names who invites, and to what, in the inviter’s language', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
    const response = await server.post(
      '/invitations',
      { emails: ['new.colleague@example.test'], role: 'agent' },
      { authorization: `Bearer ${token}`, 'x-siyahtus-locale': 'tr' },
    );
    expect(response.statusCode).toBe(201);
    const [mail] = await mailer.outbox();
    const organization = await owner.organization.findUniqueOrThrow({
      where: { id: fx.a.organizationId },
      select: { name: true },
    });
    const inviter = await owner.account.findUniqueOrThrow({
      where: { id: fx.a.ownerAccountId },
      select: { name: true },
    });
    expect(mail!.subject).toBe(
      `${inviter.name} sizi SiyahTuş'ta ${organization.name} ekibine davet etti`,
    );
    expect(mail!.body).toMatch(/\/join\?token=\S+\n/);
    expect(mail!.html).toContain('Daveti kabul et');
  });
});
