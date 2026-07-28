/**
 * Recommended cards (05.2): "Try this" hands the template to the caller (which
 * copies it into a new skill), integration-bound templates warn, and "See more"
 * widens the shortlist.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecommendedSkills } from './RecommendedSkills.js';

describe('RecommendedSkills', () => {
  it('offers a shortlist of "Try this" cards', () => {
    render(<RecommendedSkills onUse={() => {}} pendingId={null} />);
    const tryButtons = screen.getAllByRole('button', { name: 'Try this' });
    expect(tryButtons.length).toBeGreaterThan(0);
  });

  it('hands the template to the caller on "Try this"', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<RecommendedSkills onUse={onUse} pendingId={null} />);

    const [first] = screen.getAllByRole('button', { name: 'Try this' });
    await user.click(first);

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-status' }));
  });

  it('reveals the rest — including integration warnings — on "See more"', async () => {
    const user = userEvent.setup();
    render(<RecommendedSkills onUse={() => {}} pendingId={null} />);

    const before = screen.getAllByRole('button', { name: 'Try this' }).length;
    expect(screen.queryByText(/Shopify app connected/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'See more' }));

    const after = screen.getAllByRole('button', { name: 'Try this' }).length;
    expect(after).toBeGreaterThan(before);
    expect(screen.getByText(/Shopify app connected/)).toBeInTheDocument();
  });
});
