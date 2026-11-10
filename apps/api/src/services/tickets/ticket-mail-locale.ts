/**
 * Which language a ticket's e-mail frame speaks (tm 462 · F48) — the notice a
 * status change sends, an agent's reply, and the automatic acknowledgement.
 *
 * The frame's few words and `Content-Language` follow the player, as the
 * transcript mail already does (`routes/customer.ts`):
 *   1. the player's own `customers.locale` (the widget language of their last
 *      chat) when the mail templates are written in it;
 *   2. a player whose language is some other widget language (`de`, `ar` …) gets
 *      English — the workspace's language says nothing about what *they* read;
 *   3. a player with no language on file (an e-mail sender, an imported
 *      contact) gets the workspace's: the default brand's widget language, or
 *      the fallback it names when that is `auto`;
 *   4. English when none of that is a template language.
 * Only `MAIL_LOCALES` are ever answered; translating the templates further is
 * a separate piece of work.
 */
import type { TenantClient } from '../../lib/tenant.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { defaultBrandId } from '../websites/prechat.js';

/** The workspace's language as a mail language: its default brand's widget setting. */
export async function workspaceMailLocale(tx: TenantClient): Promise<MailLocale> {
  const brandId = await defaultBrandId(tx);
  if (!brandId) return 'en';
  const row = await tx.widgetSettings.findFirst({
    where: { brandId },
    select: { language: true, fallbackLanguage: true },
  });
  if (!row) return 'en';
  const language = row.language === 'auto' ? row.fallbackLanguage : row.language;
  return isMailLocale(language) ? language : 'en';
}

/** The mail language for a player whose `locale` is `customerLocale` (null = not known). */
export async function mailLocaleFor(
  tx: TenantClient,
  customerLocale: string | null | undefined,
): Promise<MailLocale> {
  if (isMailLocale(customerLocale)) return customerLocale;
  if (customerLocale) return 'en';
  return workspaceMailLocale(tx);
}

/** The mail language for a ticket's player. */
export async function ticketMailLocale(tx: TenantClient, ticketId: string): Promise<MailLocale> {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { customer: { select: { locale: true } } },
  });
  return mailLocaleFor(tx, ticket?.customer?.locale);
}
