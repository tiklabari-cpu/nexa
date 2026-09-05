/**
 * The composer's rich-text toolbar and emoji picker (FR-MOD-02.3.5).
 *
 * PRD names five composer tools; before this, only canned `#` and attach
 * existed — bold/italic/list were a plain `<textarea>` and there was no emoji
 * picker at all (`#### K02.3.5`). These tests drive the toolbar the way an
 * agent does: select text, press a button, read the markdown it produced —
 * `richText.test.tsx` and `emoji.test.ts` already cover the pure functions
 * underneath, so this file is about the wiring (the ref, the caret, the
 * picker) rather than re-proving the string edits.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

function stubCannedResponsesFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    })),
  );
}

function setup(): HTMLTextAreaElement {
  stubCannedResponsesFetch();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
  return screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — emoji picker (FR-MOD-02.3.5)', () => {
  it('opens the picker and inserts the chosen emoji at the caret, not at the end', async () => {
    const field = setup();
    const user = userEvent.setup();

    await user.type(field, 'Hello world');
    // Caret goes back between "Hello" and " world" — where the insertion has
    // to land for this test to mean anything more than "appends at the end".
    field.setSelectionRange(5, 5);

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    const emojiButton = await screen.findByRole('button', { name: '👍' });
    emojiButton.focus();
    await user.keyboard('{Enter}');

    expect(field).toHaveValue('Hello👍 world');
  });

  it('carries an accessible name on the trigger, so it never ships as an unnamed button', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Insert emoji' })).toBeInTheDocument();
  });
});

describe('Composer — rich text toolbar (FR-MOD-02.3.5)', () => {
  it('wraps the selection in ** for Bold', async () => {
    const field = setup();
    const user = userEvent.setup();

    await user.type(field, 'urgent');
    field.setSelectionRange(0, 6);
    await user.click(screen.getByRole('button', { name: 'Bold' }));

    expect(field).toHaveValue('**urgent**');
  });

  it('wraps the selection in * for Italic', async () => {
    const field = setup();
    const user = userEvent.setup();

    await user.type(field, 'urgent');
    field.setSelectionRange(0, 6);
    await user.click(screen.getByRole('button', { name: 'Italic' }));

    expect(field).toHaveValue('*urgent*');
  });

  it('prefixes the current line with "- " for the list button', async () => {
    const field = setup();
    const user = userEvent.setup();

    await user.type(field, 'first item');
    field.setSelectionRange(0, 0);
    await user.click(screen.getByRole('button', { name: 'Bulleted list' }));

    expect(field).toHaveValue('- first item');
  });
});
