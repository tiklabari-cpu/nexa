/**
 * The composer's mode tabs, as a colour contract (NFR-A11Y1–6, tm 120).
 *
 * `--note` is a foreground almost everywhere it appears — `text-note` on the
 * composer hint, `text-note` and `border-note` on a note bubble — and the token
 * is tuned for that: dark olive on the light theme so it reads on a pale
 * surface, pale amber on the dark theme so it reads on a dark one. The selected
 * "Internal note" tab is the single exception, the one place the token is a
 * *fill*, and it had been carrying literal `text-white`. That is only half
 * right: white on the light `#806413` is 5.60:1, white on the dark `#ffce73` is
 * **1.47:1**, against the 4.5:1 this 12px label needs.
 *
 * These tests pin which tokens the component reaches for; `tokens.test.ts`
 * measures the ratios those tokens produce, in both themes; `a11y.spec.ts`
 * scans the tab actually rendered, in a real browser. jsdom has no computed
 * colour, so the class contract is the most this layer can honestly assert —
 * but it is the layer that catches the fix being reverted by hand.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

function setup(): void {
  // The composer fetches the canned-reply library on mount; keep it quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — mode tabs', () => {
  it('inks the selected note tab with the theme-inverting token, never literal white', async () => {
    setup();
    const noteTab = screen.getByRole('radio', { name: 'Internal note' });
    await userEvent.click(noteTab);
    expect(noteTab).toHaveAttribute('aria-checked', 'true');

    const classes = noteTab.className.split(/\s+/);
    expect(classes).toContain('bg-note');
    // The load-bearing assertion. `text-content-inverse` is `#ffffff` on light
    // and `#0b1020` on dark, so it follows the fill; `text-white` does not.
    expect(classes).toContain('text-content-inverse');
    expect(classes).not.toContain('text-white');
  });

  it('gives the unselected note tab no fill at all', async () => {
    setup();
    const noteTab = screen.getByRole('radio', { name: 'Internal note' });
    expect(noteTab).toHaveAttribute('aria-checked', 'false');
    // The default state is why sixteen axe scans came back clean: with no fill
    // rendered there was no pair to measure. Pinned so a future restyle cannot
    // move the defect here instead.
    expect(noteTab.className).not.toContain('bg-note');
    expect(noteTab.className).toContain('text-content-secondary');
  });

  it('leaves the reply tab on the brand fill, which does carry white', async () => {
    setup();
    const replyTab = screen.getByRole('radio', { name: 'Reply' });
    expect(replyTab).toHaveAttribute('aria-checked', 'true');
    // `--brand-500` is one colour in both themes and the ramp is chosen to carry
    // white — this half of the pair was never the defect and must not be swept
    // into the fix.
    const classes = replyTab.className.split(/\s+/);
    expect(classes).toContain('bg-brand-500');
    expect(classes).toContain('text-white');
  });

  it('keeps the note hint a foreground use of the token', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    // `text-note` on a surface is the *correct* use of the token and the reason
    // the fix belongs at the call site rather than in `tokens.css`: darkening
    // the dark `--note` to rescue the fill would have broken this and the two
    // `text-note`/`border-note` uses in `Transcript.tsx`.
    const hint = screen.getByText('Only your team will see this.');
    expect(hint.className).toContain('text-note');
    expect(hint.className).not.toContain('bg-note');
  });
});
