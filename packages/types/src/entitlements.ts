/**
 * Plan entitlements — the capabilities a workspace's commercial tier unlocks
 * (FR-MOD-11.5, PRD §5.4 "Kurumsal").
 *
 * One closed vocabulary, shared by the plan catalogue that grants them, the
 * endpoint that reports them and the screens that hide a control the workspace
 * has not bought. A capability spelled two ways is a capability enforced in one
 * place and forgotten in the other.
 *
 * **Derived from the plan, never stored per workspace** (§C-A25). There is no
 * feature-flag table beside the subscription, because two sources of truth for
 * "may this workspace do X" eventually disagree and nothing written down says
 * which one wins. Upgrade the plan and the capability follows; downgrade and it
 * goes away, with no second row to remember to update.
 *
 * The six keys are the capabilities the PRD names as Enterprise, not a guess at
 * what might sell:
 *
 *   - `white_label` — the widget served without Nexa branding (FR-MOD-11.5).
 *   - `sandbox`     — a second, non-billable workspace to test against (§5.4).
 *   - `sla`         — first-response/resolution targets with breach marking
 *                     (§5.4 "Kurumsal"). *Not* the uptime commitment of NFR-U5:
 *                     that is a contract term with a billing credit, which no
 *                     amount of code in this repo can promise.
 *   - `sso`         — SAML 2.0/OIDC + SCIM provisioning (NFR-S11, "Enterprise").
 *   - `hipaa`       — the signed-BAA path and US-only hosting (NFR-C4,
 *                     "Şartlı — Enterprise").
 *   - `siem_export` — shipping the audit trail to an external SIEM (NFR-S12,
 *                     "genişletilmiş + SIEM Enterprise").
 *
 * The last three arrived with S11/C4/C6, which shipped before there was a tier
 * to put them behind. Leaving them out of this vocabulary would have made them
 * three more instances of exactly the leak 11.5 exists to close.
 */

export const ENTITLEMENTS = [
  'white_label',
  'sandbox',
  'sla',
  'sso',
  'hipaa',
  'siem_export',
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

/**
 * Every entitlement with a yes/no answer.
 *
 * Total by construction: a caller reads `map.white_label` and gets a boolean,
 * never `undefined`. A partial map would let a missing key read as "not
 * granted" in one place and "unknown, allow it" in another — and the second
 * reading is a revenue leak.
 */
export type EntitlementMap = Record<Entitlement, boolean>;

export function isEntitlement(value: unknown): value is Entitlement {
  return typeof value === 'string' && (ENTITLEMENTS as readonly string[]).includes(value);
}

/**
 * Expand a grant list into the full map — everything not granted is denied.
 *
 * Deny is the default because the alternative fails in the direction that costs
 * money: a capability added to `ENTITLEMENTS` but forgotten in a plan's grant
 * list comes out `false` for everyone (visible, fixable) rather than `true`
 * (silent, and only noticed when a free workspace ships an unbranded widget).
 */
export function entitlementMap(granted: readonly Entitlement[]): EntitlementMap {
  const map = Object.fromEntries(ENTITLEMENTS.map((key) => [key, false])) as EntitlementMap;
  for (const key of granted) map[key] = true;
  return map;
}
