/**
 * The public auth forms under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until every field is valid, and a touched field shows its own
 * error line — no page-local `email.includes('@')` or `valid` boolean.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ForgotPasswordPage, ResetPasswordPage, SignUpPage } from './PublicPages.js';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function renderAt(ui: ReactElement, path = '/'): void {
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('SignUpPage validation', () => {
  it('keeps Create workspace disabled until every field is valid', async () => {
    renderAt(<SignUpPage />);
    const submit = screen.getByRole('button', { name: 'Create workspace' });
    expect(submit).toBeDisabled();

    // Typing each field focuses it and blurs the previous one, so once the
    // password is entered the invalid email is touched and its error shows.
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass'); // ≥ 12
    expect(submit).toBeDisabled(); // email is still not an address
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    expect(submit).toBeEnabled();
  });

  it('keeps Submit disabled for a too-short password', async () => {
    renderAt(<SignUpPage />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
  });
});

describe('SignUpPage region selection (ADR-12)', () => {
  it('defaults to the European Union and warns the choice is permanent', () => {
    renderAt(<SignUpPage />);
    expect(screen.getByLabelText('Data region')).toHaveValue('eu');
    expect(
      screen.getByText(/cannot be changed after your workspace is created/i),
    ).toBeInTheDocument();
  });

  it('lets United States be chosen instead', async () => {
    renderAt(<SignUpPage />);
    const region = screen.getByLabelText('Data region');
    await userEvent.selectOptions(region, 'us');
    expect(region).toHaveValue('us');
  });
});

/**
 * What the form says when the server refuses on residency (C4-h).
 *
 * The message is the whole feature on this side. Before the gate existed the
 * server created the workspace in the wrong region and the form said "Could not
 * create that workspace." — false in both halves: it was created, and it was
 * never coming back. Now nothing is created, and the sentence has to be the one
 * that gets the founder to a workspace on the next attempt.
 *
 * `ApiClient.prototype.post` is the seam rather than `fetch`: the page holds a
 * module-level client that bound `globalThis.fetch` at import, so a stubbed
 * global would never be consulted.
 */
describe('SignUpPage residency refusal (C4-h)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function submitSignUp(): Promise<void> {
    renderAt(<SignUpPage />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.selectOptions(screen.getByLabelText('Data region'), 'us');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  }

  function refuse(details: Record<string, unknown>): void {
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'misdirected_request',
        status: 421,
        message: 'Workspaces in that region are created by the deployment that serves it.',
        requestId: 'req_1',
        details,
      }),
    );
  }

  it('says nothing was created and names the region this address does serve', async () => {
    refuse({ region: 'us', served_region: 'eu' });
    await submitSignUp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/nothing was created/i);
    // The label, not the code: `served_region` is the one fact the page cannot
    // work out for itself, and it is useless to the reader as "eu".
    expect(alert).toHaveTextContent(/European Union/);
    // The old sentence claimed the opposite of what happened.
    expect(alert).not.toHaveTextContent('Could not create that workspace.');
  });

  it('still says nothing was created when the server names no served region', async () => {
    // A deployment that answers 421 without the extra detail must not fall back
    // to the message that says a workspace exists somewhere.
    refuse({ region: 'us' });
    await submitSignUp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/nothing was created/i);
    expect(alert).not.toHaveTextContent('Could not create that workspace.');
  });

  it('keeps the existing message for an email that already has an account', async () => {
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'account_exists',
        status: 409,
        message: 'An account already exists for that email.',
        requestId: 'req_2',
      }),
    );
    await submitSignUp();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account already exists for that email — sign in instead.',
    );
  });
});

describe('ResetPasswordPage validation', () => {
  it('keeps Set password disabled until the password is long enough', async () => {
    renderAt(<ResetPasswordPage />, '/reset-password?token=abc');
    const submit = screen.getByRole('button', { name: 'Set password' });
    expect(submit).toBeDisabled();

    const field = screen.getByLabelText('New password');
    await userEvent.type(field, 'short');
    await userEvent.tab(); // blur reveals the message
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.type(field, 'enough-to-pass'); // now ≥ 12 total
    expect(submit).toBeEnabled();
  });
});

describe('ForgotPasswordPage validation', () => {
  it('keeps Send link disabled until the email is valid', async () => {
    renderAt(<ForgotPasswordPage />);
    const submit = screen.getByRole('button', { name: 'Send link' });
    expect(submit).toBeDisabled();

    const field = screen.getByLabelText('Email');
    await userEvent.type(field, 'nope');
    await userEvent.tab();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'robin@example.com');
    expect(submit).toBeEnabled();
  });
});

describe('SignUpPage localisation (NFR-I18N2)', () => {
  afterEach(() => resetLocale());

  it('paints the signup form in Turkish when that is the active locale', () => {
    renderWithLocale(
      <MemoryRouter initialEntries={['/']}>
        <SignUpPage />
      </MemoryRouter>,
      'tr',
    );

    expect(screen.getByRole('heading', { name: 'Çalışma alanı oluştur' })).toBeInTheDocument();
    expect(screen.getByLabelText('Çalışma alanı adı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çalışma alanı oluştur' })).toBeInTheDocument();
  });
});
