/**
 * A card in a conversation (`rich_message`, EN-02 · tm 353), checked where
 * every event is appended — so it holds for whoever sends one: an agent
 * through the API, a rule bot, the AI (AI-08's output check, at the send).
 *
 * The rule (EN-02 karar 1, G9/G10): a card in a conversation may send a
 * message or open an address on one of the workspace's trusted domains, and
 * nothing else. A coupon, or a link to anywhere, is a campaign's to give —
 * reviewed by a person and counted — never something the AI or an
 * integration drops into a chat. The trusted domains are read at the send,
 * not when the card was written: a domain removed since stops being linkable.
 *
 * The event's text is the card's plain twin unless the sender wrote one —
 * what a channel that cannot draw a card sends, and what search and the
 * transcript e-mail read.
 */
import {
  describeRichCardProblem,
  normalizeRichCard,
  richCardFallbackText,
  richCardProblems,
  type RichCard,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';

export async function checkedConversationCard(
  tx: TenantClient,
  licenseId: bigint,
  raw: unknown,
  text: string | undefined,
): Promise<{ card: RichCard; text: string }> {
  const card = normalizeRichCard(raw);
  const trusted = await tx.trustedDomain.findMany({
    where: { licenseId },
    select: { domain: true, includeSubdomains: true },
  });
  const problems = richCardProblems(card, {
    source: 'conversation',
    trustedHosts: trusted.map((row) => ({
      domain: row.domain,
      include_subdomains: row.includeSubdomains,
    })),
  });
  if (problems.length > 0 || !card) {
    const sentences = problems.map(
      (problem) => `properties.card.${describeRichCardProblem(problem)}`,
    );
    throw ApiError.validation(sentences[0] ?? 'properties.card: a rich_message needs a card.', {
      fields: problems.map((problem, index) => ({
        field: `properties.card.${problem.field}`,
        message: sentences[index]!,
      })),
    });
  }
  return { card, text: text?.trim() || richCardFallbackText(card) };
}
