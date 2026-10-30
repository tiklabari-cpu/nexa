/**
 * The player's own copy, asked for from the widget (WG-06 · tm 345).
 *
 * K26: a closing chat no longer mails the player; the widget's "E-mail me the
 * transcript" asks for it here. The decisions — which connection, which
 * address, how often — live in this module; the route
 * (`POST /customer/chat/transcript`) puts them in order and hands the mail
 * over. The copy is the player's AR-04 copy (`renderTranscript`, audience
 * `customer`): the `all`-recipient lines only, so an internal note never
 * reaches it, read by `transcriptLines`, which filters them in SQL as well.
 */
import { TRANSCRIPT_REQUESTS_PER_CHAT, emailDomain } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { TranscriptScope } from './transcript-export.js';

/** A connection's copy may be asked for again within this window, up to the per-chat count. */
const PER_CHAT_WINDOW_MS = 24 * 3_600_000;

/** The player's latest connection, as `transcriptLines` reads it. */
export interface RequestedTranscript extends Pick<
  TranscriptScope,
  'threadId' | 'customer' | 'contactVisible'
> {
  chatId: string;
}

/**
 * The visitor's latest connection — open or closed, never one of another
 * visitor's (`customerId` comes from the token; RLS scopes the workspace) —
 * or a 404 when they have not had a conversation yet.
 */
export async function latestTranscript(
  tx: TenantClient,
  customerId: string,
): Promise<RequestedTranscript> {
  const thread = await tx.thread.findFirst({
    where: { chat: { customerId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      chatId: true,
      chat: {
        select: { customer: { select: { name: true, email: true, username: true, locale: true } } },
      },
    },
  });
  if (!thread || !thread.chat.customer) throw ApiError.notFound('There is no conversation yet.');
  return {
    chatId: thread.chatId,
    threadId: thread.id,
    customer: thread.chat.customer,
    // The player's own conversation: their own address and name read as written.
    contactVisible: true,
  };
}

/**
 * Where the copy goes: the address the player typed, else the one they gave
 * before. Neither is a 400 the widget answers by asking for one.
 */
export function transcriptRequestAddress(
  given: string | undefined,
  stored: string | null,
): { to: string; domain: string; toStored: boolean } {
  const storedAddress = stored?.trim() ? stored.trim() : null;
  const to = given?.trim() ? given.trim() : storedAddress;
  if (to === null) {
    throw ApiError.validation('There is no e-mail address to send the transcript to.', {
      reason: 'no_player_address',
    });
  }
  const domain = emailDomain(to);
  if (domain === null) {
    throw ApiError.validation('email: not an e-mail address.', {
      fields: [{ field: 'email', message: 'not an e-mail address' }],
    });
  }
  return {
    to,
    domain,
    toStored: storedAddress !== null && to.toLowerCase() === storedAddress.toLowerCase(),
  };
}

/**
 * At most {@link TRANSCRIPT_REQUESTS_PER_CHAT} copies of one connection, so a
 * typed address cannot be flooded with the same conversation (the per-hour
 * visitor budget is the route's). A limiter that cannot answer lets the copy
 * through, as every press budget does.
 */
export async function spendTranscriptRequest(
  limiter: {
    consume(
      key: string,
      limit: number,
      windowMs: number,
    ): Promise<{ allowed: boolean; resetMs: number }>;
  },
  organizationId: string,
  threadId: string,
  onUnavailable: (error: unknown) => void,
): Promise<void> {
  let decision: { allowed: boolean; resetMs: number };
  try {
    decision = await limiter.consume(
      `rl:transcript-request:${organizationId}:${threadId}`,
      TRANSCRIPT_REQUESTS_PER_CHAT,
      PER_CHAT_WINDOW_MS,
    );
  } catch (error) {
    onUnavailable(error);
    return;
  }
  if (!decision.allowed) {
    throw ApiError.tooManyRequests(
      Math.max(1, Math.ceil(decision.resetMs / 1000)),
      'This conversation has been sent too many times.',
    );
  }
}

/**
 * The domains the workspace has proven it controls (NFR-S11): an SSO domain
 * with a returned challenge, still on its connection's claim list — the
 * intersection just-in-time provisioning trusts. Forwarding internal notes
 * (WG-06 Q2) is allowed only to these; a workspace without SSO has none, so
 * the setting is refused there.
 */
export async function readVerifiedMailDomains(tx: TenantClient): Promise<string[]> {
  const rows = await tx.ssoDomainVerification.findMany({
    where: { verifiedAt: { not: null } },
    select: { domain: true, connection: { select: { verifiedDomains: true } } },
  });
  return [
    ...new Set(
      rows.filter((r) => r.connection.verifiedDomains.includes(r.domain)).map((r) => r.domain),
    ),
  ];
}
