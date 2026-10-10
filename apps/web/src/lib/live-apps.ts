/**
 * What `GET /deployment` says about live Apps cards (tm 263), as plain
 * functions of the config — kept apart from `deployment.ts` so a screen test
 * that mocks `useDeployment` still gets the real rule.
 */
import type { DeploymentConfig } from '@siyahtus/types';

/**
 * The Apps data cards this deployment runs live (tm 263) — `live_apps` less
 * `telegram`, which is a channel. Under `pilot_mode` these are the whole
 * marketplace; none means the pilot has no marketplace at all, as before.
 * Read by truthiness: an older server sends no `live_apps`.
 */
export function liveDataApps(config: DeploymentConfig): string[] {
  return (config.live_apps ?? []).filter((id) => id !== 'telegram');
}

/** Whether Telegram runs as a real channel here (tm 263). */
export function isTelegramLive(config: DeploymentConfig): boolean {
  return (config.live_apps ?? []).includes('telegram');
}
