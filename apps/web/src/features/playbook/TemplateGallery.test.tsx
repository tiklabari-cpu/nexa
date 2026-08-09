/**
 * The gallery renders the whole catalogue behind a virtualized, filterable
 * list — search and the category tab narrow it, only the visible window ever
 * reaches the DOM (NFR-P4), and choosing a card hands the whole template back
 * to the caller, which is what opens the pre-filled editor (05.1). Closed, it
 * renders nothing. The dialog's dismissal contract (Escape, backdrop, initial
 * focus) predates all of that and must survive it untouched — covered here as
 * a regression, not assumed.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateGallery } from './TemplateGallery.js';
import { SKILL_TEMPLATES } from './templates.js';

describe('TemplateGallery', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <TemplateGallery open={false} onClose={() => {}} onUse={() => {}} pendingId={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a category tab per catalogue type, each labelled with its count', () => {
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Browse templates')).toBeInTheDocument();
    const allTab = within(dialog).getByRole('tab', { name: /All/ });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: /Prebuilt/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: /AI/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: /Trending/ })).toBeInTheDocument();
  });

  it('warns on a row whose skill needs an integration', async () => {
    const user = userEvent.setup();
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    // Trending (11 entries) fits entirely inside the default virtualized
    // window, so the integration warning is guaranteed to be in the DOM here.
    await user.click(within(dialog).getByRole('tab', { name: /Trending/ }));
    expect(within(dialog).getByText(/Shopify app connected/)).toBeInTheDocument();
  });

  it('hands the chosen template back when a card is used', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<TemplateGallery open onClose={() => {}} onUse={onUse} pendingId={null} />);

    // Catalogue order, no filters active: the first "Use template" is the
    // first prebuilt card.
    const first = screen.getAllByRole('button', { name: 'Use template' })[0]!;
    await user.click(first);

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-status' }));
  });

  it('narrows the catalogue with a debounced name/summary search', async () => {
    const user = userEvent.setup();
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByPlaceholderText('Search templates…');

    await user.type(search, 'warranty');

    await waitFor(() => {
      expect(within(dialog).getByText('Warranty coverage')).toBeInTheDocument();
      expect(within(dialog).queryByText('Where is my order?')).not.toBeInTheDocument();
    });

    await user.clear(search);
    await waitFor(() => {
      expect(within(dialog).getByText('Where is my order?')).toBeInTheDocument();
    });
  });

  it('the category tab shows only that category’s subset', async () => {
    const user = userEvent.setup();
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('tab', { name: /Trending/ }));

    // Trending (11 entries) fits whole in the default window: every row shown
    // belongs to it, and a prebuilt/AI card is gone.
    expect(within(dialog).getByText('Ask for feedback')).toBeInTheDocument();
    expect(within(dialog).queryByText('Where is my order?')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Greet and find the topic')).not.toBeInTheDocument();
  });

  it('windows the catalogue: only a fraction of the 31+ cards ever reach the DOM', () => {
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(31);
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(SKILL_TEMPLATES.length);
    // A generous ceiling: a full 640px fallback viewport plus overscan, not a
    // tight bound on the primitive's own maths (VirtualList.test.tsx owns that).
    expect(rows.length).toBeLessThanOrEqual(20);
  });

  it('shows a meaningful empty state when nothing matches, and "Clear filters" recovers', async () => {
    const user = userEvent.setup();
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByPlaceholderText('Search templates…');

    await user.type(search, 'zzz-no-such-template-zzz');

    await waitFor(() => {
      expect(within(dialog).getByText('No templates match')).toBeInTheDocument();
    });
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(within(dialog).getByText('Where is my order?')).toBeInTheDocument();
    });
  });

  it('moves focus to the close control on open (regression)', () => {
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape (regression)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemplateGallery open onClose={onClose} onUse={() => {}} pendingId={null} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a backdrop click but not a click that starts on the panel (regression)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemplateGallery open onClose={onClose} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    await user.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
