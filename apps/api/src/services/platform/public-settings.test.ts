/**
 * The root panel's settings as the tenant API applies them (tm 389.13 · FR-ADMIN-15): the
 * stricter sign-up switch wins, a trial length out of bounds is ignored, an announcement or a
 * maintenance row this process cannot show is no announcement, the cache holds for its lifetime
 * and drops on `settings.changed`, and an unreadable database is the environment — never a
 * failure. The database half is `test/integration/platform-settings.test.ts`.
 */
import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { PLATFORM_OPS_CHANNEL } from '@siyahtus/types';
import { describe, expect, it, vi } from 'vitest';
import {
  activeAnnouncement,
  listenForPlatformSettingsChanges,
  parseAnnouncement,
  parseMaintenance,
  PublicSettings,
  resolvePublicSettings,
  type PublicSettingsEnv,
  type StoredPublicSettings,
} from './public-settings.js';

const OPEN_ENV: PublicSettingsEnv = {
  SIGNUP_ENABLED: true,
  TRIAL_DAYS: 14,
  explicitKeys: [],
};
const CLOSED_ENV: PublicSettingsEnv = {
  SIGNUP_ENABLED: false,
  TRIAL_DAYS: 14,
  explicitKeys: ['SIGNUP_ENABLED'],
};

function stored(values: Partial<StoredPublicSettings> = {}): StoredPublicSettings {
  return {
    signup_enabled: null,
    trial_days: null,
    announcement: null,
    maintenance: null,
    ...values,
  };
}

describe('the sign-up switch — the stricter of the two wins', () => {
  it('follows the environment when the panel sets nothing', () => {
    expect(resolvePublicSettings(stored(), OPEN_ENV)).toMatchObject({
      signupEnabled: true,
      signupEnabledSource: 'default',
    });
    expect(resolvePublicSettings(stored(), CLOSED_ENV)).toMatchObject({
      signupEnabled: false,
      signupEnabledSource: 'env',
    });
  });

  it('lets the panel close an open environment', () => {
    expect(resolvePublicSettings(stored({ signup_enabled: false }), OPEN_ENV)).toMatchObject({
      signupEnabled: false,
      signupEnabledSource: 'db',
    });
  });

  it('never lets the panel open what SIGNUP_ENABLED=false closed', () => {
    expect(resolvePublicSettings(stored({ signup_enabled: true }), CLOSED_ENV)).toMatchObject({
      signupEnabled: false,
      signupEnabledSource: 'env',
    });
  });

  it('runs on the environment alone when nothing could be read', () => {
    expect(resolvePublicSettings(null, CLOSED_ENV)).toMatchObject({
      signupEnabled: false,
      trialDays: 14,
      announcement: null,
      maintenance: null,
    });
  });
});

describe('the trial length', () => {
  it('takes the panel’s value over TRIAL_DAYS', () => {
    expect(resolvePublicSettings(stored({ trial_days: 7 }), OPEN_ENV)).toMatchObject({
      trialDays: 7,
      trialDaysSource: 'db',
    });
  });

  it.each([0, -3, 1.5, 4000])('ignores %s and keeps the environment’s', (days) => {
    expect(resolvePublicSettings(stored({ trial_days: days }), OPEN_ENV)).toMatchObject({
      trialDays: 14,
      trialDaysSource: 'default',
    });
  });
});

describe('the announcement and maintenance rows', () => {
  const words = { en: 'Hello', tr: 'Merhaba' };

  it('reads a complete announcement, normalising its end time', () => {
    expect(
      parseAnnouncement({ level: 'warning', ...words, until: '2026-11-01T10:00:00+03:00' }),
    ).toEqual({ level: 'warning', ...words, until: '2026-11-01T07:00:00.000Z' });
  });

  it.each([
    ['one language', { level: 'info', en: 'Hello', until: null }],
    ['an empty text', { level: 'info', en: ' ', tr: 'Merhaba', until: null }],
    ['an unknown level', { level: 'loud', ...words, until: null }],
    ['an unreadable end', { level: 'info', ...words, until: 'soon' }],
    ['not an object', 'hello'],
  ])('shows nothing for %s', (_label, value) => {
    expect(parseAnnouncement(value)).toBeNull();
  });

  it('stops showing an announcement once its end time has passed', () => {
    const announcement = { level: 'info' as const, ...words, until: '2026-11-01T10:00:00.000Z' };
    expect(activeAnnouncement(announcement, Date.parse('2026-11-01T09:59:59Z'))).toBe(announcement);
    expect(activeAnnouncement(announcement, Date.parse('2026-11-01T10:00:00Z'))).toBeNull();
    expect(activeAnnouncement({ ...announcement, until: null }, Date.now())).not.toBeNull();
  });

  it('reads maintenance only while it is on, and a half-written message as none', () => {
    expect(parseMaintenance({ enabled: true, mode: 'full', message: words })).toEqual({
      mode: 'full',
      message: words,
    });
    expect(parseMaintenance({ enabled: true, mode: 'read_only', message: { en: 'x' } })).toEqual({
      mode: 'read_only',
      message: null,
    });
    expect(parseMaintenance({ enabled: false, mode: 'full' })).toBeNull();
    expect(parseMaintenance({ enabled: true, mode: 'half' })).toBeNull();
  });
});

function logger(): FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() } as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> };
}

describe('the cache', () => {
  function fakeDb(rows: () => StoredPublicSettings[]) {
    const queryRaw = vi.fn(async () => rows());
    return { db: { $queryRaw: queryRaw } as unknown as PrismaClient, queryRaw };
  }

  it('asks the database once per lifetime and again after it', async () => {
    let now = 0;
    const { db, queryRaw } = fakeDb(() => [stored({ trial_days: 7 })]);
    const settings = new PublicSettings({ db, env: OPEN_ENV, logger: logger(), now: () => now });
    expect((await settings.get()).trialDays).toBe(7);
    now = 29_999;
    await settings.get();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    now = 30_000;
    await settings.get();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent callers', async () => {
    const { db, queryRaw } = fakeDb(() => [stored()]);
    const settings = new PublicSettings({ db, env: OPEN_ENV, logger: logger() });
    await Promise.all([settings.get(), settings.get(), settings.get()]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reads again at once after an invalidation', async () => {
    let row = stored({ signup_enabled: null });
    const { db } = fakeDb(() => [row]);
    const settings = new PublicSettings({ db, env: OPEN_ENV, logger: logger() });
    expect((await settings.get()).signupEnabled).toBe(true);
    row = stored({ signup_enabled: false });
    expect((await settings.get()).signupEnabled).toBe(true);
    settings.invalidate();
    expect((await settings.get()).signupEnabled).toBe(false);
  });

  it('does not cache a read that an invalidation overtook', async () => {
    let release: () => void = () => undefined;
    let first = true;
    const queryRaw = vi.fn(async () => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => (release = resolve));
        return [stored({ trial_days: 5 })];
      }
      return [stored({ trial_days: 9 })];
    });
    const settings = new PublicSettings({
      db: { $queryRaw: queryRaw } as unknown as PrismaClient,
      env: OPEN_ENV,
      logger: logger(),
    });
    const stale = settings.get();
    settings.invalidate();
    const fresh = settings.get();
    release();
    expect((await stale).trialDays).toBe(5);
    expect((await fresh).trialDays).toBe(9);
    expect((await settings.get()).trialDays).toBe(9);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('runs on the environment, with a warning, when the database cannot be read', async () => {
    const log = logger();
    const db = {
      $queryRaw: vi.fn(async () => {
        throw new Error('function platform_public_settings() does not exist');
      }),
    } as unknown as PrismaClient;
    const settings = new PublicSettings({ db, env: CLOSED_ENV, logger: log });
    await expect(settings.get()).resolves.toMatchObject({ signupEnabled: false, trialDays: 14 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'platform_settings.read_failed' }),
      expect.any(String),
    );
  });

  it('lets a sign-up through, logged, when the blocklist cannot be read', async () => {
    const log = logger();
    const db = {
      $queryRaw: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as unknown as PrismaClient;
    const settings = new PublicSettings({ db, env: OPEN_ENV, logger: log });
    await expect(settings.signupBlocked('a@b.example', '203.0.113.9')).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('answers the notice without an announcement whose end has passed', async () => {
    const { db } = fakeDb(() => [
      stored({
        announcement: { level: 'info', en: 'a', tr: 'b', until: '2026-01-01T00:00:00Z' },
        maintenance: { enabled: true, mode: 'read_only' },
      }),
    ]);
    const settings = new PublicSettings({
      db,
      env: OPEN_ENV,
      logger: logger(),
      now: () => Date.parse('2026-06-01T00:00:00Z'),
    });
    expect(await settings.notice()).toEqual({
      announcement: null,
      maintenance: { mode: 'read_only', message: null },
    });
  });
});

describe('settings.changed', () => {
  function subscriber() {
    const emitter = new EventEmitter() as EventEmitter & { subscribe: ReturnType<typeof vi.fn> };
    emitter.subscribe = vi.fn(async () => 1);
    return emitter;
  }

  it('drops the copy on settings.changed and on an unreadable message, not on other types', async () => {
    const sub = subscriber();
    const onChange = vi.fn();
    await listenForPlatformSettingsChanges(sub as unknown as Redis, onChange);
    expect(sub.subscribe).toHaveBeenCalledWith(PLATFORM_OPS_CHANNEL);

    sub.emit('message', PLATFORM_OPS_CHANNEL, JSON.stringify({ type: 'settings.changed' }));
    sub.emit('message', PLATFORM_OPS_CHANNEL, 'not json');
    sub.emit('message', PLATFORM_OPS_CHANNEL, JSON.stringify({ type: 'job.run' }));
    sub.emit('message', 'another.channel', JSON.stringify({ type: 'settings.changed' }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
