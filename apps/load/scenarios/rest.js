/**
 * The realistic REST mix — inbox list, transcript, reply — that NFR-P2 is
 * measured against. Read and write are separate budgets (150 ms / 300 ms
 * p99), and this is the scenario that drives both:
 *   - `GET /chats?view=all&limit=25`      — the inbox list          (op:read)
 *   - `GET /chats/:id/events`             — opening a transcript    (op:read)
 *   - `POST /chats/:id/events`            — an agent's reply        (op:write)
 *
 * `setup()` resolves ONE chat to reply into: `prisma/seed.ts#seedConversations`
 * leaves exactly one active, unassigned-but-queued conversation per richDemo
 * tenant (`agentId: null` + `active: true` sets `queuePosition: 1`, never
 * `null` — so `view=queued`, not `view=unassigned`, is what finds it). Doing
 * that lookup once means every VU replies into a chat that is guaranteed to
 * still be active for the whole run — the alternative, re-discovering a target
 * from the list on every iteration, would have to defend against a run that
 * ever changes which chat is queued.
 *
 * Rate limit: even at the default profile (2 VU, 3 requests/iteration), this
 * scenario asks for 360 req/min against the 180/min agent cap (ADR-07) — see
 * README §"Staying under the rate limit". The chosen fix is the *raised
 * limit* option, not several seeded agents: a tenant only has three
 * identities (owner + 2 agents), so spreading VUs across them caps headroom
 * at 3× no matter how the profile is tuned, and re-deciding the strategy the
 * moment someone raises `LOAD_VUS` is worse than a documented precondition.
 * Run the stack under test with `RATE_LIMIT_AGENT_PER_MIN` raised past
 * `LOAD_VUS ÷ LOAD_PACING_SECONDS × 60 × 3` — `apps/e2e` already does the
 * equivalent for `RATE_LIMIT_ANON_PER_MIN` (`playwright.config.ts`). The
 * shared `nexa_rate_limited count==0` threshold is what catches an operator
 * who forgets: an unraised limit turns this run red, not quietly optimistic.
 */
import { check, fail, sleep } from 'k6';
import { CONFIG, stages } from '../lib/config.js';
import { get, postJson } from '../lib/http.js';
import { authHeaders, signIn } from '../lib/session.js';
import { OP_TAGS, restThresholds, SUMMARY_TREND_STATS } from '../lib/thresholds.js';
import { summaryHandler } from '../lib/summary.js';

export const options = {
  scenarios: {
    rest: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '5s' },
  },
  // This scenario drives both REST budgets, unlike read-only smoke.js.
  thresholds: restThresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

const listUrl = `${CONFIG.apiBaseUrl}/chats?view=all&limit=25`;

/**
 * The seed's one active conversation, found by the view that matches its
 * exact state (queued, unassigned) rather than by scanning `view=all` and
 * hoping it lands within the first page. Tagged `setup`, like sign-in — a
 * one-off lookup that happens once per run, not per VU, must stay out of the
 * `op:read` budget it would otherwise drag with three sequential round trips.
 */
function findQueuedChatId(session) {
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
      'no queued chat in the seeded workspace — rest.js replies into the conversation ' +
        '`prisma/seed.ts#seedConversations` leaves live; run `pnpm db:seed` first (or ' +
        '`pnpm db:reset` if a previous run against this database archived it)',
    );
  }
  return chatId;
}

/** Runs once, before any VU. Every call here is tagged `setup` — see the module doc. */
export function setup() {
  const ready = get(CONFIG.healthUrl, OP_TAGS.setup);
  if (!check(ready, { 'stack is ready': (r) => r.status === 200 })) {
    fail(`${CONFIG.healthUrl} answered ${ready.status} — is the stack up? (README §Running)`);
  }

  const session = signIn();
  const chatId = findQueuedChatId(session);
  return { session, chatId };
}

export default function ({ session, chatId }) {
  const headers = authHeaders(session);

  const list = get(listUrl, OP_TAGS.read, { headers });
  check(list, {
    'GET /chats is 200': (r) => r.status === 200,
    'GET /chats returns a list': (r) => Array.isArray(r.json('items')),
  });

  const transcript = get(`${CONFIG.apiBaseUrl}/chats/${chatId}/events?limit=50`, OP_TAGS.read, {
    headers,
  });
  check(transcript, {
    'GET /chats/:id/events is 200': (r) => r.status === 200,
    'GET /chats/:id/events returns a list': (r) => Array.isArray(r.json('items')),
  });

  const reply = postJson(
    `${CONFIG.apiBaseUrl}/chats/${chatId}/events`,
    { type: 'message', text: `load rest.js — VU ${__VU} iter ${__ITER}` },
    OP_TAGS.write,
    { headers },
  );
  check(reply, {
    'POST /chats/:id/events is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  sleep(CONFIG.pacingSeconds);
}

export const handleSummary = summaryHandler('rest');
