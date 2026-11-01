/**
 * iGaming platform catalogue — KN-06, F1 (owner decision K15).
 *
 * A static, hand-written list of the iGaming platforms Settings → Integrations
 * shows as "coming soon" cards. It is a catalogue *record* and nothing more:
 * there is no connection flow, no table, no endpoint and no player-data path
 * behind it — the real connector (platform_connections, tool_invocations and
 * the vendor adapters) is F2 (tm 378). Until then every entry is
 * `coming_soon` and the card's "Connect" button is inert.
 *
 * Brand names are plain text on purpose — no logo is shipped, so there is no
 * licence to check. Keep this list to one or two entries: it is a placeholder,
 * not a directory (the marketplace in `apps.ts` is the directory).
 *
 * Display copy (the one-line description) lives in the web locale catalogues
 * under `settings.integrations.igaming.<vendor>.description`, keyed by `vendor`.
 */

/** Where a platform stands. `coming_soon` is the only F1 value; F2 adds `available`. */
export type IgamingPlatformStatus = 'coming_soon';

export interface IgamingPlatform {
  /** Stable lowercase slug — also the suffix of the web description key. */
  vendor: string;
  /** Brand name, shown verbatim in every language. */
  name: string;
  status: IgamingPlatformStatus;
}

export const IGAMING_PLATFORMS: readonly IgamingPlatform[] = [
  { vendor: 'betconstruct', name: 'BetConstruct', status: 'coming_soon' },
  { vendor: 'everymatrix', name: 'EveryMatrix', status: 'coming_soon' },
];
