/**
 * Deterministic spam classifier for inbound visitor text (FR-MOD-08.9.3).
 *
 * The single engine both visitor-facing write paths screen through: the widget
 * chat-start (`routes/customer.ts`) and the inbound-email channel
 * (`services/channels/email-inbound.ts`). Keeping the decision in one module is
 * the point of "single source of truth" — the per-workspace switch, the
 * provider-verdict short-circuit and the content rules live here, not inlined
 * twice with two subtly different thresholds.
 *
 * Deterministic on purpose — no LLM. A rule engine is testable (the same text
 * always classifies the same way, so the false-positive boundary can be pinned
 * in a table test) and auditable (a workspace can be told *why* a message was
 * refused). An LLM would give neither, and a spam classifier that occasionally
 * eats a real customer's first message is worse than one that occasionally lets
 * spam through — so every threshold here is deliberately conservative and the
 * negative cases (a short greeting, a legitimate question carrying one link, a
 * repeated-but-legitimate message) are what the tests lock first.
 *
 * The four signals (PLAN §4.5/GL-7):
 *  - blocklist   — a small set of unambiguous spam phrases;
 *  - links       — a flood of URLs (one link in a sentence is not spam);
 *  - repetition  — one token dominating a long message, or a single character
 *                  hammered in a run;
 *  - gibberish   — a long, high-entropy, unbroken alphanumeric run.
 */
import type { TenantClient } from '../../lib/tenant.js';

/** Which signal fired. `provider` is an upstream verdict, not a content rule. */
export type SpamReason = 'blocklist' | 'links' | 'repetition' | 'gibberish' | 'provider';

export interface SpamVerdict {
  readonly spam: boolean;
  readonly reason: SpamReason | null;
}

const CLEAN: SpamVerdict = { spam: false, reason: null };

/**
 * Unambiguous spam phrases. Kept short and multi-word (or textbook single
 * tokens) on purpose: a broad word list is where a content filter starts eating
 * legitimate messages. "you won" is *not* here — too ordinary — only its
 * unmistakable "you have won [a prize]" form.
 */
const BLOCKLIST: readonly RegExp[] = [
  /\bviagra\b/i,
  /\bcialis\b/i,
  /\byou(?:'ve| have)\s+won\b/i,
  /\bclaim\s+your\s+(?:free\s+)?prize\b/i,
  /\bclick\s+here\s+to\s+claim\b/i,
  /\bcrypto\s+giveaway\b/i,
  /\bdouble\s+your\s+(?:money|bitcoin|btc)\b/i,
];

/** A URL: an explicit scheme or a `www.` host. Bare domains are left out — they
 * are too common in ordinary text to count toward a flood without false hits. */
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
/** Four+ URLs in one message is a flood; one or two is a normal support message. */
const LINK_FLOOD = 4;

/** Does a single token look like a URL? Used to keep the per-token content rules
 * off links — a long tracking path is not a character-hammer or gibberish. */
const URLISH_RE = /(?:https?:\/\/|www\.)/i;
/** The same character 20+ times in a row ("aaaaa…", "!!!!!…"): a hammer, not prose. */
const CHAR_RUN_RE = /(.)\1{19,}/;
/** Repetition is only judged once a message is long enough for it to be a signal. */
const MIN_TOKENS_FOR_REPETITION = 6;
const REPEAT_MIN_COUNT = 5;
const REPEAT_DOMINANCE = 0.5;
/** A repeated spam word is short. A longer token is skipped in the repetition
 * count (it is one unique token anyway, never the dominant one) — which also
 * keeps the per-token normalisation off an oversized, attacker-controlled run. */
const MAX_REPEAT_TOKEN_LEN = 64;

/** A single alphanumeric token, unbroken by any punctuation or space. */
const ALNUM_TOKEN_RE = /^[a-z0-9]+$/i;
/** Only very long unbroken runs are considered — a URL, an email or a hyphenated
 * id is split by `.`/`@`/`-`, so it never reaches this length as one token. */
const GIBBERISH_MIN_LEN = 40;
/** Shannon entropy (bits/char) at which a 40+ char run reads as random noise
 * rather than a real (if unusual) word. */
const GIBBERISH_MIN_ENTROPY = 3.5;

/** Shannon entropy of a string's character distribution, in bits per character. */
function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A single alphanumeric code point (Unicode-aware). */
const ALNUM_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * Strip leading/trailing non-alphanumerics so "hello?" and "hello" count as one.
 *
 * A two-ended index walk, deliberately NOT a `$`-anchored strip regex. The
 * regex form `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/u` is O(n²) on a token that is
 * alphanumeric at both ends with a long non-alphanumeric middle: nothing
 * matches overall, so the engine retries the unanchored trailing alternative
 * from every start position. A zero-width space (U+200B) is such a filler — it
 * survives `split(/\s+/)` as part of one token yet is non-alphanumeric — so a
 * single 10 KB widget message could block the event loop for ~1 s. `Array.from`
 * iterates by code point, so a supplementary-plane letter is not split.
 */
function normaliseToken(token: string): string {
  const chars = Array.from(token);
  let start = 0;
  let end = chars.length;
  while (start < end && !ALNUM_CHAR_RE.test(chars[start]!)) start += 1;
  while (end > start && !ALNUM_CHAR_RE.test(chars[end - 1]!)) end -= 1;
  return chars.slice(start, end).join('').toLowerCase();
}

/**
 * Classify a piece of free text. Returns a spam verdict with the signal that
 * fired, or `CLEAN`. Empty/whitespace text is never spam.
 */
export function classifyText(text: string): SpamVerdict {
  const trimmed = text.trim();
  if (!trimmed) return CLEAN;

  for (const phrase of BLOCKLIST) {
    if (phrase.test(trimmed)) return { spam: true, reason: 'blocklist' };
  }

  const urlCount = trimmed.match(URL_RE)?.length ?? 0;
  if (urlCount >= LINK_FLOOD) return { spam: true, reason: 'links' };

  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= MIN_TOKENS_FOR_REPETITION) {
    const counts = new Map<string, number>();
    let max = 0;
    for (const raw of tokens) {
      if (raw.length > MAX_REPEAT_TOKEN_LEN) continue;
      const token = normaliseToken(raw);
      if (!token) continue;
      const next = (counts.get(token) ?? 0) + 1;
      counts.set(token, next);
      if (next > max) max = next;
    }
    if (max >= REPEAT_MIN_COUNT && max / tokens.length >= REPEAT_DOMINANCE) {
      return { spam: true, reason: 'repetition' };
    }
  }

  // Per-token rules, links excluded — a long tracking path in a legitimate URL
  // is neither a character-hammer nor gibberish, and the whole-message form of
  // the char-run check would fire on one.
  for (const token of tokens) {
    if (URLISH_RE.test(token)) continue;
    if (CHAR_RUN_RE.test(token)) return { spam: true, reason: 'repetition' };
    if (
      token.length >= GIBBERISH_MIN_LEN &&
      ALNUM_TOKEN_RE.test(token) &&
      shannonEntropy(token) >= GIBBERISH_MIN_ENTROPY
    ) {
      return { spam: true, reason: 'gibberish' };
    }
  }

  return CLEAN;
}

/**
 * The gate both write paths call. Honours the per-workspace switch first (off →
 * nothing is spam), then an upstream provider verdict (email only), then the
 * deterministic content rules. A message with no text (an attachment on its own)
 * has nothing to classify and passes.
 */
export function evaluateSpam(input: {
  filterEnabled: boolean;
  text?: string | null;
  providerFlagged?: boolean;
}): SpamVerdict {
  if (!input.filterEnabled) return CLEAN;
  if (input.providerFlagged) return { spam: true, reason: 'provider' };
  const text = input.text?.trim();
  if (text) return classifyText(text);
  return CLEAN;
}

/**
 * Read the per-license spam-filter switch. No row means the schema default,
 * which is *on* — an unconfigured workspace still filters. Call inside the
 * tenant's `withTenant`, so RLS scopes the read to that license.
 */
export async function isSpamFilterEnabled(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const settings = await tx.securitySettings.findUnique({
    where: { licenseId },
    select: { spamFilterEnabled: true },
  });
  return settings?.spamFilterEnabled ?? true;
}
