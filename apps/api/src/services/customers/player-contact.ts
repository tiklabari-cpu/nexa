/**
 * A player's contact details under the permission matrix (RL-02-S2 · tm 325.6).
 *
 * `customers.contact.view` is a checked capability: it grants no scope, so no
 * route gate can enforce it. Every agent-facing surface that carries the
 * player's email or pre-chat username asks {@link seesPlayerContact} and masks
 * the two fields to `null` when the answer is no — the contract already says
 * either may be null, so a masked record reads as one that never gave them,
 * and the panel draws its empty state.
 *
 * Masking the value is half of it. A search that matches on the address would
 * still confirm a guess ("does ali@x.com play here?"), so the searches that
 * read either field drop them for the same person (`contactSearch`).
 *
 * The answer is the person's, from the same matrix snapshot as their scopes
 * (`principal.capabilities`, `token-service`): a change reaches an open session
 * on its next request, with no new sign-in. A bot carries no capabilities — it
 * belongs to no role — and reaches only what its scopes allow, so it is not
 * masked here; nor is the customer's own widget token, whose routes return
 * their own record.
 *
 * Realtime: one frame goes to every recipient of a push, and the gateway does
 * not rewrite payloads (`fanout.ts`), so no push carries either field — the
 * risk flag push drops `member_key` (`RiskFlagPush`), and the hand-over card's
 * shared note leaves the player's identity to the card itself
 * (`card-builder.ts` `noteText`).
 */
import { capabilityAtLeast } from '@siyahtus/types';
import type { Principal } from '../auth/principal.js';

export const PLAYER_CONTACT_CAPABILITY = 'customers.contact.view' as const;

/** Whether the caller may see a player's email and pre-chat username. */
export function seesPlayerContact(principal: Principal): boolean {
  if (principal.kind !== 'agent') return true;
  return capabilityAtLeast(
    PLAYER_CONTACT_CAPABILITY,
    principal.capabilities[PLAYER_CONTACT_CAPABILITY],
  );
}

/** `value` with `email` and `username` nulled, when the caller may not see them. */
export function maskPlayerContact<T extends { email: string | null; username?: string | null }>(
  value: T,
  visible: boolean,
): T {
  if (visible) return value;
  return { ...value, email: null, ...('username' in value ? { username: null } : {}) };
}

/**
 * `text` with every occurrence of the player's `values` replaced — for prose
 * written before the read, which names them (an AI hand-over card's text).
 * Case-insensitive: an address is one whatever its case.
 */
export function redactPlayerContact(
  text: string,
  values: ReadonlyArray<string | null>,
  visible: boolean,
): string {
  if (visible) return text;
  let out = text;
  for (const value of values) {
    const needle = value?.trim();
    if (!needle) continue;
    // No `u` flag: a stored value holding a lone surrogate would make the
    // pattern throw and the read 500 instead of masking.
    out = out.replace(new RegExp(escapeRegExp(needle), 'gi'), REDACTED);
  }
  return out;
}

/** What a masked value reads as inside prose. */
export const REDACTED = '•••';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
