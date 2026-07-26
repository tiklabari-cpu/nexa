/**
 * Dropdown — the shared menu behaviour (FR-EK-C.2).
 *
 * The account menu's hard-won rules, now guaranteed for every menu: the trigger
 * announces its expanded state, Escape closes and returns focus to it, an
 * outside click dismisses, and the panel is hidden with `display` rather than by
 * trusting the browser to hide a closed `<details>`'s children — the class that
 * is the actual mechanism, asserted so the regression cannot creep back.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dropdown } from './index.js';

function renderMenu() {
  return render(
    <div>
      <Dropdown label="Account" trigger="DO" panelClassName="p-3">
        {({ close }) => (
          <>
            <p>Signed in as Dana</p>
            <button type="button" onClick={() => close(false)}>
              Sign out
            </button>
          </>
        )}
      </Dropdown>
      <button type="button">Elsewhere</button>
    </div>,
  );
}

describe('Dropdown', () => {
  it('names the trigger and reports its collapsed state', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('opens on click and reveals the panel', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('hides the panel with display, not merely paint order', () => {
    renderMenu();
    // The panel wraps the consumer's children directly, so this is the element
    // carrying the hiding mechanism.
    const panel = screen.getByRole('button', { name: 'Sign out' }).parentElement;
    expect(panel).toHaveClass('hidden');
    expect(panel).toHaveClass('group-open:block');
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
    expect(document.activeElement?.tagName).toBe('SUMMARY');
  });

  it('closes when the pointer lands outside', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('lets an item dismiss the menu from within', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });
});
