/**
 * Access review vocabulary (NFR-C6 · C6-e · SOC 2 CC6.1).
 *
 * The report answers one question — *who and what can open this workspace's
 * door today* — and answers it as evidence, never as a verdict (§C-A23). Nothing
 * here scores, ranks or recommends: "is this access appropriate" is a human
 * control, and a value that pre-judged it would be the report quietly making a
 * decision an auditor is required to make themselves.
 */

/**
 * A membership's standing, as one value.
 *
 * `suspended` and `awaiting_approval` are independent flags on the row, so a
 * member can carry both. They are collapsed here — with `suspended` winning —
 * because the column an auditor reads is "can this person get in", and a
 * suspended member cannot regardless of what the other flag says. Both raw
 * booleans travel alongside the derived value so nothing is lost in the
 * collapse.
 */
export const ACCESS_REVIEW_MEMBER_STATUSES = ['active', 'awaiting_approval', 'suspended'] as const;

export type AccessReviewMemberStatus = (typeof ACCESS_REVIEW_MEMBER_STATUSES)[number];

/**
 * How a membership came to exist: an admin invited them, or the workspace's
 * directory provisioned them over SCIM (NFR-S11 · S11-e).
 *
 * CC6.1 asks how access is granted and removed, and the two answers differ
 * materially: a directory-managed member is removed by the IdP and a manual one
 * by an admin in this product, so a reviewer chasing a leaver needs to know
 * which door to knock on.
 */
export const ACCESS_REVIEW_PROVISIONING = ['manual', 'scim'] as const;

export type AccessReviewProvisioning = (typeof ACCESS_REVIEW_PROVISIONING)[number];

/**
 * How the last recorded sign-in was made.
 *
 * `password` covers a verified password bound to this workspace (`auth.login`,
 * break-glass included); `sso` covers an assertion an identity provider
 * vouched for (`auth.sso_login`). Kept apart because after an incident the two
 * imply different containment: one means a secret Nexa holds was known, the
 * other means an external system said yes.
 */
export const ACCESS_REVIEW_LOGIN_METHODS = ['password', 'sso'] as const;

export type AccessReviewLoginMethod = (typeof ACCESS_REVIEW_LOGIN_METHODS)[number];

/**
 * The two tables the report exports.
 *
 * They are separate files rather than one, because they are separate tables:
 * a person has a role and a last sign-in, a credential has scopes and a last
 * use, and merging them would force every row of each to carry the other's
 * empty columns. The JSON response still carries both at once — a caller
 * reading the whole report wants one round trip.
 */
export const ACCESS_REVIEW_SECTIONS = ['members', 'credentials'] as const;

export type AccessReviewSection = (typeof ACCESS_REVIEW_SECTIONS)[number];

export function isAccessReviewSection(value: unknown): value is AccessReviewSection {
  return typeof value === 'string' && (ACCESS_REVIEW_SECTIONS as readonly string[]).includes(value);
}
