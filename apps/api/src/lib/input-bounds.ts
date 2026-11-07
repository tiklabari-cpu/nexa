/**
 * Bounds the public edge puts on input before zod reads it (tm 419 · tm 451).
 *
 * **Collections (GHSA-mrhx-c7xc-m3w5).** zod 3 checks an array's `.max()` only
 * after it has parsed every element, and every element that fails is its own
 * issue. A 1 MB body of `{"browser_languages":[1,1,1,…]}` — 500k elements, under
 * the 1 MiB body limit — cost the unauthenticated `POST /customer/token` ~160 MB
 * of heap and ~240 ms of synchronous CPU, and answered with a 72 MB list of
 * 500,001 issues (2026-11-06 audit, F02). There is no 3.x release with the fix;
 * zod 4 is epic tm 477. Until then, a collection a caller without an agent
 * credential can send is checked for size *first* — `Array.isArray(v) &&
 * v.length <= max`, `Object.keys(v).length <= max` — and its elements are
 * parsed only when it fits. Over the bound is one issue, and no element is
 * looked at.
 *
 * Where these apply: every `z.array` / `z.record` on a route reachable without
 * an agent credential — `public: true` routes and the customer-token routes
 * (a visitor's token is minted for anyone who asks). Agent-authenticated
 * schemas are left to the zod 4 migration. The list is in HANDOFF (tm 419).
 *
 * **Visitor page addresses (tm 451 · F30).** A visitor's widget reports the
 * page it is on; anything that is not an http(s) URL is not a page, and a
 * `javascript:` one stored as a page reaches an agent's panel as a link.
 * {@link httpUrl} drops such a value instead of refusing the request — the
 * address is a routing hint, and a message must not be lost over it.
 */
import { z } from 'zod';

/** zod 3's own wording for an array over its `.max()`, so callers read the same message. */
function tooManyElements(max: number): string {
  return `Array must contain at most ${max} element(s)`;
}

/**
 * `z.array(element).max(max)` — with the length checked before any element is
 * parsed. `min` is the array's `.min()`, the one other bound callers use.
 *
 * The result is a pipe from `unknown`, so it is chained like any schema
 * (`.optional()`, `.default([])`) but not with array methods.
 */
export function boundedArray<T extends z.ZodTypeAny>(
  element: T,
  max: number,
  options: { min?: number } = {},
) {
  const array = options.min === undefined ? z.array(element) : z.array(element).min(options.min);
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (Array.isArray(value) && value.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: 'array',
          maximum: max,
          inclusive: true,
          exact: false,
          message: tooManyElements(max),
        });
      }
    })
    .pipe(array.max(max));
}

/**
 * A record schema whose keys are counted before any value is parsed: over
 * `maxKeys` is one issue at the record's own path, with `message`.
 */
export function boundedRecord<T extends z.ZodTypeAny>(
  record: T,
  maxKeys: number,
  message = `at most ${maxKeys} keys`,
) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length > maxKeys
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    })
    .pipe(record);
}

/** Whether `value` parses as an absolute http: or https: URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A page address a visitor sent: at most `maxLength` characters (longer is
 * still a 400 — that bounds the body), and dropped — `undefined`, as if never
 * sent — when it is not an http(s) URL. Use with `.optional()`.
 */
export function httpUrl(maxLength = 2048) {
  return z
    .string()
    .max(maxLength)
    .transform((value) => (isHttpUrl(value) ? value : undefined));
}

/**
 * The schemes a referrer that parses as a URL may carry. Not only http(s):
 * Chrome on Android reports an app that opened the page as
 * `android-app://<package>/`, which `sanitizeReferrer` keeps on purpose. A
 * referrer is never rendered as a link; this keeps out what a script could run.
 */
const REFERRER_SCHEMES = new Set(['http:', 'https:', 'android-app:']);

/**
 * A referrer as a visitor's widget reports it, or `undefined` when it names a
 * scheme outside {@link REFERRER_SCHEMES} (`javascript:`, `data:`, `file:`, …).
 * A value that does not parse as a URL at all is kept: it has no scheme to run,
 * and `sanitizeReferrer` documents that such referrers are real.
 */
export function keptReferrer(value: string): string | undefined {
  let protocol: string;
  try {
    protocol = new URL(value.trim()).protocol;
  } catch {
    return value;
  }
  return REFERRER_SCHEMES.has(protocol) ? value : undefined;
}

/** {@link keptReferrer} as a schema: at most `maxLength` characters, then filtered. */
export function visitorReferrer(maxLength: number) {
  return z.string().max(maxLength).transform(keptReferrer);
}
