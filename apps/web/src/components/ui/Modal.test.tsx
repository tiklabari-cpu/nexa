/**
 * Modal — one dismissal contract for every dialog (FR-EK-C.2).
 *
 * Escape and a backdrop click both route through `onClose` (so a dirty guard can
 * sit on that one path), a mousedown that starts on the panel is not a dismiss,
 * and focus moves into the dialog on open unless the content already claimed it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './index.js';

describe('Modal', () => {
  it('is a labelled modal dialog', () => {
    render(
      <Modal onClose={vi.fn()} title="Confirm">
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('names the dialog by an explicit label when there is no title', () => {
    render(
      <Modal onClose={vi.fn()} label="Quick action">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Quick action' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="Confirm">
        <p>Body</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop press but not on a press that starts on the panel', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="Confirm">
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    const overlay = dialog.parentElement as HTMLElement;

    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);

    // A drag that begins on the panel must not be read as a dismiss.
    onClose.mockClear();
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open', () => {
    render(
      <Modal onClose={vi.fn()} title="Confirm">
        <button type="button">Inside</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toHaveFocus();
  });

  it('leaves focus with content that asked for it', () => {
    render(
      <Modal onClose={vi.fn()} title="Confirm">
        <input aria-label="Name" autoFocus />
      </Modal>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('returns focus to the element that opened it, once closed', () => {
    render(<button type="button">Open</button>);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();

    const { unmount } = render(
      <Modal onClose={vi.fn()} title="Confirm">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
  });

  it('traps Tab inside the panel, wrapping at both ends', async () => {
    const user = userEvent.setup();
    render(
      <Modal onClose={vi.fn()} title="Confirm">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    await user.tab();
    expect(last).toHaveFocus();

    // Forward past the last item wraps back to the first, rather than
    // escaping to the page behind the backdrop.
    await user.tab();
    expect(first).toHaveFocus();

    // Backward past the first item wraps to the last.
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('keeps focus pinned to the panel when it has no focusable content', async () => {
    const user = userEvent.setup();
    render(
      <Modal onClose={vi.fn()} title="Confirm">
        <p>Nothing to focus here.</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(dialog).toHaveFocus();
  });
});
