/**
 * The mock IdP harness itself (NFR-S11 · S11-c).
 *
 * `mock-idp.ts` exists to hand other suites (S11-d, later e2e) a signed
 * assertion they can trust without re-implementing XML-DSig. That trust has to
 * be earned here: every check below runs the real verifier (`saml.ts`, S11-b)
 * over the harness's output, so a fixture that quietly stopped producing valid
 * XML or a real signature would fail this file, not just whichever suite
 * happened to consume it next.
 *
 * Only the happy path is exercised — malformed/expired/replayed/XSW variants
 * are `saml.test.ts`'s rejection matrix (S11-b), not this file's concern.
 */
import { describe, expect, it } from 'vitest';
import {
  issueAssertion,
  MOCK_ACS_URL,
  MOCK_IDP_CERTIFICATE,
  MOCK_IDP_ENTITY_ID,
  MOCK_SP_ENTITY_ID,
} from '../../test/helpers/mock-idp.js';
import { verifySamlResponse, type AssertionReplayGuard, type SamlExpectations } from './saml.js';

/** This file never tests replay, so every submission is treated as the first. */
const alwaysFirstGuard: AssertionReplayGuard = { claim: () => Promise.resolve(true) };

function expectations(overrides: Partial<SamlExpectations> = {}): SamlExpectations {
  return {
    idpEntityId: MOCK_IDP_ENTITY_ID,
    spEntityId: MOCK_SP_ENTITY_ID,
    acsUrl: MOCK_ACS_URL,
    certificates: [MOCK_IDP_CERTIFICATE],
    inResponseTo: null,
    allowIdpInitiated: true,
    ...overrides,
  };
}

describe('issueAssertion', () => {
  it('issues an assertion the real verifier accepts', async () => {
    const issued = issueAssertion();

    const result = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations(),
      new Date(),
      alwaysFirstGuard,
    );

    expect(result.ok).toBe(true);
  });

  it('carries the given subject and attributes through to the verified claims', async () => {
    const issued = issueAssertion({
      subject: 'someone@corp.example.test',
      attributes: { role: ['owner'], team: ['support', 'billing'] },
    });

    const result = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations(),
      new Date(),
      alwaysFirstGuard,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.nameId).toBe('someone@corp.example.test');
    expect(result.assertion.attributes).toEqual({
      role: ['owner'],
      team: ['support', 'billing'],
    });
  });

  it('writes the given audience and destination into the signed body', async () => {
    const audience = 'https://other-sp.example.test';
    const destination = 'https://app.nexa.test/auth/saml/conn-42/acs';
    const issued = issueAssertion({ audience, destination });

    expect(issued.xml).toContain(`<saml:Audience>${audience}</saml:Audience>`);
    expect(issued.xml).toContain(`Destination="${destination}"`);
    expect(issued.xml).toContain(`Recipient="${destination}"`);

    // A verifier expecting the *default* SP/ACS refuses it...
    const mismatched = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations(),
      new Date(),
      alwaysFirstGuard,
    );
    expect(mismatched.ok).toBe(false);

    // ...but one configured for this connection's own values accepts it.
    const matched = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations({ spEntityId: audience, acsUrl: destination }),
      new Date(),
      alwaysFirstGuard,
    );
    expect(matched.ok).toBe(true);
  });

  it('writes the given inResponseTo into the bearer confirmation', async () => {
    const issued = issueAssertion({ inResponseTo: '_my-request-id' });
    expect(issued.xml).toContain('InResponseTo="_my-request-id"');

    const mismatched = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations({ inResponseTo: '_someone-elses-request', allowIdpInitiated: false }),
      new Date(),
      alwaysFirstGuard,
    );
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.reason).toBe('in_response_to_mismatch');

    const matched = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations({ inResponseTo: '_my-request-id', allowIdpInitiated: false }),
      new Date(),
      alwaysFirstGuard,
    );
    expect(matched.ok).toBe(true);
  });

  it('honors a given notOnOrAfter as the assertion expiry', async () => {
    const notOnOrAfter = new Date(Date.now() + 2 * 60_000);
    const issued = issueAssertion({ notOnOrAfter });

    const result = await verifySamlResponse(
      issued.samlResponseBase64,
      expectations(),
      new Date(),
      alwaysFirstGuard,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.expiresAt.toISOString()).toBe(notOnOrAfter.toISOString());
  });

  it('mints a distinct assertion id on every call', () => {
    const first = issueAssertion();
    const second = issueAssertion();
    expect(first.assertionId).not.toBe(second.assertionId);
  });
});
