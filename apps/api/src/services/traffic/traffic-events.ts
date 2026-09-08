/**
 * The one place the real-time traffic board's liveness signal is emitted
 * (FR-MOD-03.1.1).
 *
 * The board used to be live only in the sense that it re-read its first page
 * every eight seconds. The PRD's acceptance criterion asks for an RTM feed —
 * Browsing → Chatting → Invited visible as it happens — and that is this: every
 * write that can move somebody between the board's funnel states publishes
 * `traffic_visitor_updated` on the licence channel the gateway already fans out
 * (ADR-15). No second protocol and no second channel; one more `action` on the
 * envelope that carries all the others, the same discipline 13.7-f applied to
 * the mobile client.
 *
 * Three properties, none of them accidental:
 *
 * **One function, so the audience is decided once.** `{ allAgents: true }` is
 * the reach `GET /traffic` already has — it rides `customers:ro`/`customers:rw`
 * and `customers:ro` sits in `DEFAULT_AGENT_SCOPES`, so every agent role holds
 * it. Spelling that audience at each call site would be five chances to spell it
 * differently, and the direction a mistake goes here is "a workspace's visitors
 * announced to somebody" rather than a missing update.
 *
 * **Nothing about the visitor travels.** The payload is one opaque customer id
 * (`TrafficVisitorUpdatedPush` says why at length): no name, no e-mail, no page,
 * no referrer, and not even the funnel bucket, which is `TrafficService#listLive`'s
 * decision over three merged sources and would be a second, disagreeing answer
 * if it were computed here. A client that wants to know what changed asks the
 * endpoint, which is scope-checked and tenant-scoped as it always was.
 *
 * **Publishing never fails the write, and never precedes the commit.** Both are
 * `RealtimePublisher`'s own guarantees, inherited rather than restated — but the
 * second one is only true if the call sits *outside* the transaction, so every
 * caller here is placed next to an existing post-commit publish rather than
 * inside the `withTenant` block it belongs to.
 */
import type { PushAudience, TrafficVisitorUpdatedPush } from '@nexa/types';
import type { TenantContext } from '../../lib/tenant.js';
import type { RealtimePublisher } from '../realtime/publisher.js';

/**
 * Every authenticated agent in the licence.
 *
 * Not a team or a chat audience, unlike every other push: the board is not a
 * conversation. A visitor who is only browsing belongs to no team and no chat,
 * so there is no narrower true answer — and narrowing it to, say, the teams on
 * the visitor's conversation would make the same person appear for some
 * colleagues and not others depending on which of the three sources they
 * currently sit in.
 */
const TRAFFIC_AUDIENCE: PushAudience = { allAgents: true };

/**
 * Announce that `customerId` may have moved on the traffic board.
 *
 * "May have": the caller does not decide, and does not have to. A publish that
 * turns out to change nothing costs one re-read of a first page that is capped
 * at 100 rows; a publish withheld because the caller guessed wrong would leave
 * the board stale until the backup poll, which is the defect this exists to fix.
 *
 * `publisher` is optional for the same reason `ChatService`'s is: several
 * services are constructed without one in tests and in the sweeps, and a board
 * signal is never worth making a construction argument mandatory for.
 */
export async function publishTrafficChange(
  publisher: RealtimePublisher | undefined,
  tenant: TenantContext,
  customerId: string,
): Promise<void> {
  const payload: TrafficVisitorUpdatedPush = { customer_id: customerId };
  await publisher?.publish(tenant, 'traffic_visitor_updated', TRAFFIC_AUDIENCE, payload);
}
