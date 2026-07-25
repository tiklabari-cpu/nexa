/**
 * Sign-in under the shared primitive (FR-EK-A.1): Submit stays disabled until
 * both credentials are present and the email is well formed, and a touched
 * field shows its own error line.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SignInPage } from './SignInPage.js';
import { useAuth } from '../../lib/auth-store.js';

function renderSignIn(): void {
  render(
    <MemoryRouter>
      <SignInPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // The disabled state must come from the form, not a lingering store `busy`.
  useAuth.setState({ busy: false });
});

describe('SignInPage validation', () => {
  it('keeps Sign in disabled until email and password are valid', async () => {
    renderSignIn();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    expect(submit).toBeDisabled(); // email is not an address

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'owner@acme.localhost');
    expect(submit).toBeEnabled();
  });

  it('keeps Sign in disabled with a valid email but no password', async () => {
    renderSignIn();
    await userEvent.type(screen.getByLabelText('Email'), 'owner@acme.localhost');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});
