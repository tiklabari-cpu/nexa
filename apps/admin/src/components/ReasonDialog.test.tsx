/**
 * ReasonDialog (tm 389.6 · FR-ADMIN-02/20): the reason every platform mutation carries, and the
 * fresh authenticator code the destructive ones want. Tested on its own because the pages built
 * after the shell (suspend, delete, force ownership transfer, …) all open it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../lib/api-client.js';
import { problem } from '../test/fake-platform.js';
import { ReasonDialog } from './ReasonDialog.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `POST /auth/totp/reverify`: only `123456` renews the window. */
function stubReverify(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { code: string };
    if (body.code !== '123456') return problem(401, 'authentication');
    return new Response(JSON.stringify({ session: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(props: Partial<React.ComponentProps<typeof ReasonDialog>> = {}) {
  const onConfirm = vi.fn(async () => undefined);
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <ReasonDialog
      title="Suspend “Acme Bikes”?"
      description="Every member is locked out until you lift it."
      onConfirm={onConfirm}
      onDone={onDone}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onDone, onCancel };
}

describe('the reason', () => {
  it('names the action and asks for a reason that is recorded', () => {
    mount();

    expect(screen.getByRole('dialog', { name: 'Suspend “Acme Bikes”?' })).toBeVisible();
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    expect(screen.getByText(/written to the platform audit log/)).toBeVisible();
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
  });

  it('refuses a reason shorter than three characters and sends nothing', async () => {
    const user = userEvent.setup();
    const { onConfirm } = mount();

    await user.type(screen.getByLabelText('Reason'), 'ok');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter at least 3 characters.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('caps the reason at 500 characters', () => {
    mount();

    expect(screen.getByLabelText('Reason')).toHaveAttribute('maxlength', '500');
  });

  it('hands the trimmed reason to the caller and reports success', async () => {
    const user = userEvent.setup();
    const { onConfirm, onDone } = mount();

    await user.type(screen.getByLabelText('Reason'), '  Chargeback dispute #4471  ');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'Chargeback dispute #4471' });
  });

  it('keeps the reason and shows the sentence when the server refuses', async () => {
    const user = userEvent.setup();
    const { onDone } = mount({
      onConfirm: async () => {
        throw new ApiClientError({
          type: 'platform_last_superadmin',
          status: 409,
          message: 'English prose for the log',
          requestId: 'r1',
        });
      },
    });

    await user.type(screen.getByLabelText('Reason'), 'Offboarding the last admin');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This would leave the platform without an active superadmin.',
    );
    expect(screen.queryByText(/English prose/)).toBeNull();
    expect(screen.getByLabelText('Reason')).toHaveValue('Offboarding the last admin');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('asks before throwing away a typed reason, and not before an empty one', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onCancel } = mount();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Reason'), 'half a thought');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();

    confirm.mockRestore();
  });
});

describe('the fresh authenticator code', () => {
  it('asks for it up front when the action is destructive, and renews the window first', async () => {
    const user = userEvent.setup();
    const fetchMock = stubReverify();
    const order: string[] = [];
    fetchMock.mockImplementationOnce(async () => {
      order.push('reverify');
      return new Response(JSON.stringify({ session: {} }), { status: 200 });
    });
    const { onConfirm, onDone } = mount({
      requireTotp: true,
      onConfirm: async () => {
        order.push('confirm');
      },
    });

    expect(screen.getByLabelText('Authenticator code')).toBeVisible();
    await user.type(screen.getByLabelText('Reason'), 'Purging a spam workspace');
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(order).toEqual(['reverify', 'confirm']);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not run the mutation when the code is wrong, and says which field', async () => {
    const user = userEvent.setup();
    stubReverify();
    const { onConfirm, onDone } = mount({ requireTotp: true });

    await user.type(screen.getByLabelText('Reason'), 'Purging a spam workspace');
    await user.type(screen.getByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work.');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the code field when the server says the window closed, keeping the reason typed', async () => {
    const user = userEvent.setup();
    stubReverify();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({
          type: 'platform_recent_totp_required',
          status: 403,
          message: 'Confirm with a fresh code',
          requestId: 'r1',
        }),
      )
      .mockResolvedValueOnce(undefined);
    const { onDone } = mount({ onConfirm });

    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
    await user.type(screen.getByLabelText('Reason'), 'Forced ownership transfer');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByLabelText('Authenticator code')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a fresh authenticator code');
    expect(screen.getByLabelText('Reason')).toHaveValue('Forced ownership transfer');

    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
