/**
 * Member recognition (SiyahTuş analysis ID-03 · owner decision K4 · tm 287) —
 * the names and numbers the api, the widget and the panel have to agree on.
 *
 * A returning visitor is recognised by a **member token** the server signs and
 * the widget keeps, never by the bare `customer_id`: whoever learns a member's
 * id must not be able to open their conversation. The token is stored first as
 * a partitioned (CHIPS) cookie the page's scripts cannot read, and in the
 * widget's localStorage only when the browser will not keep the cookie. It is
 * re-signed on every visit, so its lifetime is a time *without* a visit.
 *
 * Another device, or a browser that dropped its token, is a new customer. A
 * username or e-mail typed into the pre-chat form never joins two records on
 * its own — it surfaces the other record to agents as a *possible match*,
 * unverified, and only an agent's confirmation links them (for the agent's
 * history view; the AI's memory stays with the customer number).
 *
 * The database CHECKs (`member_recognition_settings_ttl_check`), the contract's
 * minimum/maximum and the column default are read back against these values by
 * `apps/api/test/integration/member-recognition-schema.test.ts`.
 */

/**
 * The cookie the member token travels in — set by `POST /customer/token`
 * (`Secure; HttpOnly; SameSite=None; Partitioned`) and sent back to it alone.
 */
export const MEMBER_TOKEN_COOKIE = 'siyahtus_member';

/** A bound of seconds with the value a workspace has before it chooses one. */
export interface SecondsRange {
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
}

/**
 * How long a member token lives without a visit (Settings › Security › Member
 * recognition). Sliding: every mint re-signs it for this long. At least a day,
 * so a member is the same member for the rest of the day (ID-02's daily
 * thread); at most a year. Default 30 days.
 */
export const MEMBER_TOKEN_TTL: SecondsRange = Object.freeze({
  defaultSeconds: 30 * 86_400,
  minSeconds: 86_400,
  maxSeconds: 365 * 86_400,
});

/**
 * How long the key a rotation replaced is still accepted. Within the window a
 * member signed by the old key is still recognised — and re-signed under the
 * new one — so a routine rotation forgets nobody who visits in time. `0`
 * retires the old key at once: the emergency rotation, after which every
 * member starts again as a new visitor. Default 7 days.
 */
export const MEMBER_KEY_ROTATION_GRACE: SecondsRange = Object.freeze({
  defaultSeconds: 7 * 86_400,
  minSeconds: 0,
  maxSeconds: 30 * 86_400,
});

/** The most possible matches shown for one customer. */
export const POSSIBLE_MATCH_LIMIT = 10;

/**
 * What a possible match can share with the customer an agent is looking at:
 * the folded pre-chat username (`customers.username_normalized`) or the e-mail.
 * Neither is proof — both are typed by the visitor.
 */
export const POSSIBLE_MATCH_FIELDS = ['username', 'email'] as const;
export type PossibleMatchField = (typeof POSSIBLE_MATCH_FIELDS)[number];

export function isPossibleMatchField(value: unknown): value is PossibleMatchField {
  return (POSSIBLE_MATCH_FIELDS as readonly unknown[]).includes(value);
}
