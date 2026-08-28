/**
 * Two-factor authentication settings (NFR-S11 · S11-2FA-f): off shows an Enable
 * button, enroll → activate walks through the setup modal and hands back a
 * recovery sheet that can only be dismissed once "I saved these" is checked,
 * enabled shows the remaining recovery-code count and Regenerate/Disable, turning
 * it off asks for the password first, and a read-only session gets none of the
 * write affordances.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactor } from './TwoFactor.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const AGENT = {
  account_id: 'acc_1',
  email: 'demo@nexa.test',
  name: 'Demo Agent',
  role: 'owner',
  organization_id: 'org_1',
  license_id: 'lic_1',
  scopes: ['accounts--my:rw'],
  routing_status: 'offline' as const,
};

interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  recovery_codes_remaining: number;
}

interface ApiFailure {
  status: number;
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function noContent(): Response {
  return { ok: true, status: 204, headers: { get: () => null } } as unknown as Response;
}

function errorJson(failure: ApiFailure): Response {
  return {
    ok: false,
    status: failure.status,
    headers: { get: () => null },
    json: async () => ({
      error: {
        type: failure.type,
        message: failure.message,
        request_id: 'req_test',
        details: failure.details,
      },
    }),
  } as unknown as Response;
}

let twoFactorStatus: TwoFactorStatus;
let enrollBodies: Array<Record<string, unknown>>;
let activateBodies: Array<Record<string, unknown>>;
let deleteBodies: Array<Record<string, unknown>>;
let recoveryBodies: Array<Record<string, unknown>>;
let nextEnrollError: ApiFailure | null;
let nextActivateError: ApiFailure | null;
let nextDeleteError: ApiFailure | null;
let nextRecoveryError: ApiFailure | null;

/**
 * What the server answers an enrollment that has not proved the account
 * (M-SEC-d2): a validation refusal naming the `password` field, which is the
 * only thing telling this screen the account holds one.
 */
const PASSWORD_OWED: ApiFailure = {
  status: 400,
  type: 'validation',
  message: 'password: your password is required to set up two-factor authentication.',
  details: { fields: [{ field: 'password', message: 'Required.' }] },
};

const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `ABCDE-${i}FGHJ`);

function stubFetch(initial: TwoFactorStatus): void {
  twoFactorStatus = initial;
  enrollBodies = [];
  activateBodies = [];
  deleteBodies = [];
  recoveryBodies = [];
  nextEnrollError = null;
  nextActivateError = null;
  nextDeleteError = null;
  nextRecoveryError = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (path.endsWith('/auth/me') && method === 'GET') {
        return okJson({ two_factor: twoFactorStatus });
      }
      if (path.endsWith('/auth/2fa/enroll') && method === 'POST') {
        enrollBodies.push(body);
        if (nextEnrollError) return errorJson(nextEnrollError);
        return okJson({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth_uri: 'otpauth://totp/Nexa:demo%40nexa.test?secret=JBSWY3DPEHPK3PXP&issuer=Nexa',
          issuer: 'Nexa',
          account_name: 'demo@nexa.test',
        });
      }
      if (path.endsWith('/auth/2fa/activate') && method === 'POST') {
        activateBodies.push(body);
        if (nextActivateError) return errorJson(nextActivateError);
        return okJson({
          enabled: true,
          recovery_codes: RECOVERY_CODES,
          recovery_codes_remaining: 10,
        });
      }
      if (path.endsWith('/auth/2fa') && method === 'DELETE') {
        deleteBodies.push(body);
        if (nextDeleteError) return errorJson(nextDeleteError);
        return noContent();
      }
      if (path.endsWith('/auth/2fa/recovery-codes') && method === 'POST') {
        recoveryBodies.push(body);
        if (nextRecoveryError) return errorJson(nextRecoveryError);
        return okJson({ recovery_codes: RECOVERY_CODES, recovery_codes_remaining: 10 });
      }
      return okJson({});
    }),
  );
}

function renderTwoFactor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TwoFactor />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: AGENT });
  stubFetch({ enabled: false, pending: false, recovery_codes_remaining: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TwoFactor', () => {
  it('shows Off and an Enable button when no factor is set up', async () => {
    renderTwoFactor();

    expect(await screen.findByText('Off')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enable two-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('walks enroll through activation to a recovery sheet shown once', async () => {
    renderTwoFactor();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable two-factor authentication' }),
    );

    const setupDialog = await screen.findByRole('dialog', {
      name: 'Set up two-factor authentication',
    });
    expect(setupDialog).toHaveTextContent('JBSWY3DPEHPK3PXP');

    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    await waitFor(() => expect(activateBodies).toEqual([{ code: '123456' }]));

    const recoveryDialog = await screen.findByRole('dialog', {
      name: 'Save your recovery codes',
    });
    for (const code of RECOVERY_CODES) {
      expect(recoveryDialog).toHaveTextContent(code);
    }

    // Cannot close it away without confirming — Done stays disabled.
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'I have saved these codes somewhere safe.' }),
    );
    expect(done).toBeEnabled();
    await userEvent.click(done);

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Save your recovery codes' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.getByText('10 recovery codes left')).toBeInTheDocument();
  });

  it('asks for the password when the account has one, and carries it into activation', async () => {
    // The refusal is staged for the first call only: Enable posts nothing, the
    // server names the field it wants, and the retry carries it (M-SEC-d2).
    nextEnrollError = PASSWORD_OWED;
    renderTwoFactor();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable two-factor authentication' }),
    );

    const prompt = await screen.findByRole('dialog', {
      name: 'Confirm it is you, to turn two-factor on',
    });
    // No setup key is on screen yet — nothing was minted by the refused call.
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();

    nextEnrollError = null;
    await userEvent.type(within(prompt).getByLabelText('Password'), 'hunter2');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Continue' }));

    const setupDialog = await screen.findByRole('dialog', {
      name: 'Set up two-factor authentication',
    });
    expect(setupDialog).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(enrollBodies).toEqual([{}, { password: 'hunter2' }]);

    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    // Activation proves the account again — the same rule, the same credential.
    await waitFor(() => expect(activateBodies).toEqual([{ code: '123456', password: 'hunter2' }]));
  });

  it('says what to do when there is no password to ask for', async () => {
    nextEnrollError = {
      status: 403,
      type: 'not_allowed',
      message: 'refused',
      details: { password_required: true },
    };
    renderTwoFactor();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable two-factor authentication' }),
    );

    expect(await screen.findByText(/Set a password on it first/)).toBeInTheDocument();
    // A password box would be a dead end: the account has none to type.
    expect(
      screen.queryByRole('dialog', { name: 'Confirm it is you, to turn two-factor on' }),
    ).not.toBeInTheDocument();
  });

  it('asks before closing the recovery sheet unconfirmed, and drops the codes for good once closed', async () => {
    stubFetch({ enabled: false, pending: false, recovery_codes_remaining: 0 });
    renderTwoFactor();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enable two-factor authentication' }),
    );
    await userEvent.type(await screen.findByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));
    await screen.findByRole('dialog', { name: 'Save your recovery codes' });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.keyboard('{Escape}');
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Save your recovery codes' })).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Save your recovery codes' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows On, the remaining recovery codes, and Regenerate/Disable when active', async () => {
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 3 });
    renderTwoFactor();

    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.getByText('3 recovery codes left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get new recovery codes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('turning it off asks for the password and updates the status once confirmed', async () => {
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 5 });
    renderTwoFactor();

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm it is you, to turn off two-factor authentication',
    });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct-horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(deleteBodies).toEqual([{ password: 'correct-horse' }]));
    expect(await screen.findByText('Off')).toBeInTheDocument();
  });

  it('regenerating recovery codes asks for the password and reopens the recovery sheet', async () => {
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 2 });
    renderTwoFactor();

    await userEvent.click(await screen.findByRole('button', { name: 'Get new recovery codes' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm it is you, to get new recovery codes',
    });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct-horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(recoveryBodies).toEqual([{ password: 'correct-horse' }]));
    const recoveryDialog = await screen.findByRole('dialog', { name: 'Save your recovery codes' });
    expect(recoveryDialog).toHaveTextContent(RECOVERY_CODES[0]!);

    await userEvent.click(
      within(recoveryDialog).getByRole('checkbox', {
        name: 'I have saved these codes somewhere safe.',
      }),
    );
    await userEvent.click(within(recoveryDialog).getByRole('button', { name: 'Done' }));

    expect(await screen.findByText('10 recovery codes left')).toBeInTheDocument();
  });

  it('switches the reauth field to a code when the account has no password', async () => {
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 5 });
    nextDeleteError = {
      status: 401,
      type: 'two_factor_required',
      message: 'This account signs in through your identity provider and has no password.',
    };
    renderTwoFactor();

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm it is you, to turn off two-factor authentication',
    });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'irrelevant');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(dialog).findByLabelText('Two-factor or recovery code')).toBeInTheDocument();
    expect(deleteBodies).toEqual([{ password: 'irrelevant' }]);

    nextDeleteError = null;
    await userEvent.type(within(dialog).getByLabelText('Two-factor or recovery code'), '654321');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(deleteBodies).toEqual([{ password: 'irrelevant' }, { code: '654321' }]),
    );
  });

  it('names the blocking workspaces when a workspace policy refuses to let the factor go', async () => {
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 5 });
    nextDeleteError = {
      status: 403,
      type: 'not_allowed',
      message: 'Two-factor authentication is required by Acme Support.',
      details: { workspaces: ['Acme Support'] },
    };
    renderTwoFactor();

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm it is you, to turn off two-factor authentication',
    });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct-horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(dialog).findByText(/Acme Support/)).toBeInTheDocument();
  });

  it('is read-only when the session holds no accounts--my:rw scope', async () => {
    useAuth.setState({ agent: { ...AGENT, scopes: [] } });
    stubFetch({ enabled: true, pending: false, recovery_codes_remaining: 5 });
    renderTwoFactor();

    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Get new recovery codes' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j precedent, tm 133.10). */
describe('TwoFactor localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Two-factor authentication in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <TwoFactor />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'İki adımlı doğrulama' })).toBeInTheDocument();
  });
});
