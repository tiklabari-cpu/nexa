/**
 * A SAML identity provider a browser can actually be sent to (NFR-S11 · S11-i).
 *
 * The integration suite drives federation by calling the ACS with an assertion
 * it minted in-process. That proves the endpoints; it cannot prove the *journey*
 * — a real browser leaving the app, being redirected by us, posting a form back
 * from a foreign origin, and landing in the panel with a working session. Every
 * hop in that sequence is a place a cookie policy, a `SameSite` default, a
 * content-type parser or a redirect chain can break the product while every
 * server-side test stays green.
 *
 * So the e2e suite gets an IdP process, standing where Okta would. It signs with
 * the repository's one mock key pair (`test/helpers/mock-idp.ts`) rather than a
 * second one, and it does exactly what the HTTP-POST binding says: read the
 * `AuthnRequest`, answer to the `AssertionConsumerServiceURL` it names, echo the
 * `RelayState`. It performs no authentication of its own — *who* signs in is a
 * query parameter on the connection's sign-on URL, which is what makes a test
 * able to say "this person, at this workspace" without a login form to script.
 *
 * Test infrastructure, not product code: nothing under `src/` imports it, and it
 * is started only by `apps/e2e/playwright.config.ts`.
 */
import { createServer } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import {
  MOCK_IDP_CERTIFICATE,
  MOCK_IDP_ENTITY_ID,
  issueAssertion,
} from '../test/helpers/mock-idp.js';

const PORT = Number(process.env['MOCK_IDP_PORT'] ?? 4599);

/** Read one XML attribute off the AuthnRequest without a parser. */
function attribute(xml: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1] ?? null;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The form every real IdP posts back: hidden fields and an onload submit.
 *
 * A 307 would be simpler and would not be the binding under test — the ACS
 * accepts `application/x-www-form-urlencoded` from a cross-origin form
 * navigation, and that is the property worth exercising in a browser.
 */
function autoPostForm(acsUrl: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}"/>`)
    .join('');
  return (
    `<!doctype html><html><head><title>Mock IdP</title></head>` +
    `<body onload="document.forms[0].submit()">` +
    `<form method="POST" action="${escapeHtml(acsUrl)}">${inputs}` +
    `<noscript><button type="submit">Continue</button></noscript>` +
    `</form></body></html>`
  );
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  // Playwright's readiness probe. Separate from `/sso` so waiting for the
  // process never mints an assertion.
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }

  // What an administrator copies out of an identity provider console and into
  // the Settings form. Published rather than imported into the test, so the e2e
  // configures a connection from the IdP's own account of itself — and so the
  // repository keeps exactly one mock signing key pair, in one file.
  if (url.pathname === '/metadata') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        entity_id: MOCK_IDP_ENTITY_ID,
        sso_url: `http://127.0.0.1:${PORT}/sso`,
        certificate_pem: MOCK_IDP_CERTIFICATE,
      }),
    );
    return;
  }

  if (url.pathname !== '/sso') {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }

  const encoded = url.searchParams.get('SAMLRequest');
  if (!encoded) {
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end('SAMLRequest is required');
    return;
  }

  let xml: string;
  try {
    xml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end('SAMLRequest is not a deflated document');
    return;
  }

  const requestId = attribute(xml, 'ID');
  const acsUrl = attribute(xml, 'AssertionConsumerServiceURL');
  // The SP's EntityID, which is what the assertion has to name as its audience.
  const issuer = /<[^>]*Issuer[^>]*>([^<]+)<\/[^>]*Issuer>/.exec(xml)?.[1];
  if (!requestId || !acsUrl || !issuer) {
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end('AuthnRequest is missing ID, ACS URL or Issuer');
    return;
  }

  const destination = unescapeXml(acsUrl);
  const subject = url.searchParams.get('user') ?? 'agent@corp.example.test';
  const displayName = url.searchParams.get('name');

  const assertion = issueAssertion({
    subject,
    attributes: {
      email: [subject],
      ...(displayName === null ? {} : { name: [displayName] }),
    },
    audience: unescapeXml(issuer),
    destination,
    inResponseTo: requestId,
  });

  const relayState = url.searchParams.get('RelayState');
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(
    autoPostForm(destination, {
      SAMLResponse: assertion.samlResponseBase64,
      ...(relayState === null ? {} : { RelayState: relayState }),
    }),
  );
});

// Loopback only. This process signs assertions for anybody who asks, so it must
// never be reachable from another machine — and the SSO URL validation
// (`lib/sso-connection.ts`) allows plain http for exactly this address and no
// other, which is what lets a test configure it without a certificate.
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock IdP listening on http://127.0.0.1:${PORT}/sso\n`);
});
