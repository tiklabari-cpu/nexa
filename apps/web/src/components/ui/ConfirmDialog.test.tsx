/**
 * ConfirmDialog — the one "are you sure?" before an irreversible click (tm 259.7).
 *
 * Escape and the backdrop cancel, focus opens on Cancel so Enter never deletes,
 * "Delete" confirms exactly once, and while the confirmed action runs the danger
 * button is disabled and every dismissal is ignored. `useConfirm` ties that to a
 * promise: the dialog stays up, pending, until the action settles.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '../../lib/api-client.js';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, useConfirm } from './index.js';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Delete tag “vip”?"
      description="The tag is deleted for everyone."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('is a labelled dialog that says what will happen', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Delete tag “vip”?' });
    expect(dialog).toHaveTextContent('The tag is deleted for everyone.');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('opens with focus on Cancel, so Enter does not delete', async () => {
    const { onConfirm, onCancel } = renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape without confirming', async () => {
    const { onConfirm, onCancel } = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on a backdrop press', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once on a click of the danger button, with a custom label', async () => {
    const { onConfirm, onCancel } = renderDialog({ confirmLabel: 'Remove' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('while pending disables both buttons, says it is working, and ignores dismissals', async () => {
    const { onConfirm, onCancel } = renderDialog({ pending: true });
    const working = screen.getByRole('button', { name: 'Working…' });
    expect(working).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await userEvent.click(working);
    await userEvent.keyboard('{Escape}');
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

function Harness({ action, failureTitle }: { action: () => unknown; failureTitle?: string }) {
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          confirm({
            title: 'Delete it?',
            description: 'Gone for good.',
            failureTitle,
            onConfirm: action,
          })
        }
      >
        Trigger
      </button>
      {dialog}
    </div>
  );
}

describe('useConfirm', () => {
  it('opens nothing until asked, and runs nothing until confirmed', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it('closes on Cancel and Escape without running the action', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it('hands focus back to the button that asked, on Cancel and on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness action={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps the dialog up, pending, until the action settles — and runs it once', async () => {
    let finish: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    const user = userEvent.setup();
    await user.dblClick(screen.getByRole('button', { name: 'Delete' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('closes when the action is rejected, without an unhandled rejection', async () => {
    const action = vi.fn(() => Promise.reject(new Error('refused')));
    render(<Harness action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
  });

  // Tm 259.9: with a `failureTitle` a rejection is said, in the dialog.
  const refusal = (): Promise<never> =>
    Promise.reject(
      new ApiClientError({ type: 'internal', status: 500, message: 'x', requestId: 'r' }),
    );

  it('with a failureTitle, a rejection keeps the dialog open and says why', async () => {
    const action = vi.fn(refusal);
    render(<Harness action={action} failureTitle="It could not be deleted." />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'It could not be deleted. Something went wrong on our side — try again.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Live again, not stuck on "Working…".
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('a retry clears the alert while it runs, and closes on success', async () => {
    let attempt = 0;
    let finish: () => void = () => {};
    const action = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return refusal();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    render(<Harness action={action} failureTitle="It could not be deleted." />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('Escape after a refusal closes the dialog and the next opening is clean', async () => {
    const action = vi.fn(refusal);
    render(<Harness action={action} failureTitle="It could not be deleted." />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alert');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes at once for an action that returns nothing', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
  });
});
