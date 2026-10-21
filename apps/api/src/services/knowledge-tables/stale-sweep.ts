/**
 * The stale-row sweep of the structured knowledge tables (tm 310.5 ·
 * SiyahTuş analysis AI-13-S2).
 *
 * A row is due for review `review_interval_days` after `reviewed_at` (payment
 * methods 14, bonuses 30 and at `active_to`, KYC and rules 90). The panel
 * already marks such a row on every read (`stale`, `review_due_at`); this sweep
 * is the other half — it *tells* the workspace: one e-mail digest to the owner,
 * the vice-owners and the admins, naming the rows that have newly fallen due.
 * The AI keeps using a stale row (the "eskimişi kullanma" switch is off by
 * default and not built), so the notice is a request for a look, not a warning
 * that anything stopped.
 *
 * **Exactly once per lapse.** Every stale row is *claimed* with one
 * `INSERT … ON CONFLICT DO NOTHING` on `knowledge_table_stale_notices`, keyed
 * by the workspace, table, row and the due moment. Only rows whose claim
 * landed are announced, so the scan can run on every tick (and on as many API
 * processes) without telling anybody twice. The claim is written before the
 * mail goes out: a mail that fails to send is counted, not retried — the same
 * "at most one" rule the AI usage alerts follow. A reviewed row has a new due
 * moment, so when it lapses again it is a new claim; the old claim of a row
 * that is no longer stale (reviewed, or deleted) is dropped in the same pass.
 *
 * Like `sla-sweep.ts` it walks every workspace through the shared SECURITY
 * DEFINER enumerator and reads each one inside its own tenant transaction, so
 * one workspace's rows can neither be seen nor announced by another's pass.
 * Only members who may open the Playbook are mailed — owner, vice-owner and
 * admin who are not suspended — and each one's e-mail switch (`notify_email`)
 * is honoured.
 */
import type { PrismaClient } from '@prisma/client';
import {
  KNOWLEDGE_TABLES,
  knowledgeTableRowReviewDueAt,
  type KnowledgeTable,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { deliver, isCapRefusal } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { knowledgeStaleMail } from '../mail/templates/messages.js';
import { listKnowledgeTableRecords, type KnowledgeTableRecords } from './rows.js';

/** The roles that may open the Playbook's tables — and so receive its notices. */
export const KNOWLEDGE_STALE_NOTICE_ROLES = ['owner', 'viceowner', 'admin'] as const;

/** How many row names the digest spells out. */
const SAMPLE_SIZE = 10;

const TABLE_LABELS: Readonly<Record<KnowledgeTable, { tr: string; en: string }>> = Object.freeze({
  payment_methods: { tr: 'Ödeme yöntemleri', en: 'Payment methods' },
  bonuses: { tr: 'Bonuslar', en: 'Bonuses' },
  kyc_documents: { tr: 'KYC belgeleri', en: 'KYC documents' },
  rules: { tr: 'Limitler ve kurallar', en: 'Limits and rules' },
});

/** What a row is called in the digest — the name its author gave it. */
function rowLabel(table: KnowledgeTable, record: KnowledgeTableRecords[KnowledgeTable]): string {
  switch (table) {
    case 'kyc_documents':
      return (record as KnowledgeTableRecords['kyc_documents']).docType;
    case 'rules':
      return (record as KnowledgeTableRecords['rules']).title;
    default:
      return (record as KnowledgeTableRecords['payment_methods']).name;
  }
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export interface TenantStaleResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** Rows past their due moment this pass, announced or not. */
  stale: number;
  /** Rows whose claim landed this pass — the ones the digest names. */
  announced: number;
  mailed: number;
  mailFailed: number;
}

export interface KnowledgeStaleReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantStaleResult[];
  totals: { tenants: number; stale: number; announced: number; mailed: number; mailFailed: number };
}

interface StaleRow {
  table: KnowledgeTable;
  id: string;
  label: string;
  dueAt: Date;
}

interface Recipient {
  email: string;
  locale: MailLocale;
}

export class KnowledgeTableStaleSweeper {
  readonly #db: PrismaClient;
  readonly #mailer: Mailer;
  readonly #appUrl: string | null;

  constructor(db: PrismaClient, mailer: Mailer, appUrl: string | null = null) {
    this.#db = db;
    this.#mailer = mailer;
    this.#appUrl = appUrl;
  }

  async run(options: { now?: Date } = {}): Promise<KnowledgeStaleReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;

    const results: TenantStaleResult[] = [];
    for (const tenant of tenants) results.push(await this.#sweepTenant(tenant, now));

    const sum = (pick: (result: TenantStaleResult) => number): number =>
      results.reduce((total, result) => total + pick(result), 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        stale: sum((r) => r.stale),
        announced: sum((r) => r.announced),
        mailed: sum((r) => r.mailed),
        mailFailed: sum((r) => r.mailFailed),
      },
    };
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantStaleResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const result: TenantStaleResult = {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      stale: 0,
      announced: 0,
      mailed: 0,
      mailFailed: 0,
    };

    const { stale, fresh } = await withTenant(this.#db, context, async (tx) => {
      const found: StaleRow[] = [];
      for (const table of KNOWLEDGE_TABLES) {
        const records = await listKnowledgeTableRecords(tx, table);
        for (const record of records) {
          const dueAt = knowledgeTableRowReviewDueAt(table, {
            reviewed_at: record.reviewedAt,
            review_interval_days: record.reviewIntervalDays,
            active_to: 'activeTo' in record ? record.activeTo : null,
          });
          if (dueAt.getTime() < now.getTime()) {
            found.push({ table, id: record.id, label: rowLabel(table, record), dueAt });
          }
        }
      }

      // Claims of rows that are no longer stale (reviewed, deleted) go; a row
      // that lapses again is claimed anew under its new due moment.
      await tx.knowledgeTableStaleNotice.deleteMany({
        where: { rowId: { notIn: found.map((row) => row.id) } },
      });
      if (found.length === 0) return { stale: found, fresh: [] as StaleRow[] };

      const landed = await tx.$queryRaw<Array<{ table_name: string; row_id: string }>>`
        INSERT INTO knowledge_table_stale_notices (id, license_id, table_name, row_id, due_at)
        SELECT gen_random_uuid(), ${context.licenseId}, claim.table_name, claim.row_id,
               claim.due_at
          FROM unnest(
            ${found.map((row) => row.table)}::text[],
            ${found.map((row) => row.id)}::uuid[],
            ${found.map((row) => row.dueAt.toISOString())}::timestamptz[]
          ) AS claim(table_name, row_id, due_at)
        ON CONFLICT (license_id, table_name, row_id, due_at) DO NOTHING
        RETURNING table_name, row_id::text AS row_id`;
      const won = new Set(landed.map((row) => `${row.table_name}:${row.row_id}`));
      return {
        stale: found,
        fresh: found.filter((row) => won.has(`${row.table}:${row.id}`)),
      };
    });

    result.stale = stale.length;
    result.announced = fresh.length;
    if (fresh.length === 0) return result;

    const { recipients, workspaceName } = await this.#recipients(context);
    for (const recipient of recipients) {
      const locale = recipient.locale;
      const labels = (table: KnowledgeTable): string =>
        locale === 'tr' ? TABLE_LABELS[table].tr : TABLE_LABELS[table].en;
      const groups = KNOWLEDGE_TABLES.map((table) => ({
        label: labels(table),
        count: fresh.filter((row) => row.table === table).length,
      })).filter((group) => group.count > 0);
      const outcome = await deliver(this.#mailer, {
        to: recipient.email,
        licenseId: context.licenseId,
        ...knowledgeStaleMail(
          { locale, ...(this.#appUrl ? { appUrl: this.#appUrl } : {}) },
          {
            workspaceName,
            groups,
            sample: fresh.slice(0, SAMPLE_SIZE).map((row) => row.label),
            total: fresh.length,
            tablesUrl: this.#appUrl ? `${this.#appUrl}/app/playbook` : null,
          },
        ),
        kind: 'notification',
      });
      if (outcome.status === 'sent') result.mailed += 1;
      else if (!isCapRefusal(outcome)) result.mailFailed += 1;
    }
    return result;
  }

  /** The members who may open the tables, with an address and the e-mail switch on. */
  async #recipients(
    context: TenantContext,
  ): Promise<{ recipients: Recipient[]; workspaceName: string }> {
    return withTenant(this.#db, context, async (tx) => {
      const [members, organization] = await Promise.all([
        tx.agentMembership.findMany({
          where: {
            licenseId: context.licenseId,
            suspended: false,
            notifyEmail: true,
            role: { in: [...KNOWLEDGE_STALE_NOTICE_ROLES] },
          },
          orderBy: { createdAt: 'asc' },
          select: { locale: true, agent: { select: { email: true } } },
        }),
        tx.organization.findUnique({
          where: { id: context.organizationId },
          select: { name: true },
        }),
      ]);
      const recipients: Recipient[] = [];
      for (const member of members) {
        const email = member.agent.email;
        if (email)
          recipients.push({ email, locale: isMailLocale(member.locale) ? member.locale : 'en' });
      }
      return { recipients, workspaceName: organization?.name ?? 'SiyahTuş' };
    });
  }
}
