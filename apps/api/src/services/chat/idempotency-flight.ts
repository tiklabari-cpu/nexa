/**
 * One send per idempotency key at a time (tm 448 · audit F27).
 *
 * A send carrying an `idempotency_key` remembers the event it wrote under the
 * key once its transaction has committed (`idem:…`, read by the retry). Before
 * this, nothing marked the key while the first request was still writing: a
 * retry arriving in that window found no event to replay, wrote the message a
 * second time — and a visitor's second copy asked the AI for a second turn.
 *
 * The send now claims the key's *flight* (`SET NX`) before its transaction and
 * gives it back after the committed event is remembered, or when the send
 * fails. A request that cannot claim it waits a moment for the holder — a few
 * short polls, each asking whether the holder's event is in yet — and then
 * either replays that event or answers `409 idempotency_in_flight`, having
 * written nothing. The client sends the same key again shortly.
 *
 * The flight lives on its own key, beside the remembered event rather than in
 * it, because a visitor's chat is decided inside the transaction: the visitor
 * path cannot name the event's key before it starts, so its flight is the
 * member's (`customer:<id>`), the agent path's the chat's (`chat:<id>`). The
 * event key keeps the one meaning every reader already relies on — an event id.
 *
 * The flight expires on its own after {@link FLIGHT_TTL_SECONDS}: longer than
 * the two transaction attempts a send can make (10 s each, `withTenant`), so a
 * holder that is still working never loses it, while one whose process died
 * blocks its key for a minute at most. Only its holder can give it back (the
 * token), so a holder that somehow outlived it cannot release a successor's.
 *
 * Redis errors on the claim propagate — the request fails, as it did when the
 * replay read before its transaction failed. A failed release is swallowed:
 * the flight then lapses with its TTL.
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';

/** The Redis commands a flight needs (an `ioredis` client satisfies it). */
export interface FlightRedis {
  set(key: string, value: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<string | null>;
  /**
   * Gives the flight back. Optional so a service built with a minimal Redis
   * double still constructs; without it a flight lapses with its TTL.
   */
  eval?(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/** How long an unreleased flight blocks its key. */
export const FLIGHT_TTL_SECONDS = 60;
/** How many times a request that found the key in flight looks again. */
export const FLIGHT_POLLS = 3;
/** The wait before each look. */
export const FLIGHT_POLL_MS = 100;

/** Delete only if the holder is still the caller — the scheduler lock's release. */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Where a key's flight lives: per chat (agent, bot) or per member (visitor). */
export function flightName(
  licenseId: bigint,
  owner: { chatId: string } | { customerId: string },
  key: string,
): string {
  const scope = 'chatId' in owner ? `chat:${owner.chatId}` : `customer:${owner.customerId}`;
  return `idem-flight:${licenseId}:${scope}:${key}`;
}

/** The 409 for a key an earlier request is still writing. */
export function idempotencyInFlight(): ApiError {
  return new ApiError(
    'idempotency_in_flight',
    'An earlier request with this idempotency_key is still being processed. Send it again shortly.',
    { headers: { 'Retry-After': '1' } },
  );
}

/** A claimed flight; `release` never throws. */
export interface Flight {
  release(): Promise<void>;
}

/**
 * Claim `name` for this request, or wait briefly for the request holding it.
 *
 * `finished` reads what the holder leaves behind — the remembered event, or
 * null while there is none (or when the caller cannot read it before its
 * transaction, as on the visitor path). It is asked after every poll, and once
 * more after a claim succeeds: the holder may have finished between the
 * caller's own read and the claim, and the remembered event outlives the
 * flight, so a replay found then is returned and the flight given back.
 */
export async function claimFlight<T>(
  redis: FlightRedis,
  name: string,
  finished: () => Promise<T | null>,
  options: { polls?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ flight: Flight } | { replay: T }> {
  const polls = options.polls ?? FLIGHT_POLLS;
  const pollMs = options.pollMs ?? FLIGHT_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const token = randomUUID();
  const flight: Flight = {
    release: async () => {
      try {
        await redis.eval?.(RELEASE_LUA, 1, name, token);
      } catch {
        // The flight lapses with its TTL; a retry meanwhile is a 409.
      }
    },
  };

  for (let attempt = 0; ; attempt += 1) {
    if ((await redis.set(name, token, 'EX', FLIGHT_TTL_SECONDS, 'NX')) === 'OK') {
      const replay = await finished().catch(async (error: unknown) => {
        await flight.release();
        throw error;
      });
      if (replay !== null) {
        await flight.release();
        return { replay };
      }
      return { flight };
    }
    if (attempt >= polls) throw idempotencyInFlight();
    await sleep(pollMs);
    const replay = await finished();
    if (replay !== null) return { replay };
  }
}
