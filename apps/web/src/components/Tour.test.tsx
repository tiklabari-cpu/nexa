/**
 * Tour — a short stepped walkthrough over Modal (FR-MOD-02.2.3).
 *
 * Steps are the caller's content; what this owns is the chrome — Back/Next
 * clamp at either end the same way `useStepper` clamps the onboarding wizard,
 * Skip and finishing the last step both close through the one `onClose`, and
 * the progress counter/labels follow the active locale.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tour, type TourStep } from './Tour.js';
import { useLocaleStore } from '../lib/i18n.js';

const STEPS: readonly TourStep[] = [
  { title: 'Your queues', body: 'Filter what you see.' },
  { title: 'The conversation', body: 'Read and reply.' },
  { title: 'Your availability', body: 'Control routing.' },
];

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});

describe('Tour', () => {
  it('opens on the first step, with no Back control yet', () => {
    render(<Tour steps={STEPS} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Your queues' })).toBeInTheDocument();
    expect(screen.getByText('Filter what you see.')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('advances with Next and back up with Back, clamped at either end', async () => {
    const user = userEvent.setup();
    render(<Tour steps={STEPS} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'The conversation' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Your availability' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    // Last step: the primary action reads Done, not Next.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'The conversation' })).toBeInTheDocument();
  });

  it('finishing the last step closes the tour', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour steps={STEPS.slice(0, 1)} onClose={onClose} />);

    // A single-step tour has no Back and its Next already reads Done.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Skip closes immediately, from any step', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour steps={STEPS} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape, the same dismissal path Modal gives every dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour steps={STEPS} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('translates its chrome with the rest of the console', () => {
    useLocaleStore.setState({ locale: 'tr' });
    render(<Tour steps={STEPS} onClose={vi.fn()} />);

    expect(screen.getByText('Adım 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İleri' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atla' })).toBeInTheDocument();
  });
});
