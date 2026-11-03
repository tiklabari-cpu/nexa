/**
 * Operator-signed member identity (SiyahTuş analysis ID-03, the operator's way
 * in · owner decision K28 · tm 388) — the names and numbers the api, the panel
 * and the operator's own server have to agree on.
 *
 * K4 (tm 287) recognises a returning visitor by a member token SiyahTuş signs:
 * it knows a *browser*, never a *person*, so the same player on their phone is
 * a new customer until an agent links the two. K28 adds the second way in that
 * K4 kept for later. The operator's site knows who is logged in; its server
 * signs that member's id with a secret only it and SiyahTuş hold, the page
 * hands the signature to the widget — `siyahtus('identify', {...})` — and the
 * token mint checks it. A valid signature makes the visitor that member on
 * every device: their customer record is found by the operator's id.
 *
 * Off until a workspace turns it on and issues a secret (Settings › Security ›
 * Member recognition). Before that an identify call changes nothing, and the
 * K4 flow is exactly what it was.
 *
 * **What is signed** is {@link signedIdentityMessage}: a version line, then the
 * fields in a fixed order, one per line, with the timestamp last. A field that
 * holds a control character is refused outright, so no value can carry a line
 * break into the next field's place — the order alone makes the message
 * unambiguous. The HMAC is SHA-256, keyed with the secret string exactly as the
 * panel shows it, and sent as lowercase hex (what `hash_hmac` and Node's
 * `digest('hex')` produce).
 *
 * **Short-lived, single-use.** A signature older than
 * {@link SIGNED_IDENTITY_LIMITS} `maxAgeSeconds`, or further ahead of
 * SiyahTuş's clock than `maxFutureSkewSeconds`, is refused, and one that has
 * already been accepted is refused the second time — a signature read off a
 * page (a shared computer's cache, a proxy log) is worth nothing to anyone
 * else.
 *
 * Plain literals only at the top level: this module is in the barrel the
 * widget's loader imports from, and a top-level call would be bundled into
 * every host page.
 */
import type { SecondsRange } from './member-recognition.js';

/** The first line of every signed message; a new format gets a new one. */
export const SIGNED_IDENTITY_VERSION = 'siyahtus-identify-v1';

/** The bounds of a signed identity and of its signature's life. */
export const SIGNED_IDENTITY_LIMITS = Object.freeze({
  /** The operator's member id: what finds the customer record. */
  userIdMaxLength: 128,
  /** The same bound as the pre-chat username (`routes/customer.ts`). */
  usernameMaxLength: 120,
  emailMaxLength: 254,
  /** How old a signature may be when it reaches the mint: five minutes. */
  maxAgeSeconds: 300,
  /** How far ahead of SiyahTuş's clock the operator's may run: one minute. */
  maxFutureSkewSeconds: 60,
});

/**
 * The prefix of a workspace's identity secret (`sti_` + 256 random bits,
 * base64url) — lets a secret scanner recognise one that leaked into a
 * repository or a page.
 */
export const MEMBER_IDENTITY_SECRET_PREFIX = 'sti_';

/**
 * How long the secret a rotation replaced is still accepted: the time the
 * operator has to deploy the new one. Default a day; `0` retires the old
 * secret at once — the rotation for a secret that leaked. At most 30 days.
 */
export const MEMBER_IDENTITY_SECRET_ROTATION_GRACE: SecondsRange = Object.freeze({
  defaultSeconds: 86_400,
  minSeconds: 0,
  maxSeconds: 30 * 86_400,
});

/** What the operator's server signs. */
export interface SignedIdentityFields {
  /** The member's id on the operator's platform. */
  user_id: string;
  /** Optional; signed as an empty line when absent. */
  username?: string | null;
  /** Optional; signed as an empty line when absent. */
  email?: string | null;
  /** When it was signed: Unix time in whole seconds. */
  ts: number;
}

/** What the page hands `siyahtus('identify', …)`: the fields and their signature. */
export interface SignedIdentity extends SignedIdentityFields {
  /** HMAC-SHA256 of {@link signedIdentityMessage}, lowercase hex. */
  user_hash: string;
}

/**
 * The exact string the HMAC covers. The operator's server builds the same one:
 *
 *     siyahtus-identify-v1\n<user_id>\n<username>\n<email>\n<ts>
 *
 * An absent username or e-mail is an empty line, never the word "null".
 */
export function signedIdentityMessage(fields: SignedIdentityFields): string {
  return [
    SIGNED_IDENTITY_VERSION,
    fields.user_id,
    fields.username ?? '',
    fields.email ?? '',
    String(fields.ts),
  ].join('\n');
}

/**
 * Why a signed identity was not believed. Logged and counted for the
 * workspace, never answered: every one is ignored exactly like no identity
 * at all, so the response cannot tell a forged signature from a stale one.
 */
export const SIGNED_IDENTITY_REFUSALS = [
  /** The workspace has signed identity off, or has issued no secret. */
  'disabled',
  /** Not the shape above: a missing id, a control character, a non-integer `ts`. */
  'malformed',
  /** Older than `maxAgeSeconds`. */
  'expired',
  /** Further ahead of SiyahTuş's clock than `maxFutureSkewSeconds`. */
  'future',
  /** Signed by neither the current secret nor the one a rotation is phasing out. */
  'bad_signature',
  /** This exact signature was accepted before. */
  'replayed',
  /** The replay record could not be reached; refused rather than risk a replay. */
  'replay_unchecked',
] as const;
export type SignedIdentityRefusal = (typeof SIGNED_IDENTITY_REFUSALS)[number];

export function isSignedIdentityRefusal(value: unknown): value is SignedIdentityRefusal {
  return (SIGNED_IDENTITY_REFUSALS as readonly unknown[]).includes(value);
}

/** How many days back the settings screen counts signed identities. */
export const MEMBER_IDENTITY_STATS_DAYS = 7;
