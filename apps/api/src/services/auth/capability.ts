/**
 * Checks for capabilities that carry no scope of their own (RL-02 · tm 325.3).
 *
 * Most rows of the permission matrix grant scopes, and the route gate
 * (`config.scopes`) enforces them with nothing written here. A few do not: the
 * `own` level of `chats.view` holds the `team` level's scopes and narrows in
 * the visibility rule (`chat/access.ts`); a feature whose control is a
 * question about the *person* — may they see this field, export that file —
 * asks it through {@link requireCapability}, reading the value resolved onto
 * the principal from the same matrix snapshot as its scopes.
 *
 * A capability belongs to a member's role, so only an agent principal holds
 * one. A bot, a SCIM connector, an enrollment ticket and a customer token hold
 * none: a check that cannot be answered is a refusal (`capabilityAtLeast`).
 */
import { capabilityAtLeast, type CapabilityKey, type CapabilityValue } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { Principal } from './principal.js';

/**
 * Whether the principal's role holds `key` at `minimum` or stronger — by
 * default, anything above the capability's weakest value.
 */
export function hasCapability(
  principal: Principal,
  key: CapabilityKey,
  minimum?: CapabilityValue,
): boolean {
  if (principal.kind !== 'agent') return false;
  return capabilityAtLeast(key, principal.capabilities[key], minimum);
}

/**
 * {@link hasCapability}, refusing with 403 when it does not hold. `details`
 * names the capability, so the panel can say which permission is missing
 * instead of a bare "forbidden".
 */
export function requireCapability(
  principal: Principal,
  key: CapabilityKey,
  minimum?: CapabilityValue,
): void {
  if (hasCapability(principal, key, minimum)) return;
  throw ApiError.authorization(`Your role does not have the ${key} permission in this workspace.`, {
    reason: 'capability_required',
    capability: key,
  });
}
