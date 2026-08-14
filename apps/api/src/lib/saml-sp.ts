/**
 * The service-provider half of SAML (NFR-S11 · S11-d).
 *
 * `saml.ts` answers *may this assertion be believed*. This module answers the
 * two questions on either side of that one, and both are pure: what we send to
 * the identity provider to start a login, and who a believed assertion actually
 * names. The endpoints that string them together — `routes/saml.ts` — do the
 * database work, mint the session and write the audit trail.
 *
 * Keeping the identity mapping here rather than in the route is not tidiness.
 * "Which attribute is the email address" is the step where a workspace's own
 * IdP configuration decides *which account* a login lands on, so its edge cases
 * (no mapping, two values, an address that is not one) are worth testing to
 * exhaustion without a server, a database or a signature in the way.
 */
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import type { SsoAttributeMapping } from '@nexa/types';
import type { VerifiedAssertion } from './saml.js';

const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const HTTP_POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const EMAIL_NAMEID_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

/** The same ceiling `accounts.email` and every other email field carries. */
export const SSO_EMAIL_MAX_LENGTH = 320;

/** Bound on a JIT-provisioned display name, matching the invitation path. */
export const SSO_NAME_MAX_LENGTH = 120;

/**
 * Attribute names tried, in order, when a connection declares no mapping.
 *
 * Only consulted when `attributeMapping.email` is absent. A configured mapping
 * is used *alone* — silently widening an explicit choice would mean an admin who
 * pointed us at one claim could still be matched on another, which is the same
 * ambiguity the single-value rule below exists to refuse.
 *
 * The list is the three spellings enterprise IdPs actually emit: the bare name
 * (Okta, Auth0), the LDAP OID (Shibboleth, SimpleSAMLphp) and the WS-Federation
 * claim URI (Azure AD, ADFS).
 */
export const DEFAULT_EMAIL_ATTRIBUTES = [
  'email',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
] as const;

/** Same idea for the display name, used only when no mapping names one. */
export const DEFAULT_NAME_ATTRIBUTES = [
  'name',
  'displayName',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
] as const;

export type SsoIdentityRejection =
  /** Neither the mapped attribute nor the NameID carried an address. */
  | 'email_missing'
  /** The attribute carried more than one value — see {@link resolveSsoIdentity}. */
  | 'email_ambiguous'
  /** Present, but not something that can be an account address. */
  | 'email_invalid';

export interface SsoIdentity {
  /** Normalised to lower case, as `accounts.email` (citext) compares. */
  email: string;
  /** Display name for a JIT-provisioned account, or `null` to derive one. */
  name: string | null;
}

export type SsoIdentityResolution =
  { ok: true; identity: SsoIdentity } | { ok: false; reason: SsoIdentityRejection };

/**
 * Deliberately narrow: one `@`, no whitespace, something either side, a dot in
 * the domain. Addresses are not parsed to RFC 5322 anywhere in this codebase and
 * this is not the place to start — the value becomes an account's identity, so
 * the useful question is "is this unambiguously one address" rather than "could
 * some mail system deliver it".
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Turn a verified assertion into the account it names.
 *
 * The rules, and why each is a refusal rather than a guess:
 *
 *   - **A mapped attribute is used alone.** If the workspace said `mail`, then
 *     `mail` is the answer or there is none — not the `email` attribute beside
 *     it, and not the NameID either. Any fallback would mean a claim the admin
 *     did not choose gets to decide which account a login reaches, and the
 *     admin would have no way to tell it had happened.
 *   - **Two values is a refusal, not a first-wins.** An assertion listing two
 *     addresses has no single subject, and picking one silently would make
 *     *which* account is reached depend on IdP attribute ordering.
 *   - **NameID is a fallback for an unmapped connection, and only when it is an
 *     address.** Its format is usually `emailAddress` in the enterprise
 *     deployments this serves; a transient or persistent NameID is an opaque
 *     pairwise id and must never be read as a mailbox.
 */
export function resolveSsoIdentity(
  assertion: Pick<VerifiedAssertion, 'attributes' | 'nameId' | 'nameIdFormat'>,
  mapping: SsoAttributeMapping,
): SsoIdentityResolution {
  const mapped = mapping.email
    ? readAttribute(assertion.attributes, [mapping.email])
    : readAttribute(assertion.attributes, DEFAULT_EMAIL_ATTRIBUTES);
  if (!mapped.ok) return mapped;

  const raw = mapped.value ?? (mapping.email ? null : emailFromNameId(assertion));
  if (raw === null) return { ok: false, reason: 'email_missing' };

  const email = raw.trim().toLowerCase();
  if (email.length > SSO_EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) {
    return { ok: false, reason: 'email_invalid' };
  }

  const named = mapping.name
    ? readAttribute(assertion.attributes, [mapping.name])
    : readAttribute(assertion.attributes, DEFAULT_NAME_ATTRIBUTES);
  // A second display name is not worth failing a login over — unlike the
  // address, the name decides nothing. An ambiguous or over-long one is dropped
  // and the account gets a name derived from its address instead.
  const name =
    named.ok && named.value !== null && named.value.trim() !== ''
      ? named.value.trim().slice(0, SSO_NAME_MAX_LENGTH)
      : null;

  return { ok: true, identity: { email, name } };
}

function readAttribute(
  attributes: Record<string, string[]>,
  names: readonly string[],
): { ok: true; value: string | null } | { ok: false; reason: SsoIdentityRejection } {
  for (const name of names) {
    const values = (attributes[name] ?? []).filter((value) => value.trim() !== '');
    if (values.length === 0) continue;
    if (values.length > 1) return { ok: false, reason: 'email_ambiguous' };
    return { ok: true, value: values[0]! };
  }
  return { ok: true, value: null };
}

function emailFromNameId(
  assertion: Pick<VerifiedAssertion, 'nameId' | 'nameIdFormat'>,
): string | null {
  if (!assertion.nameId) return null;
  // An unformatted NameID is `unspecified` by the spec's default, and every IdP
  // this targets puts the address there when it puts one anywhere. A NameID
  // declared transient/persistent is an opaque handle and is not consulted.
  if (assertion.nameIdFormat && assertion.nameIdFormat !== EMAIL_NAMEID_FORMAT) return null;
  return assertion.nameId;
}

// --- Starting a login --------------------------------------------------------

/**
 * Our SAML EntityID for one connection.
 *
 * Per connection rather than one value for the whole deployment, so an
 * assertion minted for one workspace names *that* workspace in its
 * `AudienceRestriction` and is refused at every other workspace's ACS even if
 * both federate the same identity provider. It is an identifier, not a document:
 * nothing is served at this URL, and SAML does not require anything to be.
 *
 * `apiBase` is the API's mounted base — `API_BASE_URL` + the version prefix —
 * which the route plugin is handed at registration, the same way the MCP and
 * public-KB surfaces get theirs. The settings screen (S11-g) has to show these
 * two strings for an admin to paste into their IdP console; it builds them the
 * same way from the same base.
 */
export function ssoEntityId(apiBase: string, connectionId: string): string {
  return `${apiBase}/auth/saml/${connectionId}`;
}

/** Where the IdP posts its response — `Destination` and the bearer `Recipient`. */
export function ssoAcsUrl(apiBase: string, connectionId: string): string {
  return `${ssoEntityId(apiBase, connectionId)}/acs`;
}

export interface AuthnRequestInput {
  /** `sso_connections.idpSsoUrl` — where the browser is sent. */
  idpSsoUrl: string;
  /** {@link ssoEntityId} for this connection. */
  spEntityId: string;
  /** {@link ssoAcsUrl} for this connection. */
  acsUrl: string;
  /** Opaque handle the IdP echoes back, correlating the response to our record. */
  relayState: string;
  issueInstant: Date;
}

export interface AuthnRequest {
  /** `AuthnRequest/@ID`, which the response must echo as `InResponseTo`. */
  id: string;
  /** Absolute URL to redirect the browser to (HTTP-Redirect binding). */
  redirectUrl: string;
}

/**
 * Build an AuthnRequest and the redirect that carries it.
 *
 * HTTP-Redirect binding: the request is DEFLATE-compressed, base64-encoded and
 * carried as a query parameter, which is what every IdP expects on the outbound
 * leg (the response comes back over HTTP-POST, where size is not a constraint).
 *
 * The request is **not signed**. Signing it would require an SP private key,
 * which this deployment does not have and which CLAUDE.md forbids inventing —
 * and it would buy nothing here: an AuthnRequest carries no secret, and the only
 * thing that matters on the way back is that the *response* is signed by the
 * certificate the workspace configured. What binds the two halves is the `ID`
 * below, which the IdP must echo as `InResponseTo`.
 */
export function buildAuthnRequest(input: AuthnRequestInput): AuthnRequest {
  // `xs:ID` is an NCName, so it may not start with a digit; every SAML
  // implementation writes the underscore prefix for exactly that reason.
  const id = `_${randomUUID().replace(/-/g, '')}`;

  const xml =
    `<samlp:AuthnRequest xmlns:samlp="${SAML_PROTOCOL_NS}" xmlns:saml="${SAML_ASSERTION_NS}" ` +
    `ID="${id}" Version="2.0" IssueInstant="${input.issueInstant.toISOString()}" ` +
    `Destination="${escapeXml(input.idpSsoUrl)}" ` +
    `ProtocolBinding="${HTTP_POST_BINDING}" ` +
    `AssertionConsumerServiceURL="${escapeXml(input.acsUrl)}">` +
    `<saml:Issuer>${escapeXml(input.spEntityId)}</saml:Issuer>` +
    // AllowCreate lets the IdP mint a NameID for a user who has never signed in
    // here before, which is the case JIT provisioning exists to serve.
    `<samlp:NameIDPolicy Format="${EMAIL_NAMEID_FORMAT}" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`;

  const url = new URL(input.idpSsoUrl);
  // Appended rather than assigned: an SSO URL is allowed to carry query
  // parameters of its own (several IdPs route on one), and replacing the search
  // string would quietly drop them.
  url.searchParams.append(
    'SAMLRequest',
    deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64'),
  );
  url.searchParams.append('RelayState', input.relayState);

  return { id, redirectUrl: url.toString() };
}

/**
 * Escape text destined for an XML attribute or element.
 *
 * The values here are ours — URLs from a row an owner wrote — so this is not the
 * last line of defence, but an unescaped `&` in a query-carrying SSO URL is
 * enough to produce a document the IdP cannot parse, and the failure would show
 * up as an unexplained rejection at the far end.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
