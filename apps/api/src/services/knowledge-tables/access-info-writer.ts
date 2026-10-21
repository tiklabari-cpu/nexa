/**
 * Writing the access information setting (tm 310.4 · K13): `PUT
 * /ai-access-info` replaces one brand's setting, or the every-brand one, whole.
 *
 * The validator (`validateAiAccessInfo`) judges the fields; what only the
 * database can say joins the same `details.problems` list — a brand that is
 * not this workspace's, a knowledge source that is not one of its sources or
 * is not for the AI (Copilot-only) — and so does a `dynamic_url` whose host
 * is a literal private, loopback or link-local address or names this machine
 * (`assertPublicHttpUrl`). That check here is only early: a name can resolve
 * anywhere later, so the fetch checks again every time
 * (`access-info.ts`).
 *
 * A setting that changes its source type or URL drops the last fetched value
 * — it was another URL's answer. The write goes through `config-draft.ts`;
 * a workspace writes one setting at a time (a transaction-scoped advisory
 * lock), so two first saves of the same brand cannot both insert.
 */
import type { AiAccessInfo } from '@prisma/client';
import {
  AI_ACCESS_INFO_CACHE_SECONDS,
  isUuid,
  validateAiAccessInfo,
  type AiAccessInfoRow,
  type AiAccessInfoSourceType,
  type KnowledgeTableProblem,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { assertPublicHttpUrl } from '../../lib/ssrf.js';
import type { TenantClient } from '../../lib/tenant.js';
import { createAiAccessInfoDraft, updateAiAccessInfoDraft } from '../ai/config-draft.js';
import type { KnowledgeTableWriter } from './writer.js';

/** What `details.reason` says when the setting is refused for its fields. */
export const AI_ACCESS_INFO_INVALID = 'ai_access_info_invalid';

/** The fields a `PUT` may name (`AiAccessInfoUpdate`). */
export const AI_ACCESS_INFO_WRITE_FIELDS = [
  'brand_id',
  'source_type',
  'kb_source_id',
  'url',
  'cache_seconds',
  'fixed_text',
] as const;

export function serialiseAiAccessInfo(row: AiAccessInfo): AiAccessInfoRow {
  return {
    id: row.id,
    brand_id: row.brandId,
    source_type: row.sourceType as AiAccessInfoSourceType,
    kb_source_id: row.kbSourceId,
    url: row.url,
    cache_seconds: row.cacheSeconds,
    fixed_text: row.fixedText,
    last_value: row.lastValue,
    last_fetched_at: row.lastFetchedAt?.toISOString() ?? null,
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Every setting the session sees, the every-brand one first. */
export async function listAiAccessInfo(tx: TenantClient): Promise<AiAccessInfo[]> {
  const rows = await tx.aiAccessInfo.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return [...rows.filter((row) => row.brandId === null), ...rows.filter((row) => row.brandId)];
}

function refuse(problems: KnowledgeTableProblem[]): never {
  const first = problems[0];
  const said = first ? `${first.field === '' ? 'body' : first.field}: ${first.code}` : 'invalid';
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  throw ApiError.validation(`The access information was refused — ${said}${more}.`, {
    reason: AI_ACCESS_INFO_INVALID,
    problems,
  });
}

/** A text the panel left blank is not given. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function putAiAccessInfo(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  body: Readonly<Record<string, unknown>>,
): Promise<AiAccessInfo> {
  const problems: KnowledgeTableProblem[] = [
    ...Object.keys(body)
      .filter((field) => !(AI_ACCESS_INFO_WRITE_FIELDS as readonly string[]).includes(field))
      .map((field) => ({ field, code: 'invalid' as const })),
    ...validateAiAccessInfo(body),
  ];
  const has = (field: string) => problems.some((problem) => problem.field === field);
  const brandId = typeof body['brand_id'] === 'string' ? body['brand_id'] : null;
  const sourceType = body['source_type'] as AiAccessInfoSourceType;
  const kbSourceId = typeof body['kb_source_id'] === 'string' ? body['kb_source_id'] : null;
  const url = textOf(body['url']);

  if (brandId !== null && isUuid(brandId) && !has('brand_id')) {
    const brand = await tx.brand.findFirst({ where: { id: brandId }, select: { id: true } });
    if (brand === null) problems.push({ field: 'brand_id', code: 'invalid' });
  }
  if (kbSourceId !== null && isUuid(kbSourceId) && !has('kb_source_id')) {
    const source = await tx.knowledgeSource.findFirst({
      where: { id: kbSourceId },
      select: { audiences: true },
    });
    if (source === null || !source.audiences.includes('ai_agent')) {
      problems.push({ field: 'kb_source_id', code: 'invalid' });
    }
  }
  if (sourceType === 'dynamic_url' && url !== null && !has('url')) {
    try {
      assertPublicHttpUrl(url);
    } catch {
      problems.push({ field: 'url', code: 'invalid' });
    }
  }
  if (problems.length > 0) refuse(problems);

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`ai_access_info:${writer.licenseId}`}, 0))`;
  const existing = await tx.aiAccessInfo.findFirst({ where: { brandId } });
  const data = {
    sourceType,
    kbSourceId,
    url,
    cacheSeconds:
      typeof body['cache_seconds'] === 'number'
        ? body['cache_seconds']
        : AI_ACCESS_INFO_CACHE_SECONDS.default,
    fixedText: textOf(body['fixed_text']),
    updatedBy: writer.accountId,
  };
  if (existing === null) {
    return createAiAccessInfoDraft(tx, {
      licenseId: writer.licenseId,
      brandId,
      ...data,
      createdBy: writer.accountId,
    });
  }
  const sameFetch = existing.sourceType === 'dynamic_url' && sourceType === 'dynamic_url';
  const keepsCache = sameFetch && existing.url === url;
  return updateAiAccessInfoDraft(tx, existing.id, {
    ...data,
    ...(keepsCache ? {} : { lastValue: null, lastFetchedAt: null }),
  });
}
