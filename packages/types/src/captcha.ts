/**
 * The human check the widget asks for only when a visitor looks scripted
 * (tm 339.2 · SiyahTuş analysis GV-01) — shared by the API that decides it,
 * the contract that names it and the widget that shows it (tm 339.3).
 *
 * A normal visitor never sees one. A widget token minted for a new visitor, or
 * a conversation opened, is answered `403 challenge_required` when the
 * workspace's mode and the risk signals say so; the widget then shows the
 * provider's check and repeats the request with its `challenge_token`. A
 * member who passed one is not asked again for {@link CHALLENGE_PASS_TTL_HOURS}
 * hours, and one who came back with a member token this workspace signed
 * (ID-03 · K4) is not asked at all.
 */

/**
 * Who checks the visitor (`CAPTCHA_PROVIDER`): Cloudflare Turnstile, the
 * offline stand-in development and the tests use, or nobody (the layer off).
 */
export const CAPTCHA_PROVIDERS = ['turnstile', 'mock', 'none'] as const;
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number];

/**
 * When a workspace asks (`security_settings.captcha_mode`): never, only when
 * the risk signals fire (the default), or on every conversation a visitor
 * opens without having passed one.
 */
export const CAPTCHA_MODES = ['off', 'risk', 'always_on_chat_start'] as const;
export type CaptchaMode = (typeof CAPTCHA_MODES)[number];
export const CAPTCHA_MODE_DEFAULT: CaptchaMode = 'risk';

export function isCaptchaMode(value: unknown): value is CaptchaMode {
  return typeof value === 'string' && (CAPTCHA_MODES as readonly string[]).includes(value);
}

/**
 * Why a check is asked, as `challenge_required`'s `details.reason` says it:
 * many new visitors from one address, a burst of messages, a member who has
 * already had much of the AI today, the workspace's "always" mode — or a
 * `challenge_token` the provider refused.
 */
export const CHALLENGE_REASONS = [
  'new_customers_per_ip',
  'messages_per_minute',
  'ai_turns_today',
  'always_on_chat_start',
  'challenge_failed',
] as const;
export type ChallengeReason = (typeof CHALLENGE_REASONS)[number];

/** How long a passed check spares the member another one. */
export const CHALLENGE_PASS_TTL_HOURS = 12;

/**
 * The mock provider's tokens: the one it accepts, and the one that plays an
 * unreachable provider. Anything else it refuses. The widget's mock check
 * hands out the first; no network call is made either way.
 */
export const MOCK_CAPTCHA_PASS_TOKEN = 'mock-captcha-pass';
export const MOCK_CAPTCHA_UNAVAILABLE_TOKEN = 'mock-captcha-unavailable';
/** The site key the mock provider announces in `details.site_key`. */
export const MOCK_CAPTCHA_SITE_KEY = 'mock-site-key';

/** `challenge_required`'s `details`. */
export interface ChallengeRequiredDetails {
  reason: ChallengeReason;
  provider: Exclude<CaptchaProvider, 'none'>;
  site_key: string;
}

/**
 * `properties.system_event` of the agents-only note left when the AI held
 * back from a visitor the provider could not check (the provider was away).
 */
export const AI_CHALLENGE_UNVERIFIED_SYSTEM_EVENT = 'ai_challenge_unverified';
