/**
 * Reading the structured knowledge tables and the access information setting
 * (tm 310.1 · SiyahTuş analysis AI-13, owner decision K13; ADR-14b §2.12).
 *
 * The brand narrowing every reader of the four tables goes through. RLS is per
 * licence — a row may be several brands' (`brand_ids`), so no policy can say
 * which conversation it serves — and this is the query that does:
 * `@siyahtus/types` `knowledgeTableRowServesBrand` in Prisma's terms. An
 * every-brand row (`brand_ids` empty) serves every conversation; a brand's row
 * serves its brands; a conversation whose brand is not known reads the
 * every-brand rows only, so one brand's row never reaches another brand's
 * player by default (`brand-isolation.test.ts`, BRAND_LIST_TABLES).
 *
 * Brand priority — a brand's own row over the every-brand row of the same
 * name — is the caller's, over what this returns (`preferBrandRows`). The
 * writer (tm 310.2) and the fact resolver (tm 310.3) build on these; until
 * tm 316 versions the configuration, the AI reads the tables live through
 * here, afterwards from its published package.
 */
import type {
  AiAccessInfo,
  KbBonus,
  KbKycDocument,
  KbPaymentMethod,
  KbRule,
  Prisma,
} from '@prisma/client';
import type { KnowledgeTable } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** Each table's record as Prisma reads it. */
export interface KnowledgeTableRecords {
  payment_methods: KbPaymentMethod;
  bonuses: KbBonus;
  kyc_documents: KbKycDocument;
  rules: KbRule;
}

/** Who is reading: the conversation's brand, or null when it is not known. */
export interface KnowledgeTableReader {
  brandId: string | null;
}

/** The rows that serve `brandId` — the `brand_ids` filter, said once. */
export function knowledgeTableBrandWhere(brandId: string | null): {
  OR: Array<{ brandIds: { isEmpty: true } } | { brandIds: { has: string } }>;
} {
  return {
    OR:
      brandId === null
        ? [{ brandIds: { isEmpty: true } }]
        : [{ brandIds: { isEmpty: true } }, { brandIds: { has: brandId } }],
  };
}

const ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Array<
  Record<string, Prisma.SortOrder>
>;

/** Every row of `table` that serves the reader's brand, oldest first. */
export async function readKnowledgeTableRows<T extends KnowledgeTable>(
  tx: TenantClient,
  table: T,
  reader: KnowledgeTableReader,
): Promise<Array<KnowledgeTableRecords[T]>> {
  const where = knowledgeTableBrandWhere(reader.brandId);
  let rows: Array<KnowledgeTableRecords[KnowledgeTable]>;
  switch (table) {
    case 'payment_methods':
      rows = await tx.kbPaymentMethod.findMany({ where, orderBy: ORDER });
      break;
    case 'bonuses':
      rows = await tx.kbBonus.findMany({ where, orderBy: ORDER });
      break;
    case 'kyc_documents':
      rows = await tx.kbKycDocument.findMany({ where, orderBy: ORDER });
      break;
    default:
      rows = await tx.kbRule.findMany({ where, orderBy: ORDER });
  }
  return rows as Array<KnowledgeTableRecords[T]>;
}

/**
 * The access information that applies to a conversation of `brandId` (K13):
 * the brand's own row, else the every-brand row, else none — and none means
 * the AI has nothing it may say about access (it hands over).
 */
export async function readAiAccessInfo(
  tx: TenantClient,
  reader: KnowledgeTableReader,
): Promise<AiAccessInfo | null> {
  const rows = await tx.aiAccessInfo.findMany({
    where:
      reader.brandId === null
        ? { brandId: null }
        : { OR: [{ brandId: null }, { brandId: reader.brandId }] },
  });
  return rows.find((row) => row.brandId !== null) ?? rows[0] ?? null;
}
