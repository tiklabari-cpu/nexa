/**
 * The suite's own sentinel: what the shared workspace looks like once every
 * other spec has had its turn (tm 247).
 *
 * Named to sort last. Playwright runs files in path order with `workers: 1`, so
 * `zz-` is the whole scheduling mechanism — no config, no project, nothing for
 * a future file to remember to update.
 *
 * Why it exists. This suite shares one seeded database and runs serially, so a
 * spec that writes shared state and does not put it back charges the bill to
 * whichever spec happens to read that state later. The class has now cost three
 * rounds: tm 147 (an availability left off took two palette tests and
 * `skills-routing.spec.ts` down with it), tm 233 / §D160 (four reds, four
 * separate mechanisms, one of them a real product defect), and tm 247 / §D163
 * (`command-palette.spec.ts:131` and `tickets.spec.ts:226`, red twice in a full
 * run and green on their own). Each round fixed its examples; none of them left
 * anything behind that would *notice* the next one.
 *
 * So this file asserts the invariants the rest of the suite silently depends on
 * and states them in its own name. A future spec that breaks one gets a red
 * here — at the end, next to the invariant it broke — instead of an unrelated
 * spec twenty files later reporting a product defect that does not exist.
 *
 * It deliberately asserts only what the suite can actually hold. Chat capacity
 * is not in that set: tm 233 measured the run ending with agents at and over
 * their `concurrent_chats_limit` in three consecutive green runs, because the
 * only way to prevent that is for every spec to close its own conversations.
 * That accumulation is reported below rather than asserted, so the next window
 * inherits the measurement instead of taking it by hand again.
 */
import {
  allChats,
  API_BASE,
  chatOfAReachableCustomer,
  expect,
  ownerAccessToken,
  test,
} from './fixtures.js';

interface RosterAgent {
  id: string;
  name: string;
  routing_status: string;
  concurrent_chats_limit: number;
}

test.describe('suite state after every other spec (tm 247)', () => {
  test('nobody was left refusing chats', async ({ request }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

    const response = await request.get(`${API_BASE}/agents`, { headers: auth });
    expect(response.ok(), `roster read failed: ${response.status()}`).toBe(true);
    const roster = ((await response.json()) as { items: RosterAgent[] }).items;

    // The census first, so it is in the log whatever the assertions do.
    const held = new Map<string, number>();
    for (const chat of await allChats(request, auth)) {
      if (!chat.active || !chat.assignee_id) continue;
      held.set(chat.assignee_id, (held.get(chat.assignee_id) ?? 0) + 1);
    }
    const census = roster
      .map(
        (agent) =>
          `${agent.name}: ${agent.routing_status}, ${held.get(agent.id) ?? 0}/${agent.concurrent_chats_limit} chats`,
      )
      .join(' · ');
    console.log(`suite end state — ${census}`);

    // The invariant: routing needs somebody to route to, and two specs in this
    // suite turn availability off on purpose. Both put it back, and an
    // `afterEach` rather than a trailing line is what makes that survive a
    // failure in between (tm 147). This is the guard on that promise.
    const refusing = roster.filter((agent) => agent.routing_status === 'not_accepting_chats');
    expect(
      refusing.map((agent) => agent.name),
      'a spec left an agent refusing chats — every routing flow after it is now testing the wrong thing',
    ).toEqual([]);
    expect(
      roster.filter((agent) => agent.routing_status === 'accepting_chats').length,
      'no agent in the workspace accepts chats',
    ).toBeGreaterThan(0);
  });

  test('a conversation whose customer can be e-mailed still exists', async ({ request }) => {
    // What `tickets.spec.ts`'s notice picker needs, and what no amount of
    // anonymous visitors piling up at the top of the list may take away: the
    // seed's named customers keep their addresses and their conversations.
    // Resolving it here is the assertion — the helper fails loudly when the
    // directory holds nobody reachable, or nobody reachable with a chat.
    expect(await chatOfAReachableCustomer(request)).toBeTruthy();
  });
});
