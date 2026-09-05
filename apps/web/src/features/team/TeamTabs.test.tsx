/**
 * Team's module-internal navigation (FR-MOD-04.1).
 *
 * `CustomersTabs` proved the shape (a segmented control of `NavLink`s, each a
 * real route); this covers the same two claims for Team's own three: every
 * tab renders as a link a screen reader can navigate to, and opening a nested
 * route directly — the deep-link acceptance criterion — leaves the matching
 * tab (and only that one) marked current.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TeamTabs } from './TeamTabs.js';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TeamTabs />
    </MemoryRouter>,
  );
}

describe('Team module navigation (FR-MOD-04.1)', () => {
  it('renders the three entity groups as links inside their own labelled landmark', () => {
    renderAt('/app/team');

    const nav = screen.getByRole('navigation', { name: 'Team views' });
    for (const name of ['Teammates', 'AI agents', 'Teams']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
      expect(nav).toContainElement(screen.getByRole('link', { name }));
    }
  });

  it('marks Teammates current on the base route, and only Teammates', () => {
    renderAt('/app/team');

    expect(screen.getByRole('link', { name: 'Teammates' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'AI agents' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Teams' })).not.toHaveAttribute('aria-current');
  });

  it('a direct deep link to /app/team/ai-agents marks AI agents current, not Teammates', () => {
    renderAt('/app/team/ai-agents');

    expect(screen.getByRole('link', { name: 'AI agents' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Teammates' })).not.toHaveAttribute('aria-current');
  });

  it('a direct deep link to /app/team/teams marks Teams current, not Teammates', () => {
    renderAt('/app/team/teams');

    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Teammates' })).not.toHaveAttribute('aria-current');
  });
});
