/**
 * The recommended strip is the discovery half of 05.2: a few cards, each named
 * by category, where "Try this" hands the template back to the caller (which is
 * what copies it into a pre-filled editor — the same round trip the gallery uses,
 * proven end to end in playbook.spec.ts). Here we prove the surface itself: the
 * categories are labelled, "Try this" carries the right template, an integration
 * card warns before you pick it, and "See more" opens the full gallery.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecommendedSkills } from './RecommendedSkills.js';
import { recommendedTemplates } from './templates.js';

describe('RecommendedSkills', () => {
  it('labels its cards by category — Prebuilt, AI and Trending are all present', () => {
    render(<RecommendedSkills onTry={() => {}} onBrowseAll={() => {}} pendingId={null} />);
    const list = screen.getByRole('list', { name: 'Recommended skills' });

    expect(within(list).getAllByText('Prebuilt').length).toBeGreaterThan(0);
    expect(within(list).getAllByText('AI').length).toBeGreaterThan(0);
    expect(within(list).getAllByText('Trending').length).toBeGreaterThan(0);
    // One card per recommended template.
    expect(within(list).getAllByRole('button', { name: 'Try this' })).toHaveLength(
      recommendedTemplates().length,
    );
  });

  it('hands the chosen template back when "Try this" is clicked', async () => {
    const user = userEvent.setup();
    const onTry = vi.fn();
    render(<RecommendedSkills onTry={onTry} onBrowseAll={() => {}} pendingId={null} />);

    // Featured order: the first "Try this" is "Where is my order?".
    await user.click(screen.getAllByRole('button', { name: 'Try this' })[0]!);

    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onTry).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-status' }));
  });

  it('warns on a card whose skill needs an integration', () => {
    render(<RecommendedSkills onTry={() => {}} onBrowseAll={() => {}} pendingId={null} />);
    expect(screen.getByText(/Shopify app connected/)).toBeInTheDocument();
  });

  it('opens the full gallery when "See more" is clicked', async () => {
    const user = userEvent.setup();
    const onBrowseAll = vi.fn();
    render(<RecommendedSkills onTry={() => {}} onBrowseAll={onBrowseAll} pendingId={null} />);

    await user.click(screen.getByRole('button', { name: 'See more' }));
    expect(onBrowseAll).toHaveBeenCalledTimes(1);
  });

  it('shows only the pending card as busy, and leaves the rest usable', () => {
    render(
      <RecommendedSkills onTry={() => {}} onBrowseAll={() => {}} pendingId="order-status" />,
    );

    // The pending card reads "Opening…" and is disabled; the others still invite a try.
    const opening = screen.getByRole('button', { name: 'Opening…' });
    expect(opening).toBeDisabled();
    const others = screen.getAllByRole('button', { name: 'Try this' });
    expect(others.length).toBeGreaterThan(0);
    for (const button of others) expect(button).toBeEnabled();
  });
});
