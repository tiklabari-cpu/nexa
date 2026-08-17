/**
 * Where the mobile app points, and the refusal to guess.
 *
 * A phone has no origin to fall back on: unlike the web app, which can send
 * `/api/v1` at whatever host served it, every request here needs an absolute
 * URL. So the two endpoints are declared in `app.config.ts` under `expo.extra`
 * and read back through `expo-constants` — the one channel that survives both
 * `expo start` and an exported bundle. A missing or malformed value is a build
 * mistake, not a runtime condition to degrade around, so it throws.
 */
import Constants from 'expo-constants';

export interface MobileConfig {
  /** Absolute base of the Agent REST surface, no trailing slash. */
  apiBaseUrl: string;
  /** Absolute base of the RTM WebSocket surface, no trailing slash. */
  rtmBaseUrl: string;
}

export class MobileConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid expo.extra config: ${problems.join('; ')}`);
    this.name = 'MobileConfigError';
    this.problems = problems;
  }
}

/**
 * Report every broken key at once. Fixing `app.config.ts` one thrown error per
 * rebuild is a slow way to learn that two values were wrong.
 */
export function readMobileConfig(extra: unknown = Constants.expoConfig?.extra): MobileConfig {
  const problems: string[] = [];
  const record = isRecord(extra) ? extra : {};
  if (!isRecord(extra)) problems.push('expo.extra is missing');

  const apiBaseUrl = requireUrl(record.apiBaseUrl, 'apiBaseUrl', ['http:', 'https:'], problems);
  const rtmBaseUrl = requireUrl(record.rtmBaseUrl, 'rtmBaseUrl', ['ws:', 'wss:'], problems);

  if (problems.length > 0) throw new MobileConfigError(problems);
  return { apiBaseUrl, rtmBaseUrl };
}

function requireUrl(
  value: unknown,
  key: string,
  allowedProtocols: readonly string[],
  problems: string[],
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${key} must be a non-empty string`);
    return '';
  }

  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    problems.push(`${key} is not a valid URL: ${trimmed}`);
    return '';
  }

  // A `https://` RTM base or a `ws://` API base is a copy-paste slip that would
  // otherwise fail much later, inside a socket handshake, with a worse message.
  if (!allowedProtocols.includes(parsed.protocol)) {
    problems.push(`${key} must use ${allowedProtocols.join(' or ')}, got ${parsed.protocol}`);
    return '';
  }

  return trimmed.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
