/**
 * Settings → Security: SSO connections + SCIM tokens (S11-g).
 *
 * Everything this screen appears to enforce — owner-only certificate writes,
 * the certificate/URL/entity-id shape, the SCIM token cap — is the server's
 * (S11-a2, S11-e); these tests pin the screen: it lists what the server said,
 * "Verify format" never calls the network, a required field surfaces as a
 * field-under alert, a minted SCIM token is shown once and never again, and a
 * destructive action (remove a connection, revoke a token) asks first.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { SsoConnection, verifySsoMetadata } = await import('./SsoConnection.js');

const MOCK_CERT_BODY = btoa('mock-certificate-bytes-for-testing');
const VALID_PEM = `-----BEGIN CERTIFICATE-----\n${MOCK_CERT_BODY}\n-----END CERTIFICATE-----`;

const CONNECTIONS = {
  items: [
    {
      id: 'conn-1',
      name: 'Okta (corp)',
      idp_entity_id: 'http://www.okta.com/exk1a2b3c4',
      idp_sso_url: 'https://corp.okta.com/app/exk1/sso/saml',
      idp_certificate_pem: VALID_PEM,
      previous_certificate_pem: null,
      previous_certificate_expires_at: null,
      verified_domains: ['acme.com'],
      domains: [
        {
          domain: 'acme.com',
          verified: true,
          verified_at: '2026-01-01T00:00:00.000Z',
          challenge_mailbox: 'postmaster@acme.com',
          challenge_sent_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      attribute_mapping: {},
      allow_idp_initiated: false,
      enabled: true,
      enforced: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

/** A connection whose one domain is claimed and not yet proved (§D134). */
const PENDING_CONNECTIONS = {
  items: [
    {
      ...CONNECTIONS.items[0]!,
      verified_domains: [],
      domains: [
        {
          domain: 'acme.com',
          verified: false,
          verified_at: null,
          challenge_mailbox: null,
          challenge_sent_at: null,
        },
      ],
    },
  ],
};

/** The same connection with one or both switches moved. */
function connections(overrides: { enabled?: boolean; enforced?: boolean }) {
  return { items: [{ ...CONNECTIONS.items[0]!, ...overrides }] };
}

const TOKENS = {
  items: [
    {
      id: 'token-1',
      name: 'Okta provisioning',
      created_at: '2026-01-01T00:00:00.000Z',
      last_used_at: null,
      expires_at: null,
    },
  ],
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGet(path: string): unknown {
  if (path === '/settings/sso') return Promise.resolve(CONNECTIONS);
  if (path === '/settings/scim-tokens') return Promise.resolve(TOKENS);
  throw new Error(`unexpected GET ${path}`);
}

/** Fills the five required SSO metadata fields with valid values. */
async function fillValidSsoForm(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Name'), 'Okta (corp)');
  await userEvent.type(screen.getByLabelText('IdP entity id'), 'http://www.okta.com/exk1');
  await userEvent.type(
    screen.getByLabelText('Sign-on URL'),
    'https://corp.okta.com/app/exk1/sso/saml',
  );
  // Pasted rather than typed: the PEM has embedded newlines, and a real admin
  // pastes this from their IdP console rather than typing it key by key.
  await userEvent.click(screen.getByLabelText('IdP signing certificate (PEM)'));
  await userEvent.paste(VALID_PEM);
  await userEvent.type(screen.getByLabelText('Verified domains'), 'acme.com');
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(mockGet);
  api.patch.mockResolvedValue(CONNECTIONS.items[0]);
  api.delete.mockResolvedValue(undefined);
});

describe('verifySsoMetadata', () => {
  it('accepts a well-formed certificate, entity id and URL with no email attribute', () => {
    const result = verifySsoMetadata({
      idp_entity_id: 'http://www.okta.com/exk1',
      idp_sso_url: 'https://corp.okta.com/app/exk1/sso/saml',
      idp_certificate_pem: VALID_PEM,
      verified_domains: 'acme.com',
      attribute_email: '',
      attribute_name: '',
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('flags a certificate missing the BEGIN/END markers', () => {
    const result = verifySsoMetadata({
      idp_entity_id: 'entity',
      idp_sso_url: 'https://idp.example/sso',
      idp_certificate_pem: 'not a certificate',
      verified_domains: 'acme.com',
      attribute_email: '',
      attribute_name: '',
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'Not a PEM certificate — expecting one BEGIN/END CERTIFICATE block.',
    );
  });

  it('flags a non-https sign-on URL to a non-loopback host', () => {
    const result = verifySsoMetadata({
      idp_entity_id: 'entity',
      idp_sso_url: 'http://idp.example/sso',
      idp_certificate_pem: VALID_PEM,
      verified_domains: 'acme.com',
      attribute_email: '',
      attribute_name: '',
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'Plain http is only allowed for a loopback address — use https.',
    );
  });

  it('flags a name attribute given without an email attribute', () => {
    const result = verifySsoMetadata({
      idp_entity_id: 'entity',
      idp_sso_url: 'https://idp.example/sso',
      idp_certificate_pem: VALID_PEM,
      verified_domains: 'acme.com',
      attribute_email: '',
      attribute_name: 'displayName',
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'Add an email attribute too — a display name alone cannot identify who is signing in.',
    );
  });
});

describe('SsoConnection', () => {
  it('lists the connections already configured', async () => {
    renderComponent(<SsoConnection canEdit />);
    expect(await screen.findByText('Okta (corp)')).toBeInTheDocument();
    expect(screen.getByText('http://www.okta.com/exk1a2b3c4')).toBeInTheDocument();
  });

  it('disables Add connection until the metadata fields are filled, certificate and domains included', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    const submit = screen.getByRole('button', { name: 'Add connection' });
    expect(submit).toBeDisabled();

    // Captured once: once the error renders it joins the label's own text
    // (FieldError is nested inside it, like every other field on this form),
    // so a second `getByLabelText` after that point would stop matching.
    const certificateField = screen.getByLabelText('IdP signing certificate (PEM)');
    await userEvent.click(certificateField);
    await userEvent.tab();
    expect(screen.getByText('Paste the IdP certificate.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name'), 'Okta (corp)');
    await userEvent.type(screen.getByLabelText('IdP entity id'), 'http://www.okta.com/exk1');
    await userEvent.type(
      screen.getByLabelText('Sign-on URL'),
      'https://corp.okta.com/app/exk1/sso/saml',
    );
    await userEvent.click(certificateField);
    await userEvent.paste(VALID_PEM);

    expect(screen.queryByText('Paste the IdP certificate.')).not.toBeInTheDocument();
    // Still disabled: the domains this identity provider may provision from are
    // required too, and forgetting them is how a connection ends up refusing
    // every first sign-in (PLAN §D116).
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Verified domains'), 'acme.com');
    expect(submit).toBeEnabled();
  });

  it('Verify format reports problems locally without contacting the server', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await userEvent.type(screen.getByLabelText('IdP entity id'), 'entity');
    await userEvent.type(screen.getByLabelText('Sign-on URL'), 'https://idp.example/sso');
    // Certificate left blank on purpose.
    await userEvent.click(screen.getByRole('button', { name: 'Verify format' }));

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The certificate is missing.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Verify format reports success for a well-formed submission', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.click(screen.getByRole('button', { name: 'Verify format' }));

    expect(screen.getByRole('status')).toHaveTextContent('Looks well-formed.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('adds a connection by POSTing the metadata', async () => {
    api.post.mockResolvedValue(CONNECTIONS.items[0]);
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/sso', {
        name: 'Okta (corp)',
        idp_entity_id: 'http://www.okta.com/exk1',
        idp_sso_url: 'https://corp.okta.com/app/exk1/sso/saml',
        idp_certificate_pem: VALID_PEM,
        verified_domains: ['acme.com'],
        attribute_mapping: undefined,
        allow_idp_initiated: false,
        enabled: false,
      }),
    );
  });

  it('splits and normalises the verified domains it sends', async () => {
    // Typed as one field because that is how a list of domains arrives from a
    // browser; sent as an array because that is what the contract takes. Case
    // and the DNS root dot are the same domain, so the screen does not offer
    // three ways to say one thing (PLAN §D116).
    api.post.mockResolvedValue(CONNECTIONS.items[0]);
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.clear(screen.getByLabelText('Verified domains'));
    await userEvent.type(
      screen.getByLabelText('Verified domains'),
      'ACME.com, corp.acme.com. , acme.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/settings/sso',
        expect.objectContaining({ verified_domains: ['acme.com', 'corp.acme.com'] }),
      ),
    );
  });

  it('Verify format refuses a wildcard domain and says why', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.clear(screen.getByLabelText('Verified domains'));
    await userEvent.type(screen.getByLabelText('Verified domains'), '*.acme.com');
    await userEvent.click(screen.getByRole('button', { name: 'Verify format' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Remove the wildcard from *.acme.com — list each domain in full, subdomains included.',
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows which domains a connection may provision from', async () => {
    renderComponent(<SsoConnection canEdit />);
    expect(await screen.findByText('Provisions: acme.com')).toBeInTheDocument();
  });

  it('shows a claimed domain as provisioning nobody until it is verified', async () => {
    // The gap between claiming and proving is the state an owner most needs to
    // see (§D134): a connection whose domains are all pending provisions
    // nobody, and a screen that only listed the claims would read as if it did.
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso' ? Promise.resolve(PENDING_CONNECTIONS) : mockGet(path),
    );
    renderComponent(<SsoConnection canEdit />);

    await screen.findByText('acme.com');
    expect(screen.queryByText(/^Provisions:/)).not.toBeInTheDocument();
    expect(screen.getByText('provisions nobody until you verify it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeInTheDocument();
  });

  it('sends the code, then answers the challenge with what came back', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso' ? Promise.resolve(PENDING_CONNECTIONS) : mockGet(path),
    );
    api.post.mockResolvedValue({
      domain: 'acme.com',
      verified: false,
      verified_at: null,
      challenge_mailbox: 'postmaster@acme.com',
      challenge_sent_at: '2026-01-01T00:00:00.000Z',
    });
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('acme.com');

    await userEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/sso/conn-1/domains/acme.com/challenge', {}),
    );

    // The code box opens on the domain that was just challenged, and what is
    // typed goes back the way it came — this screen never sees the token
    // otherwise, and never stores it.
    await userEvent.type(
      await screen.findByLabelText('Verification code for acme.com'),
      'the-code',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/sso/conn-1/domains/acme.com/verify', {
        token: 'the-code',
      }),
    );
  });

  it('shows the server’s refusal verbatim when a code is wrong or too soon', async () => {
    // Each refusal names the obstacle — wait a minute, that code has expired,
    // that code does not match — and only the owner can act on the difference.
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso' ? Promise.resolve(PENDING_CONNECTIONS) : mockGet(path),
    );
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message:
          'A verification message for that domain was just sent. Wait a minute before sending another.',
        requestId: '-',
      }),
    );
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('acme.com');

    await userEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    expect(await screen.findByText(/Wait a minute before sending another/)).toBeInTheDocument();
  });

  it('offers no verification controls to somebody who cannot edit', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso' ? Promise.resolve(PENDING_CONNECTIONS) : mockGet(path),
    );
    renderComponent(<SsoConnection canEdit={false} />);

    await screen.findByText('acme.com');
    // The state is still visible — an admin has to be able to see why the
    // federation provisions nobody — but the buttons belong to the owner, the
    // way the routes behind them do.
    expect(screen.getByText('provisions nobody until you verify it')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send verification code' }),
    ).not.toBeInTheDocument();
  });

  it('asks for confirmation before removing a connection, and only removes on confirm', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Okta (corp)?' });
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialogAgain = await screen.findByRole('dialog', { name: 'Remove Okta (corp)?' });
    await userEvent.click(within(dialogAgain).getByRole('button', { name: 'Remove connection' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/settings/sso/conn-1'));
  });

  // --- Requiring SSO (S11-h) ---------------------------------------------------

  it('asks before requiring SSO, because it closes the password door for everyone', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await userEvent.click(screen.getByLabelText('Require SSO'));
    const dialog = await screen.findByRole('dialog', {
      name: 'Require Okta (corp) for sign-in?',
    });
    // Nothing is sent on the click itself — the same contract the remove
    // dialog has, for a change of the same weight.
    expect(api.patch).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Require SSO'));
    const again = await screen.findByRole('dialog', { name: 'Require Okta (corp) for sign-in?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Require single sign-on' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/sso/conn-1', { enforced: true }),
    );
  });

  it('turns enforcement off without asking', async () => {
    // Asymmetric on purpose: one closes the door on every member, the other
    // reopens it. Only the first is a change somebody regrets.
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso' ? Promise.resolve(connections({ enforced: true })) : mockGet(path),
    );
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await userEvent.click(screen.getByLabelText('Require SSO'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/sso/conn-1', { enforced: false }),
    );
  });

  it('shows the self-lockout refusal verbatim, and leaves the switch where it was', async () => {
    // The server's message names what to fix ("set a password on the owner
    // account"); replacing it with something vaguer would strand the one person
    // who can act on it.
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message:
          'That would lock this workspace out: with single sign-on required, an owner with a password is the only way back in when the identity provider cannot answer. Set a password on the owner account before requiring SSO.',
        requestId: '-',
      }),
    );
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await userEvent.click(screen.getByLabelText('Require SSO'));
    const dialog = await screen.findByRole('dialog', { name: 'Require Okta (corp) for sign-in?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Require single sign-on' }));

    expect(await within(dialog).findByText(/would lock this workspace out/)).toBeInTheDocument();
    // Rolled back by `optimisticCacheUpdate`, so the screen never keeps a change
    // the server refused.
    await waitFor(() => expect(screen.getByLabelText('Require SSO')).not.toBeChecked());
  });

  it('says the password door is closed when the connection is required and live', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso'
        ? Promise.resolve(connections({ enabled: true, enforced: true }))
        : mockGet(path),
    );
    renderComponent(<SsoConnection canEdit />);

    expect(await screen.findByText(/members cannot sign in with a password/)).toBeInTheDocument();
  });

  it('says so when a connection is required but switched off', async () => {
    // The pair the server reads. Rendering this as plain "Required" would tell
    // an owner passwords are closed while they quietly still work — and that is
    // the state a workspace sits in while it recovers from a broken IdP.
    api.get.mockImplementation((path: string) =>
      path === '/settings/sso'
        ? Promise.resolve(connections({ enabled: false, enforced: true }))
        : mockGet(path),
    );
    renderComponent(<SsoConnection canEdit />);

    expect(await screen.findByText(/switched off, so passwords still work/)).toBeInTheDocument();
  });

  it('shows a restricted note instead of the write form for an admin who is not the owner', async () => {
    currentRole = 'admin';
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    expect(
      screen.getByText('Only the workspace owner can add, rotate or remove a connection.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add connection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    // SCIM tokens stay writable at `admin` — the restriction is SSO-specific.
    expect(screen.getByRole('button', { name: 'Create token' })).toBeInTheDocument();
  });

  it('renders nothing for a plain agent, who cannot read this either', () => {
    currentRole = 'agent';
    renderComponent(<SsoConnection canEdit={false} />);

    expect(screen.queryByText('Single sign-on')).not.toBeInTheDocument();
    expect(screen.queryByText('SCIM provisioning')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the SCIM token once, then discards it from state and never lists it', async () => {
    let items = TOKENS.items;
    api.get.mockImplementation((path: string) => {
      if (path === '/settings/sso') return Promise.resolve(CONNECTIONS);
      if (path === '/settings/scim-tokens') return Promise.resolve({ items });
      throw new Error(`unexpected GET ${path}`);
    });
    api.post.mockImplementation(() => {
      const minted = {
        id: 'token-2',
        name: 'New connector',
        created_at: '2026-01-02T00:00:00.000Z',
        last_used_at: null,
        expires_at: null,
        token: 'scim_mock-token-value',
      };
      items = [...TOKENS.items, minted];
      return Promise.resolve(minted);
    });
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta provisioning');

    await userEvent.type(screen.getByLabelText('Token name'), 'New connector');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    const tokenDialog = await screen.findByRole('dialog', { name: 'New connector created' });
    expect(within(tokenDialog).getByText('scim_mock-token-value')).toBeInTheDocument();
    expect(within(tokenDialog).getByText(/will not be shown again/)).toBeInTheDocument();

    await userEvent.click(within(tokenDialog).getByRole('button', { name: 'Done' }));

    expect(screen.queryByText('scim_mock-token-value')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for confirmation before revoking a SCIM token, and only revokes on confirm', async () => {
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta provisioning');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke Okta provisioning?' });
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialogAgain = await screen.findByRole('dialog', { name: 'Revoke Okta provisioning?' });
    await userEvent.click(within(dialogAgain).getByRole('button', { name: 'Revoke token' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/settings/scim-tokens/token-1'));
  });

  it('answers a save rejection through the ADR-06 catalogue, not the server’s own wording', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'The certificate is not currently valid.',
        requestId: '-',
      }),
    );
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Check the highlighted fields and try again.');
  });

  it('shows the Enterprise upsell message on a 403 naming the sso entitlement', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'Single sign-on and directory provisioning is not included in the growth plan.',
        requestId: '-',
        details: { entitlement: 'sso', plan: 'growth' },
      }),
    );
    renderComponent(<SsoConnection canEdit />);
    await screen.findByText('Okta (corp)');

    await fillValidSsoForm();
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enterprise feature/);
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('SsoConnection localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Single sign-on in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <SsoConnection canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'Tek oturum açma' })).toBeInTheDocument();
  });
});
