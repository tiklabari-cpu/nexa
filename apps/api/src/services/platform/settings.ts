/**
 * The root panel's deployment settings (tm 389.13 · FR-ADMIN-15/16 · design.md
 * §B2, §C settings).
 *
 * Four `platform_settings` rows the tenant API reads through
 * `platform_public_settings()` — `signup_enabled`, `trial_days`,
 * `announcement`, `maintenance` — and the tenant API's published effective
 * configuration, read from Redis. A key with no row is "not set here": the
 * tenant API keeps its environment value (`public-settings.ts`), so removing
 * a row is how an operator hands a setting back to the environment.
 *
 * Writes bump the row's `version` and stamp the operator; the caller records
 * the audit entry and, after the commit, announces the change
 * ({@link announceSettingsChanged}) so every tenant process drops its cached
 * copy at once. Maintenance mode is also written where the realtime gateway
 * reads it (`OPS_MAINTENANCE_KEY`) — the gateway has no database read of its
 * own for it, and the tenant API's leader re-writes the key from this row
 * every 30 seconds should Redis lose it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  OPS_CONFIG_KEY,
  OPS_MAINTENANCE_KEY,
  PLATFORM_OPS_CHANNEL,
  PLATFORM_SETTINGS_CHANGED,
  type AnnouncementLevel,
  type LocalizedNoticeText,
  type MaintenanceMode,
} from '@siyahtus/types';
import type { EffectiveConfigEntry, StoredEffectiveConfig } from '../ops/effective-config.js';
import { OPS_CONFIG_TTL_S } from '../ops/effective-config.js';

export const DEPLOYMENT_SETTING_KEYS = [
  'signup_enabled',
  'trial_days',
  'announcement',
  'maintenance',
] as const;
export type DeploymentSettingKey = (typeof DEPLOYMENT_SETTING_KEYS)[number];

export interface PlatformAnnouncement extends LocalizedNoticeText {
  level: AnnouncementLevel;
  until: string | null;
}

export interface PlatformMaintenance {
  enabled: boolean;
  mode: MaintenanceMode;
  message: LocalizedNoticeText | null;
}

export interface PlatformDeploymentSettings {
  signup_enabled: boolean | null;
  trial_days: number | null;
  announcement: PlatformAnnouncement | null;
  maintenance: PlatformMaintenance | null;
  updated_at: string | null;
}

/** `PATCH /settings`: a present key changes, `null` removes the row. */
export interface DeploymentSettingsPatch {
  signup_enabled?: boolean | null;
  trial_days?: number | null;
  announcement?: PlatformAnnouncement | null;
}

export interface PlatformEffectiveConfig {
  stale: boolean;
  generated_at: string | null;
  age_s: number | null;
  entries: EffectiveConfigEntry[];
}

/** A write's outcome: the settings after it, what changed, and what they were. */
export interface SettingsChange<C> {
  settings: PlatformDeploymentSettings;
  changed: C;
  before: PlatformDeploymentSettings;
}

/** Writes the audit entry in the write's own transaction — only when something changed. */
export type RecordChange<C> = (
  tx: Prisma.TransactionClient,
  outcome: SettingsChange<C>,
) => Promise<void>;

type Row = { key: string; value: Prisma.JsonValue; updatedAt: Date };

function asObject(value: Prisma.JsonValue | undefined): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): LocalizedNoticeText | null {
  const record = asObject(value as Prisma.JsonValue);
  if (!record) return null;
  return typeof record['en'] === 'string' && typeof record['tr'] === 'string'
    ? { en: record['en'], tr: record['tr'] }
    : null;
}

/** The stored rows as the contract shows them; a row of the wrong shape reads as unset. */
export function settingsFromRows(rows: readonly Row[]): PlatformDeploymentSettings {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const signup = byKey.get('signup_enabled')?.value;
  const trial = byKey.get('trial_days')?.value;
  const announcement = asObject(byKey.get('announcement')?.value);
  const maintenance = asObject(byKey.get('maintenance')?.value);
  const words = announcement ? asText(announcement) : null;
  const newest = rows
    .filter((row) => (DEPLOYMENT_SETTING_KEYS as readonly string[]).includes(row.key))
    .reduce<Date | null>(
      (latest, row) => (latest && latest > row.updatedAt ? latest : row.updatedAt),
      null,
    );
  return {
    signup_enabled: typeof signup === 'boolean' ? signup : null,
    trial_days: typeof trial === 'number' && trial >= 1 ? trial : null,
    announcement:
      announcement && words
        ? {
            level: announcement['level'] as AnnouncementLevel,
            en: words.en,
            tr: words.tr,
            until: typeof announcement['until'] === 'string' ? announcement['until'] : null,
          }
        : null,
    maintenance: maintenance
      ? {
          enabled: maintenance['enabled'] === true,
          mode: maintenance['mode'] === 'full' ? 'full' : 'read_only',
          message: asText(maintenance['message']),
        }
      : null,
    updated_at: newest ? newest.toISOString() : null,
  };
}

/** Tell every tenant process its copy of the settings is stale. After the commit. */
export async function announceSettingsChanged(
  redis: Pick<Redis, 'publish'>,
  keys: readonly string[],
): Promise<void> {
  await redis.publish(
    PLATFORM_OPS_CHANNEL,
    JSON.stringify({ type: PLATFORM_SETTINGS_CHANGED, keys }),
  );
}

export class PlatformSettingsStore {
  readonly #db: PrismaClient;
  readonly #redis: Redis;
  readonly #now: () => number;

  constructor(db: PrismaClient, redis: Redis, options: { now?: () => number } = {}) {
    this.#db = db;
    this.#redis = redis;
    this.#now = options.now ?? Date.now;
  }

  async read(
    client: Pick<PrismaClient, 'platformSetting'> = this.#db,
  ): Promise<PlatformDeploymentSettings> {
    const rows = await client.platformSetting.findMany({
      where: { key: { in: [...DEPLOYMENT_SETTING_KEYS] } },
      select: { key: true, value: true, updatedAt: true },
    });
    return settingsFromRows(rows);
  }

  /**
   * Apply `patch` in one transaction and return the settings after it, with
   * the keys that actually changed — a value equal to the stored one, or a
   * removal of a row that is not there, is not a change, and nothing changed
   * records nothing.
   */
  async patch(
    patch: DeploymentSettingsPatch,
    adminId: string,
    record: RecordChange<DeploymentSettingKey[]>,
  ): Promise<SettingsChange<DeploymentSettingKey[]>> {
    return this.#db.$transaction(async (tx) => {
      // The four rows are few and rarely written: one lock over the set keeps
      // two operators' saves from interleaving their before/after.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings.deployment'))`;
      const before = await this.read(tx);
      const changed: DeploymentSettingKey[] = [];
      for (const key of ['signup_enabled', 'trial_days', 'announcement'] as const) {
        if (!(key in patch)) continue;
        const next = patch[key];
        if (sameValue(before[key], next ?? null)) continue;
        changed.push(key);
        await this.#write(tx, key, next ?? null, adminId);
      }
      if (changed.length === 0) return { settings: before, changed, before };
      const outcome = { settings: await this.read(tx), changed, before };
      await record(tx, outcome);
      return outcome;
    });
  }

  /** Maintenance mode on or off; `changed` false when it already read so. */
  async setMaintenance(
    next: PlatformMaintenance,
    adminId: string,
    record: RecordChange<boolean>,
  ): Promise<SettingsChange<boolean>> {
    return this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings.deployment'))`;
      const before = await this.read(tx);
      if (sameValue(before.maintenance, next)) return { settings: before, changed: false, before };
      await this.#write(tx, 'maintenance', next, adminId);
      const outcome = { settings: await this.read(tx), changed: true, before };
      await record(tx, outcome);
      return outcome;
    });
  }

  /**
   * Where the realtime gateway reads maintenance mode. Best effort: the tenant
   * API's leader re-writes it from the row within 30 seconds anyway.
   */
  async writeMaintenanceKey(maintenance: PlatformMaintenance | null): Promise<void> {
    if (maintenance?.enabled) {
      await this.#redis.set(OPS_MAINTENANCE_KEY, JSON.stringify({ mode: maintenance.mode }));
    } else {
      await this.#redis.del(OPS_MAINTENANCE_KEY);
    }
  }

  /**
   * The tenant API's published configuration. No publication, or one that
   * cannot be read, is `stale: true` with no entries — still a 200, like the
   * health view.
   */
  async effectiveConfig(): Promise<PlatformEffectiveConfig> {
    const raw = await this.#redis.get(OPS_CONFIG_KEY).catch(() => null);
    const stored = parseStoredConfig(raw);
    if (stored === null) return { stale: true, generated_at: null, age_s: null, entries: [] };
    const ageS = Math.max(
      0,
      Math.round((this.#now() - Date.parse(stored.generated_at)) / 100) / 10,
    );
    return {
      stale: ageS > OPS_CONFIG_TTL_S,
      generated_at: stored.generated_at,
      age_s: ageS,
      entries: stored.entries,
    };
  }

  async #write(
    tx: Prisma.TransactionClient,
    key: DeploymentSettingKey,
    value: unknown,
    adminId: string,
  ): Promise<void> {
    if (value === null) {
      await tx.platformSetting.deleteMany({ where: { key } });
      return;
    }
    const json = value as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({
      where: { key },
      create: { key, value: json, updatedBy: adminId },
      update: { value: json, updatedBy: adminId, version: { increment: 1 } },
    });
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function parseStoredConfig(raw: string | null): StoredEffectiveConfig | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredEffectiveConfig>;
    if (typeof value.generated_at !== 'string' || Number.isNaN(Date.parse(value.generated_at))) {
      return null;
    }
    if (!Array.isArray(value.entries)) return null;
    return value as StoredEffectiveConfig;
  } catch {
    return null;
  }
}
