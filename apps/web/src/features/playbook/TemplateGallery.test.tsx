/**
 * The gallery renders the catalogue grouped by type, and choosing a card hands
 * the whole template back to the caller — which is what opens the pre-filled
 * editor (05.1). Closed, it renders nothing.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateGallery } from './TemplateGallery.js';

describe('TemplateGallery', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <TemplateGallery open={false} onClose={() => {}} onUse={() => {}} pendingId={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the templates grouped by type', () => {
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Browse templates')).toBeInTheDocument();
    // The three type headings the catalogue advertises.
    expect(within(dialog).getByRole('heading', { name: /Prebuilt/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /AI/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /Trending/ })).toBeInTheDocument();
  });

  it('warns on a card whose skill needs an integration', () => {
    render(<TemplateGallery open onClose={() => {}} onUse={() => {}} pendingId={null} />);
    expect(screen.getByText(/Shopify app connected/)).toBeInTheDocument();
  });

  it('hands the chosen template back when a card is used', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<TemplateGallery open onClose={() => {}} onUse={onUse} pendingId={null} />);

    // Catalogue order: the first "Use template" is the first prebuilt card.
    const first = screen.getAllByRole('button', { name: 'Use template' })[0]!;
    await user.click(first);

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-status' }));
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemplateGallery open onClose={onClose} onUse={() => {}} pendingId={null} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
