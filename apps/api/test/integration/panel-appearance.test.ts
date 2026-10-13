/**
 * Panel font presets (owner, 2026-10-13), against the real database:
 *
 *   - `PUT /settings/appearance` is the owner's alone — admin and vice-owner
 *     are refused — and another workspace's members neither see nor touch it.
 *   - A member's own `font_preset` is written and read through
 *     `/agents/me/ui-preferences`, stamped with when it was chosen.
 *   - `GET /auth/me` says which one applies, and the later choice wins —
 *     ordered here with explicit timestamps, not by test timing.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('panel font presets', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerToken: string;
  let agentToken: string;
  let otherOwnerToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const SETTINGS = '/settings/appearance';
  const PREFS = '/agents/me/ui-preferences';
  const OWNER_SCOPES = ['organization--my:rw', 'agents--my:rw'];

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
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: OWNER_SCOPES,
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
    otherOwnerToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: OWNER_SCOPES,
    });
  });

  /** The agent of workspace A, promoted, holding the scope the write asks for. */
  async function promotedAgentToken(role: 'admin' | 'viceowner'): Promise<string> {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { role },
    });
    return grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: OWNER_SCOPES,
    });
  }

  describe('the workspace default', () => {
    it('reads as no default until the owner sets one, for every member', async () => {
      const res = await server.get(SETTINGS, auth(agentToken));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ font_preset: null, font_preset_set_at: null });
    });

    it('is set by the owner, stamped, audited, and readable by an agent', async () => {
      const before = Date.now();
      const res = await server.put(SETTINGS, { font_preset: 'figtree' }, auth(ownerToken));
      expect(res.statusCode).toBe(200);
      const body = res.json() as { font_preset: string; font_preset_set_at: string };
      expect(body.font_preset).toBe('figtree');
      expect(Date.parse(body.font_preset_set_at)).toBeGreaterThanOrEqual(before - 1000);

      expect((await server.get(SETTINGS, auth(agentToken))).json()).toEqual(body);
      const audit = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'settings.appearance_updated' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ font_preset: 'figtree' });
    });

    it('is removed with null, time and all', async () => {
      await server.put(SETTINGS, { font_preset: 'nunito' }, auth(ownerToken));
      const res = await server.put(SETTINGS, { font_preset: null }, auth(ownerToken));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ font_preset: null, font_preset_set_at: null });
    });

    it.each(['admin', 'viceowner'] as const)('refuses a %s', async (role) => {
      const token = await promotedAgentToken(role);
      const res = await server.put(SETTINGS, { font_preset: 'figtree' }, auth(token));
      expect(res.statusCode).toBe(403);
      expect((await server.get(SETTINGS, auth(token))).json()).toEqual({
        font_preset: null,
        font_preset_set_at: null,
      });
    });

    it('refuses a plain agent', async () => {
      const res = await server.put(SETTINGS, { font_preset: 'figtree' }, auth(agentToken));
      expect(res.statusCode).toBe(403);
    });

    it('refuses an unknown preset, a missing field and an extra key', async () => {
      for (const body of [{}, { font_preset: 'comic-sans' }, { font_preset: 'inter', x: 1 }]) {
        const res = await server.put(SETTINGS, body, auth(ownerToken));
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('stays inside its workspace: another owner neither sees nor changes it', async () => {
      await server.put(SETTINGS, { font_preset: 'figtree' }, auth(ownerToken));
      expect((await server.get(SETTINGS, auth(otherOwnerToken))).json()).toEqual({
        font_preset: null,
        font_preset_set_at: null,
      });
      await server.put(SETTINGS, { font_preset: 'nunito' }, auth(otherOwnerToken));
      const mine = (await server.get(SETTINGS, auth(agentToken))).json() as {
        font_preset: string;
      };
      expect(mine.font_preset).toBe('figtree');
    });

    it('is held to the catalogue by the database too', async () => {
      await expect(
        owner.workspaceAppearanceSettings.create({
          data: {
            licenseId: fx.a.licenseId,
            fontPreset: 'comic-sans',
            fontPresetSetAt: new Date(),
          },
        }),
      ).rejects.toThrow(/font_preset_check/);
      await expect(
        owner.workspaceAppearanceSettings.create({
          data: { licenseId: fx.a.licenseId, fontPreset: 'figtree', fontPresetSetAt: null },
        }),
      ).rejects.toThrow(/font_preset_set_at_check/);
    });
  });

  describe("a member's own choice", () => {
    it('is written, stamped and read back; null clears it and its time', async () => {
      const res = await server.put(PREFS, { font_preset: 'nunito' }, auth(agentToken));
      expect(res.statusCode).toBe(200);
      const body = res.json() as { font_preset: string; font_preset_set_at: string | null };
      expect(body.font_preset).toBe('nunito');
      expect(body.font_preset_set_at).not.toBeNull();
      expect((await server.get(PREFS, auth(agentToken))).json()).toEqual(body);

      const cleared = await server.put(PREFS, { font_preset: null }, auth(agentToken));
      expect(cleared.json()).toMatchObject({ font_preset: null, font_preset_set_at: null });
    });

    it('leaves the pin alone, and the pin leaves it alone', async () => {
      await server.put(PREFS, { font_preset: 'figtree' }, auth(agentToken));
      const res = await server.put(PREFS, { settings_nav_pinned: false }, auth(agentToken));
      expect(res.json()).toMatchObject({ settings_nav_pinned: false, font_preset: 'figtree' });
    });

    it('refuses a preset the catalogue does not have', async () => {
      const res = await server.put(PREFS, { font_preset: 'comic-sans' }, auth(agentToken));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /auth/me appearance — the later choice wins', () => {
    const T1 = new Date('2026-10-12T09:00:00.000Z');
    const T2 = new Date('2026-10-12T10:00:00.000Z');
    const T3 = new Date('2026-10-12T11:00:00.000Z');

    async function setWorkspace(preset: string | null, at: Date | null): Promise<void> {
      await owner.workspaceAppearanceSettings.upsert({
        where: { licenseId: fx.a.licenseId },
        create: { licenseId: fx.a.licenseId, fontPreset: preset, fontPresetSetAt: at },
        update: { fontPreset: preset, fontPresetSetAt: at },
      });
    }
    async function setMember(preset: string | null, at: Date | null): Promise<void> {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { fontPreset: preset, fontPresetSetAt: at },
      });
    }
    async function appearance(): Promise<Record<string, unknown>> {
      const res = await server.get('/auth/me', auth(agentToken));
      expect(res.statusCode).toBe(200);
      return (res.json() as { appearance: Record<string, unknown> }).appearance;
    }

    it('is the built-in Inter with nothing chosen', async () => {
      expect(await appearance()).toEqual({
        effective_font_preset: 'inter',
        source: 'builtin',
        workspace_font_preset: null,
        workspace_font_preset_set_at: null,
        user_font_preset: null,
        user_font_preset_set_at: null,
      });
    });

    it('owner T1 Figtree, member T2 Nunito, owner T3 Manrope, member clears', async () => {
      await setWorkspace('figtree', T1);
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'figtree',
        source: 'workspace',
      });

      await setMember('nunito', T2);
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'nunito',
        source: 'user',
        workspace_font_preset: 'figtree',
        user_font_preset_set_at: T2.toISOString(),
      });

      // The member's older choice is kept, only outranked.
      await setWorkspace('manrope-dm-sans', T3);
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'manrope-dm-sans',
        source: 'workspace',
        user_font_preset: 'nunito',
      });

      await setMember(null, null);
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'manrope-dm-sans',
        source: 'workspace',
        user_font_preset: null,
      });

      await setWorkspace(null, null);
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'inter',
        source: 'builtin',
      });
    });

    it('the endpoints stamp "now", so a choice made after the default wins', async () => {
      await setWorkspace('figtree', T1);
      await server.put(PREFS, { font_preset: 'nunito' }, auth(agentToken));
      expect(await appearance()).toMatchObject({ effective_font_preset: 'nunito', source: 'user' });

      await server.put(SETTINGS, { font_preset: 'manrope-dm-sans' }, auth(ownerToken));
      expect(await appearance()).toMatchObject({
        effective_font_preset: 'manrope-dm-sans',
        source: 'workspace',
      });
    });
  });
});
