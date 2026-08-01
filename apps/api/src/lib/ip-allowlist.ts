/**
 * IP allow-list matching and access semantics (FR-MOD-08.9.6).
 *
 * The mirror image of `banned-ip.ts`: that module is a deny-list on the customer
 * surface — "these addresses are refused"; this one is an allow-list on the agent
 * surface — "only these addresses are admitted". A workspace that turns it on is
 * saying its console may be reached from the office network and nowhere else.
 *
 * Two things make this a security boundary rather than a string compare, and both
 * are the reason the whole thing lives in one pure module the callers can test to
 * exhaustion before any of it guards a real request:
 *
 *   - It matches by CIDR range, not equality. `banned-ip.ts` compares whole
 *     addresses; an allow-list is written as `10.0.0.0/24`, so membership is a
 *     bit-masked prefix test. Get the mask wrong by one bit and you either admit a
 *     neighbouring network (bypass) or admit no one (every agent locked out).
 *
 *   - "Empty list" is a policy decision, not a boundary case. An unconfigured
 *     allow-list means *no restriction*, never *admit nobody* — otherwise the
 *     first save with a typo, or a race that reads the list before it is written,
 *     would lock a whole workspace out of its own console. So the default is open
 *     and the restriction only bites once at least one entry exists.
 *
 * Pure by design: no DB, no route, no Fastify hook. Reading the stored entries and
 * refusing a request belong to the write surface (08.9.6-d) and the enforcement
 * gate (08.9.6-e); this module only decides, given an address and a set of entries,
 * whether the address is in. The IPv4-mapped-IPv6 flattening is shared with the
 * ban check by reusing `normaliseIp`, so an entry an admin typed as `203.0.113.5`
 * still matches a proxy that reports `::ffff:203.0.113.5`.
 */
import { isIP } from 'node:net';
import { normaliseIp } from './banned-ip.js';

const V4_BITS = 32;
const V6_BITS = 128;

/**
 * A parsed allow-list record: a network range in canonical form. `bytes` is the
 * network address (4 bytes for v4, 16 for v6) with every host bit beyond
 * `prefixLength` already zeroed, so `10.0.0.5/24` and `10.0.0.0/24` are the same
 * range and a bare address is simply its own `/32` (or `/128`).
 */
export interface AllowlistEntry {
  version: 4 | 6;
  bytes: Uint8Array;
  prefixLength: number;
}

interface AddressBytes {
  version: 4 | 6;
  bytes: Uint8Array;
}

/**
 * Parse one allow-list entry — a single address or an `address/prefix` CIDR — into
 * its canonical range, or `null` if it is not a well-formed entry.
 *
 * Fail-closed: anything the slightest bit off (a prefix out of range, a trailing
 * slash with no number, a malformed address, an embedded second slash) returns
 * `null` rather than a guessed range. The write surface rejects the input; the
 * matcher treats a `null` entry as matching nothing. A bare address has no prefix
 * and stands for exactly itself, so it is stored as a full-length prefix.
 */
export function parseAllowlistEntry(value: string): AllowlistEntry | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const slash = trimmed.indexOf('/');
  const hasPrefix = slash !== -1;
  const addressPart = hasPrefix ? trimmed.slice(0, slash) : trimmed;
  const prefixPart = hasPrefix ? trimmed.slice(slash + 1) : '';

  // A second slash ("10.0.0.0/24/8") is malformed, not a CIDR.
  if (prefixPart.includes('/')) return null;

  const address = parseAddress(addressPart);
  if (!address) return null;

  const maxPrefix = address.version === 4 ? V4_BITS : V6_BITS;

  let prefixLength: number;
  if (!hasPrefix) {
    prefixLength = maxPrefix; // a bare host is its own /32 or /128
  } else {
    const digits = prefixPart.trim();
    // Digits only: rejects "", "-1", "ab", "2 4" — a negative or non-numeric
    // prefix is never a valid CIDR.
    if (!/^\d+$/.test(digits)) return null;
    prefixLength = Number(digits);
    if (prefixLength > maxPrefix) return null; // "/33", "/129" cannot exist
  }

  return {
    version: address.version,
    bytes: maskToPrefix(address.bytes, prefixLength),
    prefixLength,
  };
}

/**
 * Render a parsed entry back to its canonical string — the form the write surface
 * (08.9.6-d) stores. It is the inverse of {@link parseAllowlistEntry}: parse then
 * format, and two spellings of one range collapse to a single string, so the
 * `(license, entry)` unique index actually catches a duplicate and an admin never
 * ends up with `10.0.0.5/24` and `10.0.0.0/24` sitting side by side meaning the
 * same thing.
 *
 * Host bits are already zeroed by the parse, so the network address is canonical
 * by construction. A full-length prefix is dropped, so a bare host round-trips as
 * itself rather than `/32` (or `/128`). IPv6 is compressed per RFC 5952 —
 * lowercase, no leading zeros, the longest run of zero groups collapsed to `::` —
 * so one range has exactly one textual form.
 */
export function formatAllowlistEntry(entry: AllowlistEntry): string {
  const maxPrefix = entry.version === 4 ? V4_BITS : V6_BITS;
  const address = entry.version === 4 ? formatV4(entry.bytes) : formatV6(entry.bytes);
  return entry.prefixLength === maxPrefix ? address : `${address}/${entry.prefixLength}`;
}

/**
 * Whether `ip` falls inside `entry`'s range.
 *
 * The incoming address is parsed the same way the entry was — normalised (so a
 * mapped `::ffff:a.b.c.d` collapses to its v4 form) then classified — and an
 * address that will not parse matches nothing. A v4 address can never match a v6
 * entry, or the reverse: the mapped form is the only bridge between the families,
 * and it is already resolved to v4 by normalisation. Otherwise it is a bit-masked
 * prefix compare against the entry's canonical network bytes.
 */
export function ipMatchesEntry(ip: string, entry: AllowlistEntry): boolean {
  const address = parseAddress(ip);
  if (!address) return false;
  if (address.version !== entry.version) return false;

  const masked = maskToPrefix(address.bytes, entry.prefixLength);
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== entry.bytes[i]) return false;
  }
  return true;
}

/** Input to {@link decideIpAccess}: the caller's address and the stored entries. */
export interface IpAccessDecisionInput {
  clientIp: string | null | undefined;
  entries: string[];
}

/**
 * Decide whether a request from `clientIp` is admitted, given the workspace's raw
 * allow-list `entries`.
 *
 *   - Empty list → `allow`. An unconfigured allow-list imposes no restriction; it
 *     must never mean "admit nobody" (see the self-lockout note at the top).
 *   - Non-empty list, address matches an entry → `allow`.
 *   - Non-empty list, no match → `deny`.
 *   - Non-empty list, `clientIp` absent → `deny`. Once a restriction exists, the
 *     absence of an address is the absence of proof the caller is inside it, and a
 *     restrictive list treats that as out.
 *
 * `entries` are the *raw* stored strings, parsed here, on purpose: if a caller
 * pre-parsed and dropped the malformed ones, a list that was configured but all
 * corrupt would collapse to "empty" and silently admit everyone. Keeping the raw
 * strings means a non-empty-but-unmatchable list still denies — fail-closed. (The
 * write surface validates on save, so corrupt entries are not expected; this is
 * the defence for when they happen anyway.)
 */
export function decideIpAccess(input: IpAccessDecisionInput): 'allow' | 'deny' {
  const { clientIp, entries } = input;

  if (entries.length === 0) return 'allow';
  if (!clientIp || clientIp.trim() === '') return 'deny';

  for (const raw of entries) {
    const entry = parseAllowlistEntry(raw);
    if (entry && ipMatchesEntry(clientIp, entry)) return 'allow';
  }
  return 'deny';
}

/**
 * Whether saving `nextEntries` would lock `callerIp` out of the console — the
 * check the write surface (08.9.6-d) runs before persisting a change, so an admin
 * cannot save a list that excludes the very address they are saving from.
 *
 * It is exactly the access decision applied to the proposed list: if that list
 * would deny the caller, the save is a self-lockout. Clearing the list (empty
 * `nextEntries`) removes the restriction and so never locks anyone out.
 */
export function wouldLockOut(
  callerIp: string | null | undefined,
  nextEntries: string[],
): boolean {
  return decideIpAccess({ clientIp: callerIp, entries: nextEntries }) === 'deny';
}

/**
 * Parse an address (no prefix) into its version and raw bytes, or `null`.
 *
 * `normaliseIp` runs first so a mapped `::ffff:a.b.c.d` is flattened to v4 and
 * case/whitespace is settled before `isIP` classifies it — the same normalisation
 * the ban check uses, so both surfaces agree on what an address *is*.
 */
function parseAddress(value: string): AddressBytes | null {
  const canonical = normaliseIp(value);
  const kind = isIP(canonical);
  if (kind === 4) {
    const bytes = v4ToBytes(canonical);
    return bytes ? { version: 4, bytes } : null;
  }
  if (kind === 6) {
    const bytes = v6ToBytes(canonical);
    return bytes ? { version: 6, bytes } : null;
  }
  return null;
}

/** Dotted-quad → 4 bytes, or `null` if any octet is missing or out of range. */
function v4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

/**
 * IPv6 text → 16 bytes, or `null` if malformed. Handles `::` compression and a
 * trailing embedded IPv4 (`2001:db8::1.2.3.4`) by folding the dotted tail into two
 * hextets first. `isIP` has usually vetted the input already, but this re-derives
 * the bytes defensively — a shape it cannot expand returns `null`, never a guess.
 */
function v6ToBytes(ip: string): Uint8Array | null {
  let text = ip;

  const dot = text.indexOf('.');
  if (dot !== -1) {
    const lastColon = text.lastIndexOf(':', dot);
    if (lastColon === -1) return null;
    const v4 = v4ToBytes(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null; // more than one "::" is illegal

  const head = parseHextets(halves[0]!);
  if (!head) return null;

  let groups: number[];
  if (halves.length === 2) {
    const tail = parseHextets(halves[1]!);
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one zero group
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i]! >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i]! & 0xff;
  }
  return bytes;
}

/** Split a colon-separated run of hextets into numbers, or `null` if any is bad. */
function parseHextets(segment: string): number[] | null {
  if (segment === '') return [];
  const groups = segment.split(':');
  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

/** 4 network bytes → dotted quad. */
function formatV4(bytes: Uint8Array): string {
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

/**
 * 16 network bytes → canonical IPv6 text (RFC 5952): lowercase hextets with no
 * leading zeros, and the longest run of two or more zero groups replaced by `::`
 * (the leftmost such run on a tie). A parsed v6 entry never holds an embedded v4
 * (the parse flattens `::ffff:a.b.c.d` to v4 first), so this only ever formats a
 * genuine v6 address.
 */
function formatV6(bytes: Uint8Array): string {
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) groups.push(((bytes[i * 2]! << 8) | bytes[i * 2 + 1]!) >>> 0);

  // Find the longest run of consecutive zero groups (RFC 5952 only collapses a
  // run of length ≥ 2; a single zero stays "0"). Leftmost wins a tie.
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (runStart === -1) runStart = i;
      runLen++;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }

  const hex = (g: number): string => g.toString(16);
  if (bestLen < 2) return groups.map(hex).join(':');

  const head = groups.slice(0, bestStart).map(hex).join(':');
  const tail = groups.slice(bestStart + bestLen).map(hex).join(':');
  return `${head}::${tail}`;
}

/**
 * Return a copy of `bytes` with every bit past `prefixLength` cleared. Used both to
 * canonicalise a stored entry and to reduce an incoming address to the same bits
 * before comparison, so `/0` keeps nothing (matches its whole family) and `/32`
 * keeps everything (matches one host).
 */
function maskToPrefix(bytes: Uint8Array, prefixLength: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const bitOffset = i * 8;
    if (prefixLength >= bitOffset + 8) {
      out[i] = bytes[i]!; // byte lies entirely inside the prefix
    } else if (prefixLength <= bitOffset) {
      out[i] = 0; // byte is entirely host bits
    } else {
      const keep = prefixLength - bitOffset; // 1..7 leading bits survive
      out[i] = bytes[i]! & ((0xff << (8 - keep)) & 0xff);
    }
  }
  return out;
}
