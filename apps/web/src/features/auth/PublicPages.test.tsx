/**
 * The public auth forms under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until every field is valid, and a touched field shows its own
 * error line — no page-local `email.includes('@')` or `valid` boolean.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ForgotPasswordPage, ResetPasswordPage, SignUpPage } from './PublicPages.js';

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
