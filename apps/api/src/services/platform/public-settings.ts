/**
 * The root panel's deployment settings, as the tenant API applies them (tm
 * 389.13 · FR-ADMIN-15 · design.md §B2).
 *
 * The operators' switches live in `platform_settings`, a table `siyahtus_app`
 * cannot read; `platform_public_settings()` (SECURITY DEFINER) hands this
 * process the four it needs — the sign-up switch, the trial length, the
 * announcement and maintenance mode. A key nobody set is NULL, and then the
 * environment decides, exactly as before the root panel existed.
 *
 * - **Cached for 30 seconds**, per process, and dropped at once when the root
 *   panel announces a change on `siyahtus:platform:ops` (`settings.changed`,
 *   {@link listenForPlatformSettingsChanges}). The announcement is a shortcut:
 *   a process that missed it is right again within the cache's lifetime.
 * - **Never a reason not to serve** (the owner's rule of 2026-10-10). A read
 *   that fails — the function missing on an old database, Postgres away — logs
 *   a warning and runs on the environment, as if nothing were set.
 * - **The stricter of the two wins** for sign-up: the panel can close what
 *   `SIGNUP_ENABLED=true` opened, but `true` in the panel cannot open what
 *   `SIGNUP_ENABLED=false` closed — an operator who closed the door in the
 *   environment (the pilot's own rules sit there, env.ts) is not overruled by
 *   a row.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  ANNOUNCEMENT_LEVELS,
  MAINTENANCE_MODES,
  PLATFORM_OPS_CHANNEL,
  PLATFORM_SETTINGS_CHANGED,
  parsePlatformOpsMessage,
  type AnnouncementLevel,
  type DeploymentAnnouncement,
  type DeploymentMaintenance,
  type DeploymentNotice,
  type EffectiveConfigSource,
  type LocalizedNoticeText,
  type MaintenanceMode,
} from '@siyahtus/types';

export const PUBLIC_SETTINGS_TTL_MS = 30_000;

/** The trial lengths the tenant API accepts from the panel — `TRIAL_DAYS`'s own bound. */
const TRIAL_DAYS_MAX = 3650;

/** What `platform_public_settings()` returns: NULL for a key nobody set. */
export interface StoredPublicSettings {
  signup_enabled: boolean | null;
  trial_days: number | null;
  announcement: unknown;
  maintenance: unknown;
}

/** The environment's side: the parsed values, and whether the environment named them. */
export interface PublicSettingsEnv {
  SIGNUP_ENABLED: boolean;
  TRIAL_DAYS: number;
  explicitKeys: readonly string[];
}

export interface ResolvedPublicSettings {
  signupEnabled: boolean;
  signupEnabledSource: EffectiveConfigSource;
  trialDays: number;
  trialDaysSource: EffectiveConfigSource;
  /** Whatever `until` says — {@link activeAnnouncement} decides whether it shows. */
  announcement: DeploymentAnnouncement | null;
  /** Null while maintenance mode is off. */
  maintenance: DeploymentMaintenance | null;
}

function envSource(env: PublicSettingsEnv, key: string): EffectiveConfigSource {
  return env.explicitKeys.includes(key) ? 'env' : 'default';
}

const TEXT_MAX = 500;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TEXT_MAX ? trimmed : null;
}

function noticeText(value: unknown): LocalizedNoticeText | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const en = text(record['en']);
  const tr = text(record['tr']);
  return en !== null && tr !== null ? { en, tr } : null;
}

/**
 * The stored announcement, or null when there is none or it is not one this
 * process can show — both languages, a known level, a real date or none.
 */
export function parseAnnouncement(value: unknown): DeploymentAnnouncement | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const words = noticeText(record);
  const level = record['level'];
  if (!words || !(ANNOUNCEMENT_LEVELS as readonly unknown[]).includes(level)) return null;
  const until = record['until'];
  if (until !== null && until !== undefined) {
    if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) return null;
  }
  return {
    level: level as AnnouncementLevel,
    en: words.en,
    tr: words.tr,
    until: typeof until === 'string' ? new Date(until).toISOString() : null,
  };
}

/** Maintenance mode while it is on; null when off or unreadable. */
export function parseMaintenance(value: unknown): DeploymentMaintenance | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record['enabled'] !== true) return null;
  const mode = record['mode'];
  if (!(MAINTENANCE_MODES as readonly unknown[]).includes(mode)) return null;
  return { mode: mode as MaintenanceMode, message: noticeText(record['message']) };
}

/** The announcement if it is still up at `now`. */
export function activeAnnouncement(
  announcement: DeploymentAnnouncement | null,
  now: number,
): DeploymentAnnouncement | null {
  if (!announcement) return null;
  if (announcement.until !== null && Date.parse(announcement.until) <= now) return null;
  return announcement;
}

/**
 * The panel's values over the environment's. `stored` null is "nothing could
 * be read": the environment alone, the same as every key being unset.
 */
export function resolvePublicSettings(
  stored: StoredPublicSettings | null,
  env: PublicSettingsEnv,
): ResolvedPublicSettings {
  const panelSignup = stored?.signup_enabled ?? null;
  // The stricter wins: the environment's "closed" is final, the panel's
  // "closed" closes an open environment, and the panel's "open" changes
  // nothing the environment did not already allow.
  const signupFromPanel = env.SIGNUP_ENABLED && panelSignup !== null;
  const signupEnabled = env.SIGNUP_ENABLED && panelSignup !== false;

  const panelTrial = stored?.trial_days ?? null;
  const trialFromPanel =
    panelTrial !== null &&
    Number.isInteger(panelTrial) &&
    panelTrial >= 1 &&
    panelTrial <= TRIAL_DAYS_MAX;

  return {
    signupEnabled,
    signupEnabledSource: signupFromPanel ? 'db' : envSource(env, 'SIGNUP_ENABLED'),
    trialDays: trialFromPanel ? panelTrial : env.TRIAL_DAYS,
    trialDaysSource: trialFromPanel ? 'db' : envSource(env, 'TRIAL_DAYS'),
    announcement: parseAnnouncement(stored?.announcement),
    maintenance: parseMaintenance(stored?.maintenance),
  };
}

export interface PublicSettingsOptions {
  db: PrismaClient;
  env: PublicSettingsEnv;
  logger: FastifyBaseLogger;
  ttlMs?: number;
  now?: () => number;
}

export class PublicSettings {
  readonly #db: PrismaClient;
  readonly #env: PublicSettingsEnv;
  readonly #logger: FastifyBaseLogger;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #cached: { value: ResolvedPublicSettings; at: number } | null = null;
  #inFlight: Promise<ResolvedPublicSettings> | null = null;
  /** Bumped by {@link invalidate}, so a read that started before it is not cached after it. */
  #generation = 0;

  constructor(options: PublicSettingsOptions) {
    this.#db = options.db;
    this.#env = options.env;
    this.#logger = options.logger;
    this.#ttlMs = options.ttlMs ?? PUBLIC_SETTINGS_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** The settings in force — cached, and never a rejection. */
  async get(): Promise<ResolvedPublicSettings> {
    const cached = this.#cached;
    if (cached && this.#now() - cached.at < this.#ttlMs) return cached.value;
    if (this.#inFlight) return this.#inFlight;
    const load: Promise<ResolvedPublicSettings> = this.#load().finally(() => {
      // Only its own: an invalidation meanwhile may have started a newer read.
      if (this.#inFlight === load) this.#inFlight = null;
    });
    this.#inFlight = load;
    return load;
  }

  /** Forget the cached copy — an operator changed something (`settings.changed`). */
  invalidate(): void {
    this.#generation += 1;
    this.#cached = null;
    this.#inFlight = null;
  }

  /** A fresh read, whatever is cached — the scheduler leader's, every 30 seconds. */
  async refresh(): Promise<ResolvedPublicSettings> {
    this.invalidate();
    return this.get();
  }

  /** What `GET /deployment/notice` answers. */
  async notice(): Promise<DeploymentNotice> {
    const settings = await this.get();
    return {
      announcement: activeAnnouncement(settings.announcement, this.#now()),
      maintenance: settings.maintenance,
    };
  }

  /**
   * Whether the root panel's blocklist (389.16 writes it) names this address,
   * its domain or this IP — and by which kind, or null. Asked fresh, never
   * cached: an entry an operator just added must stop the next sign-up. A
   * blocklist that cannot be read lets the sign-up through, logged, like
   * every budget here that fails open (`routes/account-lifecycle.ts`).
   */
  async signupBlocked(email: string, ip: string | null): Promise<string | null> {
    try {
      const rows = await this.#db.$queryRaw<
        Array<{ blocked: boolean; matched_kind: string | null }>
      >`
        SELECT blocked, matched_kind FROM platform_signup_blocked(${email}, ${ip})`;
      const row = rows[0];
      return row?.blocked ? (row.matched_kind ?? 'email') : null;
    } catch (error) {
      this.#logger.warn(
        { err: error, event: 'platform_blocklist.read_failed' },
        'sign-up blocklist could not be read; allowing',
      );
      return null;
    }
  }

  async #load(): Promise<ResolvedPublicSettings> {
    const generation = this.#generation;
    let stored: StoredPublicSettings | null = null;
    try {
      const rows = await this.#db.$queryRaw<StoredPublicSettings[]>`
        SELECT signup_enabled, trial_days, announcement, maintenance
        FROM platform_public_settings()`;
      stored = rows[0] ?? null;
    } catch (error) {
      // Cached like an answer, so a database that is away is asked once per
      // interval rather than once per request.
      this.#logger.warn(
        { err: error, event: 'platform_settings.read_failed' },
        'platform settings could not be read; running on the environment',
      );
    }
    const value = resolvePublicSettings(stored, this.#env);
    if (generation === this.#generation) this.#cached = { value, at: this.#now() };
    return value;
  }
}

/**
 * Drop `settings`' copy on every `settings.changed` on `subscriber` — a
 * connection of its own, since a subscribed client can do nothing else. A
 * message this cannot read drops it too: a spurious re-read costs one query.
 */
export async function listenForPlatformSettingsChanges(
  subscriber: Redis,
  onChange: () => void,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== PLATFORM_OPS_CHANNEL) return;
    const parsed = parsePlatformOpsMessage(message);
    if (parsed === null || parsed.type === PLATFORM_SETTINGS_CHANGED) onChange();
  });
  await subscriber.subscribe(PLATFORM_OPS_CHANNEL);
}
