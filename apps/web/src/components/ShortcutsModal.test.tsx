/**
 * The "?" window (IN-08): "?" opens it on a US and a Turkish keyboard, Esc
 * closes it, the list is searchable with Turkish folding, and typing a question
 * mark in a text field writes one instead of opening it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUTS, registerShortcutHandler } from '../lib/shortcuts.js';
import { useLocaleStore } from '../lib/i18n.js';

const setLocale = (locale: 'en' | 'tr'): void => useLocaleStore.getState().setLocale(locale);
import { ShortcutsHost } from './ShortcutsModal.js';

afterEach(() => {
  setLocale('en');
});

const windowName = 'Keyboard shortcuts';

describe('the keyboard shortcuts window (IN-08)', () => {
  it('opens on "?" from a US keyboard (Shift+/) and closes on Esc', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHost />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.keyboard('{Shift>}?{/Shift}');
    expect(await screen.findByRole('dialog', { name: windowName })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on "?" from a Turkish keyboard, where it is Shift+* (IN-08)', () => {
    render(<ShortcutsHost />);
    fireEvent.keyDown(document.body, { key: '?', code: 'Backslash', shiftKey: true });
    expect(screen.getByRole('dialog', { name: windowName })).toBeInTheDocument();
  });

  it('lists every registered shortcut, grouped by where it works', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHost />);
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: windowName });

    for (const row of SHORTCUTS) {
      expect(dialog.querySelector(`[data-shortcut="${row.id}"]`)).not.toBeNull();
    }
    expect(within(dialog).getByRole('heading', { name: 'Everywhere' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'While writing a reply' }),
    ).toBeInTheDocument();
  });

  it('searches by description and by key, and says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHost />);
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: windowName });
    const search = within(dialog).getByRole('searchbox', { name: 'Search shortcuts' });

    await user.type(search, 'COPILOT');
    expect(dialog.querySelectorAll('[data-shortcut]')).toHaveLength(1);
    expect(dialog.querySelector('[data-shortcut="inbox.toggle-copilot"]')).not.toBeNull();

    await user.clear(search);
    await user.type(search, 'alt');
    expect(dialog.querySelectorAll('[data-shortcut]').length).toBeGreaterThan(1);

    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(within(dialog).getByText('No shortcut matches.')).toBeInTheDocument();
  });

  it('finds Turkish descriptions without the Turkish letters', async () => {
    setLocale('tr');
    const user = userEvent.setup();
    render(<ShortcutsHost />);
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Klavye kısayolları' });

    await user.type(within(dialog).getByRole('searchbox'), 'KOMUT PALETINI');
    expect(dialog.querySelectorAll('[data-shortcut]')).toHaveLength(1);
    expect(dialog.querySelector('[data-shortcut="palette.open"]')).not.toBeNull();
  });

  it('writes a question mark in a text field instead of opening (IN-08)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea aria-label="reply" />
        <ShortcutsHost />
      </>,
    );
    await user.type(screen.getByLabelText('reply'), 'Why?');
    expect(screen.getByLabelText('reply')).toHaveValue('Why?');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the other shortcuts quiet while it is open (IN-08)', async () => {
    const user = userEvent.setup();
    const next = vi.fn();
    const off = registerShortcutHandler('inbox.next-chat', next);
    render(<ShortcutsHost />);

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(next).toHaveBeenCalledTimes(1);

    await user.keyboard('?');
    await screen.findByRole('dialog', { name: windowName });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(next).toHaveBeenCalledTimes(1);
    off();
  });
});
