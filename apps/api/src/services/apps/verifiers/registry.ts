/**
 * The live Apps cards (tm 263): which card has a real adaptor, and whether
 * this deployment switched it on.
 *
 * A card is live exactly when it is in this table **and** `APPS_LIVE_PROVIDERS`
 * names it. Every other card — 51 of the 54 `api_key` cards, and every OAuth
 * card — keeps the mock it always had, unchanged. Telegram is in
 * `LIVE_APP_IDS` but not here: it is a channel, connected in Settings →
 * Channels (`services/channels/telegram-live.ts`), not through this table.
 */
import type { LiveAppId } from '../live-apps.js';
import { brevoVerifier } from './brevo.js';
import { freshdeskVerifier } from './freshdesk.js';
import type { AppVerifier } from './types.js';

export const APP_VERIFIERS: Readonly<Record<AppVerifier['appId'], AppVerifier>> = {
  brevo: brevoVerifier,
  freshdesk: freshdeskVerifier,
};

/** The verifier for `appId` when the deployment runs it live, else `null` (the mock path). */
export function liveVerifier(
  appId: string,
  liveProviders: readonly LiveAppId[],
): AppVerifier | null {
  if (!Object.prototype.hasOwnProperty.call(APP_VERIFIERS, appId)) return null;
  if (!(liveProviders as readonly string[]).includes(appId)) return null;
  return APP_VERIFIERS[appId as AppVerifier['appId']];
}

/**
 * Every card id this deployment runs live — data cards with a switched-on
 * verifier, plus `telegram` when its live channel is on. What `GET /deployment`
 * reports as `live_apps` and what the pilot gate lets through.
 */
export function liveAppIds(liveProviders: readonly LiveAppId[]): string[] {
  return liveProviders.filter(
    (id) => id === 'telegram' || Object.prototype.hasOwnProperty.call(APP_VERIFIERS, id),
  );
}
