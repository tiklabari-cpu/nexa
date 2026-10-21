/**
 * The access information resolver (tm 310.4 · SiyahTuş analysis AI-13, owner
 * decision K13 · AI-08 G14): what the AI says when a player cannot reach the
 * site or asks for its current address — only what the workspace entered; the
 * workspace answers for it, and the panel says so.
 *
 * One setting for every brand and at most one per brand, a brand's own over
 * the every-brand one (`readAiAccessInfo`). Three sources:
 *
 *   - `fixed_link` — the link, in the workspace's own sentence when it wrote
 *     one (`fixed_text`), after a fixed lead-in otherwise. Nothing else.
 *   - `kb_row` — a knowledge source the workspace chose: a limits-and-rules
 *     row's value ("Güncel giriş adresi: …"), another row's text, an
 *     article's or a FAQ's. A source that is gone, empty, not for the AI,
 *     ended, or for another brand or AI agent says nothing — the knowledge
 *     filter (`knowledgeSourceServes`), so the every-brand setting never says
 *     one brand's source to another brand's player.
 *   - `dynamic_url` — fetched when asked. Within `cache_seconds` of the last
 *     fetch the last value is said again without asking; otherwise the URL is
 *     fetched, and what it answers is said and kept (`last_value`). A fetch
 *     that fails says the last value, however old; with none there is nothing
 *     to say.
 *
 * Nothing to say is a hand-over (G14: "bilgi yoksa devret") — the engine's.
 *
 * **The fetch is a request the server makes, from inside its network, to a
 * URL a tenant typed** — the SSRF shape `lib/ssrf.ts` describes. So it goes
 * through the one safe client (`lib/safe-fetch.ts`) and nothing else: https
 * only; the host resolved and every address range-checked (no loopback,
 * private, link-local or metadata address) right before each fetch, not only
 * when the URL was saved; the socket pinned to exactly the checked addresses,
 * so a zero-TTL record cannot answer public for the check and internal for
 * the connection; no redirect followed; a short timeout (a player is waiting)
 * and a small body cap (an address, not a page). A failure is kept by its
 * kind (`blocked`, `timeout`, …) — never the URL, never the body.
 *
 * What a fetch answers must be a value: JSON — a string, or an object's first
 * string among {@link ACCESS_VALUE_KEYS} — or plain text. Markup, an empty
 * answer and a status outside 2xx are failures like any other. The value is
 * stripped of control and format characters and cut to `lastValueMax`.
 *
 * A URL that failed is not asked again for {@link ACCESS_INFO_FAILURE_BACKOFF_MS}
 * in this process — a host that is down would otherwise cost every player who
 * asks the whole timeout — and turns that find the cache expired at the same
 * moment share one fetch.
 *
 * The cache lives on the row (`last_value`, `last_fetched_at`): "the last
 * known value" outlives a process. Writing it is the one write a turn makes
 * through its runner — a cache, not a decision of the turn and not a change of
 * the setting (`updated_at` stays; `config-draft.ts` is for the panel's
 * writes) — on the service's own clock, never a simulation's. It is written
 * only while the row still names the URL that was fetched, so a setting
 * changed meanwhile never takes the old URL's value. A simulation (tm 314.2)
 * fetches like a live turn and writes no cache.
 *
 * Until tm 316 versions the configuration the setting is read live;
 * afterwards from the published package, the cache from the row.
 */
import type { AiAccessInfo, KnowledgeSource } from '@prisma/client';
import {
  AI_ACCESS_INFO_LIMITS,
  KNOWLEDGE_TABLE_SQL_NAMES,
  knowledgeSourceServes,
  type AiAccessInfoSourceType,
  type PersonaLanguage,
} from '@siyahtus/types';
import {
  createSafeHttp,
  SafeHttpError,
  type SafeHttp,
  type SafeHttpErrorKind,
  type SafeResponse,
} from '../../lib/safe-fetch.js';
import { simulationScope } from '../../lib/simulation-context.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { TenantRunner } from '../ai/conversation/turn.js';
import { readAiAccessInfo } from './rows.js';

/** A player is waiting for the answer: the whole fetch, DNS included, gets this long. */
export const ACCESS_INFO_FETCH_TIMEOUT_MS = 3_000;
/** An address or a sentence, not a page. */
export const ACCESS_INFO_FETCH_MAX_BYTES = 16 * 1024;
export const ACCESS_INFO_USER_AGENT = 'SiyahTus-AccessInfo/1.0';
/** How long a URL that failed is left alone in this process. */
export const ACCESS_INFO_FAILURE_BACKOFF_MS = 30_000;

/** A JSON object's value is its first string under one of these keys, in this order. */
export const ACCESS_VALUE_KEYS = [
  'text',
  'message',
  'value',
  'url',
  'address',
  'link',
  'domain',
] as const;

// ---------------------------------------------------------------------------
// The fetch.
// ---------------------------------------------------------------------------

/**
 * Why a fetch said nothing: the safe client's kinds, a status outside 2xx,
 * or an answer that holds no value.
 */
export type AccessInfoFetchFailure = SafeHttpErrorKind | 'status' | 'unreadable';

export type AccessInfoFetch =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly failure: AccessInfoFetchFailure; readonly code?: string };

export interface AccessInfoFetcher {
  fetch(url: string): Promise<AccessInfoFetch>;
}

/**
 * The production fetcher: a GET through the safe client. `http` is a test's
 * seam — the local HTTPS fake, or the real client over a stubbed resolver.
 */
export function createAccessInfoFetcher(
  http: SafeHttp = createSafeHttp({
    timeoutMs: ACCESS_INFO_FETCH_TIMEOUT_MS,
    maxBytes: ACCESS_INFO_FETCH_MAX_BYTES,
  }),
): AccessInfoFetcher {
  return {
    async fetch(url) {
      let response: SafeResponse;
      try {
        response = await http.request({
          method: 'GET',
          url,
          headers: {
            'user-agent': ACCESS_INFO_USER_AGENT,
            accept: 'application/json, text/plain;q=0.9',
          },
        });
      } catch (error) {
        if (error instanceof SafeHttpError) {
          return { ok: false, failure: error.kind, ...(error.code ? { code: error.code } : {}) };
        }
        return { ok: false, failure: 'network' };
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, failure: 'status', code: String(response.status) };
      }
      const value = accessInfoValueOf(response);
      return value === null ? { ok: false, failure: 'unreadable' } : { ok: true, value };
    },
  };
}

/** The value an answer holds, cleaned and cut — null when it holds none. */
export function accessInfoValueOf(response: Pick<SafeResponse, 'text' | 'json'>): string | null {
  const { json } = response;
  if (json !== undefined) {
    if (typeof json === 'string') return cleanAccessText(json);
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    for (const key of ACCESS_VALUE_KEYS) {
      const value = (json as Record<string, unknown>)[key];
      if (typeof value !== 'string') continue;
      const cleaned = cleanAccessText(value);
      if (cleaned !== null) return cleaned;
    }
    return null;
  }
  // Markup is a page — an error page, a login wall, a bot check — not a value.
  if (/^\s*</.test(response.text)) return null;
  return cleanAccessText(response.text);
}

/**
 * Line breaks kept (one blank line at most), tabs made spaces, every other
 * control or format character (zero-width, bidirectional overrides, the BOM)
 * dropped, trimmed, at most `lastValueMax` characters.
 */
export function cleanAccessText(raw: string): string | null {
  const text = raw
    .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/\t/g, ' ')
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') return null;
  return cut(text, AI_ACCESS_INFO_LIMITS.lastValueMax);
}

/** At most `max` characters, at a word's end when there is one, an ellipsis when cut. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  // Never half a surrogate pair.
  const lastCode = head.charCodeAt(head.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) head = head.slice(0, -1);
  const atWord = head.replace(/\s+\S*$/, '');
  return `${atWord.length > max / 2 ? atWord : head}…`;
}

// ---------------------------------------------------------------------------
// The answer.
// ---------------------------------------------------------------------------

/**
 * How the answer came: the fixed link; the knowledge source; a fetch now; the
 * cache within its window; the last value after a fetch that failed.
 */
export type AccessAnswerServed = 'fixed' | 'source' | 'fetched' | 'cached' | 'last_value';

/** Why there is nothing to say. */
export type AccessNoAnswer =
  'no_setting' | 'source_gone' | 'source_not_served' | 'source_empty' | 'fetch_failed';

export type AccessAnswer =
  | {
      readonly kind: 'answer';
      /** What the AI says, whole — and what G14 lets through (`checkOutput`). */
      readonly text: string;
      readonly sourceType: AiAccessInfoSourceType;
      readonly served: AccessAnswerServed;
      /** The failed fetch a last value stands in for. */
      readonly failure?: AccessInfoFetchFailure;
    }
  | {
      readonly kind: 'none';
      readonly sourceType: AiAccessInfoSourceType | null;
      readonly reason: AccessNoAnswer;
      readonly failure?: AccessInfoFetchFailure;
    };

export interface AccessInfoRead {
  /** The turn's runner (RLS: this workspace). */
  readonly db: TenantRunner;
  /** The conversation's brand; null when not known — the every-brand setting only. */
  readonly brandId: string | null;
  /** The AI agent answering; a source kept for another agent says nothing. */
  readonly aiAgentId: string | null;
  /** The turn's clock — whether a source has ended. */
  readonly now: Date;
  readonly language: PersonaLanguage | null;
}

/** Where the engine asks (`ConversationEngineOptions.access`). */
export interface AccessInfoSource {
  resolve(input: AccessInfoRead): Promise<AccessAnswer>;
}

/** The fixed lead-in before a link or a fetched value, in every persona language. */
export const ACCESS_INFO_LEAD: Readonly<Record<PersonaLanguage, string>> = {
  tr: 'Güncel erişim bilgisi:',
  en: 'Current access information:',
  de: 'Aktuelle Zugangsinformation:',
  fr: 'Informations d’accès actuelles :',
  es: 'Información de acceso actual:',
};

/** A fixed link as it is said: the workspace's sentence with the link, or the lead-in and the link. */
export function fixedLinkText(
  fixedText: string | null,
  url: string,
  language: PersonaLanguage | null,
): string {
  const own = fixedText === null ? null : cleanAccessText(fixedText);
  if (own === null) return `${ACCESS_INFO_LEAD[language ?? 'tr']} ${url}`;
  return own.includes(url) ? own : `${own} ${url}`;
}

/** A source as it is said: a rule row's title and value; anything else, its text. */
async function sourceText(tx: TenantClient, source: KnowledgeSource): Promise<string | null> {
  if (source.sourceTable === KNOWLEDGE_TABLE_SQL_NAMES.rules && source.sourceRowId !== null) {
    const rule = await tx.kbRule.findFirst({ where: { id: source.sourceRowId } });
    const value =
      rule === null
        ? null
        : rule.valueText?.trim() ||
          (rule.numericValue === null
            ? null
            : [rule.numericValue.toString(), rule.unit?.trim()].filter(Boolean).join(' '));
    if (rule !== null && value) return cleanAccessText(`${rule.title.trim()}: ${value}`);
  }
  return source.content === null ? null : cleanAccessText(source.content);
}

type ReadSetting =
  | { setting: null }
  | { setting: AiAccessInfo; source: 'gone' | 'not_served' | 'empty' | { text: string } | null };

export interface AccessInfoResolverOptions {
  fetcher?: AccessInfoFetcher;
  /** The cache's clock (default the wall clock); a test moves it. */
  clock?: () => Date;
  /** Default {@link ACCESS_INFO_FAILURE_BACKOFF_MS}; a test sets 0. */
  failureBackoffMs?: number;
}

const BACKOFF_ENTRIES_MAX = 1_000;

export class AccessInfoResolver implements AccessInfoSource {
  readonly #fetcher: AccessInfoFetcher;
  readonly #clock: () => Date;
  readonly #backoffMs: number;
  /** One fetch per setting and URL at a time (keyed `"<id> <url>"` — a URL holds no space). */
  readonly #inflight = new Map<string, Promise<AccessInfoFetch>>();
  /** When a setting's URL last failed, and how. */
  readonly #failed = new Map<string, { at: number; fetch: AccessInfoFetch }>();

  constructor(options: AccessInfoResolverOptions = {}) {
    this.#fetcher = options.fetcher ?? createAccessInfoFetcher();
    this.#clock = options.clock ?? (() => new Date());
    this.#backoffMs = options.failureBackoffMs ?? ACCESS_INFO_FAILURE_BACKOFF_MS;
  }

  async resolve(input: AccessInfoRead): Promise<AccessAnswer> {
    const read = await input.db(async (tx): Promise<ReadSetting> => {
      const setting = await readAiAccessInfo(tx, { brandId: input.brandId });
      if (setting === null) return { setting: null };
      if (setting.sourceType !== 'kb_row' || setting.kbSourceId === null) {
        return { setting, source: null };
      }
      const source = await tx.knowledgeSource.findFirst({ where: { id: setting.kbSourceId } });
      if (source === null) return { setting, source: 'gone' };
      const serves = knowledgeSourceServes(
        {
          audiences: source.audiences,
          aiAgentIds: source.aiAgentIds,
          brandIds: source.brandIds,
          validUntil: source.validUntil,
        },
        { audience: 'ai_agent', aiAgentId: input.aiAgentId, brandId: input.brandId },
        input.now,
      );
      if (!serves) return { setting, source: 'not_served' };
      const text = await sourceText(tx, source);
      return { setting, source: text === null ? 'empty' : { text } };
    });

    if (read.setting === null) return { kind: 'none', sourceType: null, reason: 'no_setting' };
    const { setting } = read;
    switch (setting.sourceType) {
      case 'fixed_link':
        if (setting.url === null) break;
        return {
          kind: 'answer',
          text: fixedLinkText(setting.fixedText, setting.url, input.language),
          sourceType: 'fixed_link',
          served: 'fixed',
        };
      case 'kb_row': {
        const { source } = read;
        if (source !== null && typeof source === 'object') {
          return { kind: 'answer', text: source.text, sourceType: 'kb_row', served: 'source' };
        }
        const reason: AccessNoAnswer =
          source === 'not_served'
            ? 'source_not_served'
            : source === 'empty'
              ? 'source_empty'
              : 'source_gone';
        return { kind: 'none', sourceType: 'kb_row', reason };
      }
      case 'dynamic_url':
        if (setting.url === null) break;
        return this.#dynamic(setting, setting.url, input);
    }
    // A row the CHECK constraint would have refused: nothing it says can be trusted.
    return { kind: 'none', sourceType: null, reason: 'no_setting' };
  }

  async #dynamic(setting: AiAccessInfo, url: string, input: AccessInfoRead): Promise<AccessAnswer> {
    const lead = ACCESS_INFO_LEAD[input.language ?? 'tr'];
    const said = (value: string, served: AccessAnswerServed, failure?: AccessInfoFetchFailure) =>
      ({
        kind: 'answer',
        text: `${lead} ${value}`,
        sourceType: 'dynamic_url',
        served,
        ...(failure ? { failure } : {}),
      }) as const;

    const now = this.#clock();
    const last = setting.lastValue === null ? null : cleanAccessText(setting.lastValue);
    if (
      last !== null &&
      setting.lastFetchedAt !== null &&
      now.getTime() - setting.lastFetchedAt.getTime() < setting.cacheSeconds * 1000
    ) {
      return said(last, 'cached');
    }

    const fetched = await this.#fetchOnce(setting.id, url, now);
    if (fetched.ok) {
      // A simulation leaves the cache as it found it (tm 314.2): its runner
      // is read-only, and a test turn writes no row of the workspace's.
      if (simulationScope() === null) {
        await input.db((tx) =>
          tx.aiAccessInfo.updateMany({
            where: { id: setting.id, sourceType: 'dynamic_url', url },
            data: { lastValue: fetched.value, lastFetchedAt: this.#clock() },
          }),
        );
      }
      return said(fetched.value, 'fetched');
    }
    if (last !== null) return said(last, 'last_value', fetched.failure);
    return {
      kind: 'none',
      sourceType: 'dynamic_url',
      reason: 'fetch_failed',
      failure: fetched.failure,
    };
  }

  /** The fetch, shared by the turns that ask at once, and not repeated while it is failing. */
  async #fetchOnce(id: string, url: string, now: Date): Promise<AccessInfoFetch> {
    const key = `${id} ${url}`;
    const failed = this.#failed.get(key);
    if (failed !== undefined && now.getTime() - failed.at < this.#backoffMs) return failed.fetch;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;

    const fetch = this.#fetcher
      .fetch(url)
      .catch((): AccessInfoFetch => ({ ok: false, failure: 'network' }));
    this.#inflight.set(key, fetch);
    try {
      const result = await fetch;
      if (result.ok) {
        this.#failed.delete(key);
      } else {
        if (this.#failed.size >= BACKOFF_ENTRIES_MAX) this.#failed.clear();
        this.#failed.set(key, { at: this.#clock().getTime(), fetch: result });
      }
      return result;
    } finally {
      this.#inflight.delete(key);
    }
  }
}
