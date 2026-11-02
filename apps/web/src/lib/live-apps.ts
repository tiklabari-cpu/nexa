/**
 * What `GET /deployment` says about live Apps cards (tm 263), as plain
 * functions of the config — kept apart from `deployment.ts` so a screen test
 * that mocks `useDeployment` still gets the real rule.
 */
import type { DeploymentConfig } from '@siyahtus/types';

/** The `live_apps` ids that are channels (Settings → Channels), not Apps cards. */
const LIVE_CHANNEL_IDS = new Set(['telegram', 'whatsapp', 'messenger', 'instagram']);

/**
 * The Apps data cards this deployment runs live (tm 263) — `live_apps` less
 * `telegram`, `whatsapp` (tm 380), `messenger` and `instagram` (tm 381), which
 * are channels. Under `pilot_mode` these are the whole
 * marketplace; none means the pilot has no marketplace at all, as before.
 * Read by truthiness: an older server sends no `live_apps`.
 */
export function liveDataApps(config: DeploymentConfig): string[] {
  return (config.live_apps ?? []).filter((id) => !LIVE_CHANNEL_IDS.has(id));
}

/** Whether Telegram runs as a real channel here (tm 263). */
export function isTelegramLive(config: DeploymentConfig): boolean {
  return (config.live_apps ?? []).includes('telegram');
}

/** Whether WhatsApp runs as a real Cloud API channel here (tm 380). */
export function isWhatsAppLive(config: DeploymentConfig): boolean {
  return (config.live_apps ?? []).includes('whatsapp');
}

/** The Meta messaging channels that can run live (tm 381). */
export type MetaMessagingChannel = 'messenger' | 'instagram';

/** Whether Messenger / Instagram runs as a real channel here (tm 381). */
export function isMetaChannelLive(config: DeploymentConfig, type: MetaMessagingChannel): boolean {
  return (config.live_apps ?? []).includes(type);
}

/**
 * Whether any channel here has Meta's 24-hour reply window (tm 380, tm 381):
 * a live WhatsApp, Messenger or Instagram. Elsewhere every chat is open.
 */
export function hasReplyWindowChannels(config: DeploymentConfig): boolean {
  return (config.live_apps ?? []).some(
    (id) => id === 'whatsapp' || id === 'messenger' || id === 'instagram',
  );
}
