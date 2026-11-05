/**
 * The widget learns a workspace is read-only before the visitor types (tm 406).
 *
 * An expired trial makes the workspace read-only (ADR-10, `license-gate.ts`):
 * the visitor's message is refused with 402 `license_expired` like every other
 * write. The widget used to find that out only from the 402, after the visitor
 * had filled in the pre-chat form and written their message. `GET
 * /customer/chat` now says `read_only` on every poll, so the widget can show
 * that the conversation is paused instead of a form nobody can receive.
 *
 * Reads stay open — the mint and the poll answer 200 on a read-only workspace,
 * which is what lets the widget say anything at all — and the 402 itself is
 * unchanged.
 *
 * Derived pilot operations work (tur 2 test findings): no Ek A catalogue ID,
 * so no requirement tag.
 */
import { type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DAY = 86_400_000;

describe('GET /customer/chat read_only (tm 406)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    // The mint is a read as far as the gate is concerned: no principal yet.
    expect(response.statusCode).toBe(200);
    const minted = response.json() as { token: string };
    return { authorization: `Bearer ${minted.token}` };
  }

  async function readOnly(headers: Record<string, string>): Promise<unknown> {
    const response = await server.get('/customer/chat', headers);
    expect(response.statusCode).toBe(200);
    return (response.json() as { read_only?: unknown }).read_only;
  }

  const setLicense = (data: { status?: string; trialEndsAt?: Date | null }): Promise<unknown> =>
    owner.license.update({ where: { id: fx.a.licenseId }, data });

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
  });

  it('is false while the trial runs, and the visitor can write', async () => {
    await setLicense({ status: 'trialing', trialEndsAt: new Date(Date.now() + 9 * DAY) });
    const headers = await visitor();

    expect(await readOnly(headers)).toBe(false);
    const sent = await server.post('/customer/chat/events', { text: 'hello' }, headers);
    expect(sent.statusCode).toBe(201);
  });

  it('is true once the trial has ended, and agrees with the 402 the message then gets', async () => {
    await setLicense({ status: 'trialing', trialEndsAt: new Date(Date.now() - DAY) });
    const headers = await visitor();

    expect(await readOnly(headers)).toBe(true);
    const sent = await server.post('/customer/chat/events', { text: 'is anyone there?' }, headers);
    expect(sent.statusCode).toBe(402);
    expect(sent.json().error).toMatchObject({
      type: 'license_expired',
      details: { access: 'read_only' },
    });
    // Nothing was stored: the poll after the refusal still has no conversation.
    const after = (await server.get('/customer/chat', headers)).json() as { chat: unknown };
    expect(after.chat).toBeNull();
  });

  it('follows the licence on the next poll — no cache keeps an expired trial writable or a paid one paused', async () => {
    await setLicense({ status: 'trialing', trialEndsAt: new Date(Date.now() + DAY) });
    const headers = await visitor();
    expect(await readOnly(headers)).toBe(false);

    await setLicense({ trialEndsAt: new Date(Date.now() - DAY) });
    expect(await readOnly(headers)).toBe(true);

    await setLicense({ status: 'active', trialEndsAt: null });
    expect(await readOnly(headers)).toBe(false);
  });

  it('is true for a licence closed to read-only outside the trial (dunning ran out)', async () => {
    await setLicense({ status: 'read_only', trialEndsAt: null });
    expect(await readOnly(await visitor())).toBe(true);
  });
});
