/**
 * Which language a request's reader reads (tm 265) — for the e-mail it sets off.
 *
 * The panel keeps its language in the browser and says it on every request as
 * `X-SiyahTus-Locale` (`apps/web/src/lib/api-client.ts`), because that is the
 * language the person chose on screen, and the browser's own
 * `Accept-Language` may say something else. Without the header (a script, the
 * mobile app, an older panel) the browser preference decides; without either,
 * English. Only languages the mail templates are written in are answered.
 */
import type { FastifyRequest } from 'fastify';
import { isMailLocale, type MailLocale } from '../services/mail/templates/layout.js';

export const LOCALE_HEADER = 'x-siyahtus-locale';

function primary(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** The first supported language of an `Accept-Language` value, by weight. */
export function acceptLanguageLocale(value: string | undefined): MailLocale | null {
  if (!value) return null;
  const ranked = value
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';');
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: primary(tag), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((entry) => entry.tag).find(isMailLocale) ?? null;
}

export function headerLocale(value: unknown): MailLocale | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const tag = primary(raw);
  return isMailLocale(tag) ? tag : null;
}

export function requestLocale(request: Pick<FastifyRequest, 'headers'>): MailLocale {
  return (
    headerLocale(request.headers[LOCALE_HEADER]) ??
    acceptLanguageLocale(
      typeof request.headers['accept-language'] === 'string'
        ? request.headers['accept-language']
        : undefined,
    ) ??
    'en'
  );
}
