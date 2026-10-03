/**
 * The public auth forms under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until every field is valid, and a touched field shows its own
 * error line — no page-local `email.includes('@')` or `valid` boolean.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ForgotPasswordPage, JoinPage, ResetPasswordPage, SignUpPage } from './PublicPages.js';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { DeploymentConfig } from '@siyahtus/types';

/**
 * `GET /deployment` through its one seam (tm 257.4). An ordinary deployment
 * unless a test says otherwise, so every test outside the pilot block runs
 * exactly as it did before the page read it.
 */
const deployment = vi.hoisted(() => ({
  current: {
    pilot_mode: false,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  } as DeploymentConfig,
}));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

afterEach(() => {
  deployment.current = {
    pilot_mode: false,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  };
});

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

/**
 * A deployment that has closed sign-up (tm 256.3): 403 `not_allowed` with
 * `details.reason: 'signup_closed'`. The generic "Could not create that
 * workspace." reads as "try again", and no retry can work — the sentence has
 * to say so and point at the way in that still exists, an invitation.
 */
describe('SignUpPage closed sign-up', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocale();
  });

  function closedSignup(details: Record<string, unknown> = { reason: 'signup_closed' }): void {
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'Sign-up is closed on this deployment.',
        requestId: 'req_3',
        details,
      }),
    );
  }

  async function fill(labels: {
    workspace: string;
    name: string;
    email: string;
    password: string;
    submit: string;
  }): Promise<void> {
    await userEvent.type(screen.getByLabelText(labels.workspace), 'Acme');
    await userEvent.type(screen.getByLabelText(labels.name), 'Robin');
    await userEvent.type(screen.getByLabelText(labels.email), 'robin@example.com');
    await userEvent.type(screen.getByLabelText(labels.password), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: labels.submit }));
  }

  it('says sign-up is closed, that nothing was created, and to ask for an invitation', async () => {
    closedSignup();
    renderAt(<SignUpPage />);
    await fill({
      workspace: 'Workspace name',
      name: 'Your name',
      email: 'Email',
      password: 'Password',
      submit: 'Create workspace',
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Nothing was created. Sign-up is closed at this address — ask the owner of an existing workspace to invite you.',
    );
    expect(alert).not.toHaveTextContent('Could not create that workspace.');
  });

  it('says it in Turkish when that is the active locale', async () => {
    closedSignup();
    renderWithLocale(
      <MemoryRouter initialEntries={['/']}>
        <SignUpPage />
      </MemoryRouter>,
      'tr',
    );
    await fill({
      workspace: 'Çalışma alanı adı',
      name: 'Adınız',
      email: 'E-posta',
      password: 'Parola',
      submit: 'Çalışma alanı oluştur',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hiçbir şey oluşturulmadı. Bu adreste kayıt kapalı — var olan bir çalışma alanının sahibinden sizi davet etmesini isteyin.',
    );
  });

  it('keeps the generic message for any other not_allowed refusal', async () => {
    // Keyed on the reason, not on the status: a 403 for something else must
    // not tell the person sign-up is closed.
    closedSignup({ reason: 'something_else' });
    renderAt(<SignUpPage />);
    await fill({
      workspace: 'Workspace name',
      name: 'Your name',
      email: 'Email',
      password: 'Password',
      submit: 'Create workspace',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create that workspace.');
  });

  it('says when to come back after the hourly sign-up limit for the network (tm 257.14)', async () => {
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'limit_reached',
        status: 429,
        message: 'Too many workspaces were created from this network recently.',
        requestId: 'req_4',
        details: { reason: 'signup_rate' },
        retryAfterSeconds: 1_800,
      }),
    );
    renderAt(<SignUpPage />);
    await fill({
      workspace: 'Workspace name',
      name: 'Your name',
      email: 'Email',
      password: 'Password',
      submit: 'Create workspace',
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many workspaces were created from this network recently. Try again in an hour.',
    );
    // Not the plan's limit — there is no plan before there is a workspace.
    expect(alert).not.toHaveTextContent('limit for your plan');
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

/**
 * The pilot is one deployment in one region (tm 257.4 · NFR-C9). The picker and
 * its permanence warning have nothing to offer, and — the part a hidden select
 * alone would get wrong — the request must not carry `region` at all: the form
 * state still holds 'eu', and a deployment serving 'us' refuses that with a 421.
 */
describe('SignUpPage in pilot mode (NFR-C9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pilot(): void {
    deployment.current = {
      pilot_mode: true,
      contact_email: 'pilot-desk@siyahtus.test',
      signup_enabled: true,
      email_verification_required: false,
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    };
  }

  it('shows neither the region picker nor its warning', () => {
    pilot();
    renderAt(<SignUpPage />);
    expect(screen.queryByLabelText('Data region')).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be changed after your workspace is created/i)).toBeNull();
    // The rest of the form is unchanged.
    expect(screen.getByLabelText('Workspace name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
  });

  it('sends no region key — the server files the workspace where it runs', async () => {
    pilot();
    const post = vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(new Error('stop here'));
    renderAt(<SignUpPage />);
    await userEvent.type(screen.getByLabelText('Workspace name'), ' Acme ');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await screen.findByRole('alert');
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/auth/signup');
    expect(Object.keys(body as object).sort()).toEqual(
      ['email', 'name', 'organization_name', 'password'].sort(),
    );
  });

  it('still sends the chosen region on an ordinary deployment', async () => {
    const post = vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(new Error('stop here'));
    renderAt(<SignUpPage />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.selectOptions(screen.getByLabelText('Data region'), 'us');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await screen.findByRole('alert');
    expect(post.mock.calls[0]![1]).toMatchObject({ region: 'us' });
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

/**
 * The legal minimum (tm 257.9 · ADR K-f). With terms named, sign-up asks for
 * acceptance — a box outside the form primitive, so the four fields' rules are
 * untouched — and sends the version it showed; every public page links the
 * documents. With none named, nothing appears (the tests above, unchanged).
 */
describe('SignUpPage and the public pages with terms of service (tm 257.9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function withTerms(privacy = true): void {
    deployment.current = {
      ...deployment.current,
      privacy_policy_url: privacy ? 'https://siyahtus.test/privacy' : null,
      terms_url: 'https://siyahtus.test/terms',
      terms_version: '2026-10-01',
    };
  }

  async function fillSignUp(): Promise<void> {
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
  }

  it('shows no box and no links when the deployment names no documents', () => {
    renderAt(<SignUpPage />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms of Service' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull();
  });

  it('keeps Create workspace disabled until the box is ticked', async () => {
    withTerms();
    renderAt(<SignUpPage />);
    await fillSignUp();
    const submit = screen.getByRole('button', { name: 'Create workspace' });
    expect(submit).toBeDisabled();

    const box = screen.getByRole('checkbox', {
      name: 'I agree to the Terms of Service and the Privacy Policy.',
    });
    await userEvent.click(box);
    expect(submit).toBeEnabled();
    await userEvent.click(box);
    expect(submit).toBeDisabled();
  });

  it('links both documents beside the box, in a new tab, outside the label', () => {
    withTerms();
    renderAt(<SignUpPage />);
    const box = screen.getByRole('checkbox');
    const description = document.getElementById(box.getAttribute('aria-describedby')!)!;
    const terms = within(description).getByRole('link', { name: 'Terms of Service' });
    const privacy = within(description).getByRole('link', { name: 'Privacy Policy' });
    expect(terms).toHaveAttribute('href', 'https://siyahtus.test/terms');
    expect(privacy).toHaveAttribute('href', 'https://siyahtus.test/privacy');
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link.closest('label')).toBeNull();
    }
    // The four fields are still found by their own labels.
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('names only the terms when no privacy policy is set', () => {
    withTerms(false);
    renderAt(<SignUpPage />);
    expect(screen.getByRole('checkbox', { name: 'I agree to the Terms of Service.' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull();
  });

  it('sends the version it showed', async () => {
    withTerms();
    const post = vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(new Error('stop here'));
    renderAt(<SignUpPage />);
    await fillSignUp();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await screen.findByRole('alert');
    expect(post.mock.calls[0]![1]).toMatchObject({ terms_version: '2026-10-01' });
  });

  it.each([
    ['terms_not_accepted', /Tick the box to accept the Terms of Service/],
    ['terms_outdated', /changed after this page was opened — reload the page/],
  ])('explains a %s refusal in its own words', async (reason, text) => {
    withTerms();
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'refused',
        requestId: 'req_1',
        details: { reason },
      }),
    );
    renderAt(<SignUpPage />);
    await fillSignUp();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('links the documents under the forgot-password and reset pages too', () => {
    withTerms();
    renderAt(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      'https://siyahtus.test/terms',
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://siyahtus.test/privacy',
    );
  });

  it('tells an invited person the workspace accepted the terms, with no box to tick', async () => {
    withTerms();
    vi.spyOn(ApiClient.prototype, 'get').mockResolvedValue({
      organization_name: 'Acme',
      email: 'robin@example.com',
      role: 'agent',
      needs_password: false,
    });
    renderAt(<JoinPage />, '/join?token=abcdefghijklmnopqrstuvwxyz');

    expect(
      await screen.findByText(
        /By joining, you work under the Terms of Service this workspace accepted/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join workspace' })).toBeEnabled();
  });

  it('says nothing about terms on the join page when none are named', async () => {
    vi.spyOn(ApiClient.prototype, 'get').mockResolvedValue({
      organization_name: 'Acme',
      email: 'robin@example.com',
      role: 'agent',
      needs_password: false,
    });
    renderAt(<JoinPage />, '/join?token=abcdefghijklmnopqrstuvwxyz');
    await screen.findByRole('button', { name: 'Join workspace' });
    expect(screen.queryByText(/By joining/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms of Service' })).toBeNull();
  });
});
