/**
 * Finding the fixture the write scenarios drive.
 *
 * Shared by `rest.js` and `rtm.js` because the lookup is not obvious and two
 * copies of a non-obvious lookup drift: the seed's one live conversation is
 * `agentId: null` **and** `active: true`, which `prisma/seed.ts#createConversation`
 * turns into `queuePosition: 1` — so it is `view=queued` that finds it, never
 * `view=unassigned`. A second copy that guessed `unassigned` would fail with
 * "no chat" against a perfectly good seed.
 */
import { fail } from 'k6';
import { CONFIG } from './config.js';
import { get } from './http.js';
import { authHeaders } from './session.js';
import { OP_TAGS } from './thresholds.js';

/**
 * The seeded workspace's one live chat.
 *
 * Resolved once per run, in `setup()`, and handed to every VU: a target found
 * once is a target guaranteed to still be active for the whole run, whereas
 * re-discovering it every iteration would have to defend against a run that
 * changes which chat is queued — which a write scenario does, by writing.
 *
 * Tagged `setup`, like sign-in: a one-off lookup must not drag a latency budget
 * that is meant to describe one endpoint under load.
 */
export function findQueuedChatId(session) {
  const url = `${CONFIG.apiBaseUrl}/chats?view=queued&limit=1`;
  const response = get(url, OP_TAGS.setup, { headers: authHeaders(session) });
  if (response.status !== 200) {
    fail(
      `GET /chats?view=queued failed: ${response.status} ${String(response.body).slice(0, 300)}`,
    );
  }

  const items = response.json('items') ?? [];
  const chatId = items[0]?.id;
  if (!chatId) {
    fail(
      'no queued chat in the seeded workspace — the write scenarios drive the conversation ' +
        '`prisma/seed.ts#seedConversations` leaves live; run `pnpm db:seed` first (or ' +
        '`pnpm db:reset` if a previous run against this database archived it)',
    );
  }
  return chatId;
}
