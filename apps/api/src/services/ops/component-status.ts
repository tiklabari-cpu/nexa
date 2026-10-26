/**
 * The component status record (tm 389.8 · FR-ADMIN-07 · design.md §A).
 *
 * A Redis hash, `siyahtus:ops:components`, one field per component named in
 * `OPS_COMPONENTS` (@siyahtus/types), each a small JSON document: the state,
 * a short detail and when it was reported. The tenant API's modules write it —
 * a module that is not part of the deployment says `not_installed` rather than
 * saying nothing — and the platform process reads it for the dashboard's
 * health grid. Redis is the meeting point because the two processes share no
 * call path (design.md §A).
 *
 * Writing is best-effort by construction: {@link reportComponentStatus} never
 * throws and never waits on anything but one `HSET`, so a module can report
 * from inside a request without that request ever depending on Redis for it.
 */
import {
  isOpsComponentKey,
  OPS_COMPONENT_STATES,
  OPS_COMPONENTS,
  type OpsComponentKey,
  type OpsComponentState,
} from '@siyahtus/types';

export const OPS_COMPONENTS_KEY = 'siyahtus:ops:components';

/** A detail is a short phrase for an operator, never an error message with a connection string. */
export const COMPONENT_DETAIL_MAX = 200;

export interface ComponentReport {
  state: OpsComponentState;
  detail?: string | null;
  /** ISO-8601; the clock's now when omitted. */
  updatedAt?: string;
}

export interface ComponentStatus {
  key: OpsComponentKey;
  /** `unknown`: nothing has reported this component yet. */
  state: OpsComponentState | 'unknown';
  detail: string | null;
  updated_at: string | null;
}

interface HashWriter {
  hset(key: string, field: string, value: string): Promise<unknown>;
}
interface HashReader {
  hgetall(key: string): Promise<Record<string, string>>;
}

export async function reportComponentStatus(
  redis: HashWriter,
  key: OpsComponentKey,
  report: ComponentReport,
  logger?: { debug(object: object, message: string): void },
): Promise<boolean> {
  try {
    if (!isOpsComponentKey(key) || !OPS_COMPONENT_STATES.includes(report.state)) return false;
    const detail = report.detail?.trim().slice(0, COMPONENT_DETAIL_MAX) || null;
    const updatedAt = report.updatedAt ?? new Date().toISOString();
    await redis.hset(
      OPS_COMPONENTS_KEY,
      key,
      JSON.stringify({ state: report.state, detail, updatedAt }),
    );
    return true;
  } catch (error) {
    logger?.debug({ err: error, component: key }, 'component status could not be reported');
    return false;
  }
}

/**
 * Say a component is not part of this build — but only while nobody has said
 * anything about it (`HSETNX`). The health leader repeats this every half
 * minute for modules that do not exist yet; once such a module reports for
 * itself, the placeholder must not take its place back.
 */
export async function reportComponentNotInstalled(
  redis: { hsetnx(key: string, field: string, value: string): Promise<unknown> },
  key: OpsComponentKey,
  detail: string,
  logger?: { debug(object: object, message: string): void },
): Promise<boolean> {
  try {
    if (!isOpsComponentKey(key)) return false;
    await redis.hsetnx(
      OPS_COMPONENTS_KEY,
      key,
      JSON.stringify({
        state: 'not_installed',
        detail: detail.trim().slice(0, COMPONENT_DETAIL_MAX) || null,
        updatedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch (error) {
    logger?.debug({ err: error, component: key }, 'component status could not be reported');
    return false;
  }
}

function parseField(key: OpsComponentKey, raw: string | undefined): ComponentStatus {
  const unknown: ComponentStatus = { key, state: 'unknown', detail: null, updated_at: null };
  if (raw === undefined) return unknown;
  try {
    const value = JSON.parse(raw) as { state?: unknown; detail?: unknown; updatedAt?: unknown };
    if (
      typeof value.state !== 'string' ||
      !(OPS_COMPONENT_STATES as readonly string[]).includes(value.state)
    ) {
      return unknown;
    }
    return {
      key,
      state: value.state as OpsComponentState,
      detail: typeof value.detail === 'string' ? value.detail : null,
      updated_at: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    };
  } catch {
    return unknown;
  }
}

/** The list with nothing reported — what a reader shows when it cannot reach Redis. */
export function emptyComponentStatuses(): ComponentStatus[] {
  return OPS_COMPONENTS.map((key) => parseField(key, undefined));
}

/** Every listed component in `OPS_COMPONENTS` order; one that never reported is `unknown`. */
export async function readComponentStatuses(redis: HashReader): Promise<ComponentStatus[]> {
  const hash = await redis.hgetall(OPS_COMPONENTS_KEY);
  return OPS_COMPONENTS.map((key) => parseField(key, hash[key]));
}
