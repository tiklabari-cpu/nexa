/**
 * Maintenance mode at the gateway (tm 389.13 · FR-ADMIN-15).
 *
 * In `full` mode the tenant API answers 503 `maintenance` to nearly everything
 * (`apps/api/src/plugins/maintenance-gate.ts`), and a socket that stayed open
 * would keep pushing a console nobody can act in. So the gateway follows the
 * same switch: while it is `full`, every open socket is closed (4503) and
 * `login` is refused with the same `maintenance` type the REST edge sends.
 * `read_only` changes nothing here — reading is what the sockets do.
 *
 * The gateway has no read of the root panel's settings table; it reads
 * `OPS_MAINTENANCE_KEY`, which the root panel writes when it changes the
 * mode and the tenant API's scheduler leader re-writes from the database every
 * 30 seconds. Re-read on every `settings.changed` and on a 30-second timer of
 * its own, so a missed announcement is caught within one interval. A key that
 * cannot be read keeps the last answer: a Redis blip must not open a gateway
 * in maintenance, nor close one that is not.
 */
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  MAINTENANCE_MODES,
  OPS_MAINTENANCE_KEY,
  PLATFORM_OPS_CHANNEL,
  PLATFORM_SETTINGS_CHANGED,
  parsePlatformOpsMessage,
  type MaintenanceMode,
} from '@siyahtus/types';

export const MAINTENANCE_REFRESH_MS = 30_000;
/** The close code a socket gets when maintenance starts — 4000 + the REST status. */
export const MAINTENANCE_CLOSE_CODE = 4503;

/** The stored mode, or null for "off" — and for anything this cannot read as a mode. */
export function parseMaintenanceKey(raw: string | null): MaintenanceMode | null {
  if (raw === null) return null;
  try {
    const mode = (JSON.parse(raw) as { mode?: unknown }).mode;
    return (MAINTENANCE_MODES as readonly unknown[]).includes(mode)
      ? (mode as MaintenanceMode)
      : null;
  } catch {
    return null;
  }
}

export class MaintenanceWatch {
  readonly #redis: Pick<Redis, 'get'>;
  readonly #log: Logger;
  readonly #onFull: () => void;
  #mode: MaintenanceMode | null = null;
  #timer: NodeJS.Timeout | null = null;

  /** @param onFull Called each time the mode becomes `full` — close the sockets. */
  constructor(redis: Pick<Redis, 'get'>, log: Logger, onFull: () => void) {
    this.#redis = redis;
    this.#log = log;
    this.#onFull = onFull;
  }

  /** Whether `login` is refused right now. */
  get full(): boolean {
    return this.#mode === 'full';
  }

  async refresh(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.#redis.get(OPS_MAINTENANCE_KEY);
    } catch (error) {
      this.#log.warn({ err: error }, 'maintenance mode could not be read; keeping the last answer');
      return;
    }
    const next = parseMaintenanceKey(raw);
    const was = this.#mode;
    this.#mode = next;
    if (next === 'full' && was !== 'full') {
      this.#log.warn('maintenance mode: closing every socket and refusing logins');
      this.#onFull();
    } else if (was === 'full' && next !== 'full') {
      this.#log.info('maintenance mode over: logins accepted again');
    }
  }

  start(intervalMs = MAINTENANCE_REFRESH_MS): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => void this.refresh(), intervalMs);
    // Never what keeps the process alive.
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}

/**
 * Re-read on every `settings.changed` (or an unreadable message) on
 * `subscriber`, which may carry other channels — they are left alone.
 */
export async function listenForMaintenanceChanges(
  subscriber: Redis,
  watch: MaintenanceWatch,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== PLATFORM_OPS_CHANNEL) return;
    const parsed = parsePlatformOpsMessage(message);
    if (parsed === null || parsed.type === PLATFORM_SETTINGS_CHANGED) void watch.refresh();
  });
  await subscriber.subscribe(PLATFORM_OPS_CHANNEL);
}
