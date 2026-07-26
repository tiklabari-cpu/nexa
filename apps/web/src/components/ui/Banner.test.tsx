/**
 * Banner — segmented notice with a dismiss that remembers (FR-EK-C.2).
 *
 * The behaviour that had been missing everywhere: a dismissal keyed by a stable
 * id survives a reload, so an acknowledged notice does not reappear on the next
 * navigation — while an id-less banner forgets by the next mount, and one id's
 * dismissal never silences another's.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Banner, bannerDismissKey } from './index.js';

beforeEach(() => {
  localStorage.clear();
});

describe('Banner', () => {
  it('renders its message and an action, and pairs colour with an icon', () => {
    render(
      <Banner tone="warning" title="Read-only" cta={<button type="button">Subscribe</button>}>
        The trial has ended.
      </Banner>,
    );

    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('The trial has ended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
    // A tone always carries an icon so colour never stands alone (design-brief §3).
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('has no dismiss control unless asked for one', () => {
    render(<Banner tone="info">Heads up.</Banner>);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('remembers a keyed dismissal across remounts', async () => {
    const user = userEvent.setup();
    const view = render(
      <Banner tone="info" id="trial-tip" dismissible>
        A tip you can put away.
      </Banner>,
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Gone now, and the choice is written where a reload can read it.
    expect(screen.queryByText('A tip you can put away.')).toBeNull();
    expect(localStorage.getItem(bannerDismissKey('trial-tip'))).toBe('1');

    // A fresh mount — as a reload would be — stays dismissed rather than flashing.
    view.unmount();
    render(
      <Banner tone="info" id="trial-tip" dismissible>
        A tip you can put away.
      </Banner>,
    );
    expect(screen.queryByText('A tip you can put away.')).toBeNull();
  });

  it('does not let one id silence another', async () => {
    const user = userEvent.setup();
    render(
      <Banner tone="info" id="one" dismissible>
        First.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    // A different notice is untouched by the first's dismissal.
    render(
      <Banner tone="info" id="two" dismissible>
        Second.
      </Banner>,
    );
    expect(screen.getByText('Second.')).toBeInTheDocument();
  });

  it('forgets an id-less dismissal by the next mount', async () => {
    const user = userEvent.setup();
    const view = render(
      <Banner tone="info" dismissible>
        Session only.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Session only.')).toBeNull();

    view.unmount();
    render(
      <Banner tone="info" dismissible>
        Session only.
      </Banner>,
    );
    // No id was given, so nothing was persisted — it comes back.
    expect(screen.getByText('Session only.')).toBeInTheDocument();
  });

  it('starts dismissed when storage already remembers it', () => {
    localStorage.setItem(bannerDismissKey('seen'), '1');
    render(
      <Banner tone="info" id="seen" dismissible>
        You have seen this.
      </Banner>,
    );
    // Never rendered — no flash of a notice already acknowledged.
    expect(screen.queryByText('You have seen this.')).toBeNull();
  });

  it('fires onDismiss when closed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Banner tone="info" dismissible onDismiss={onDismiss}>
        Closable.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
