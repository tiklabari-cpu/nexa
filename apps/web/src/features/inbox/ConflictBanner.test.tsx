/**
 * The multi-agent conflict banner (FR-MOD-08.6.3). It must stay invisible
 * with no live conflict, and announce politely — a screen-reader user should
 * hear it, but not have their current reading interrupted.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictBanner } from './ConflictBanner.js';
import { useConflictStore } from './conflict.js';

const CHAT = 'TJ1H8CFKRV';

const TWO_AGENTS = [
  { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
  { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
];

describe('ConflictBanner', () => {
  beforeEach(() => {
    useConflictStore.setState({ byChat: {} });
  });
  afterEach(() => {
    useConflictStore.getState().clear(CHAT);
  });

  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ConflictBanner chatId={CHAT} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a different chat', () => {
    useConflictStore.getState().note(CHAT, TWO_AGENTS, '2026-08-02T10:00:01.000Z');
    const { container } = render(<ConflictBanner chatId="OTHER_CHAT" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both agents when a conflict is live', () => {
    useConflictStore.getState().note(CHAT, TWO_AGENTS, '2026-08-02T10:00:01.000Z');
    render(<ConflictBanner chatId={CHAT} />);
    const banner = screen.getByTestId('conflict-banner');
    expect(banner).toHaveTextContent('agent-1');
    expect(banner).toHaveTextContent('agent-2');
    expect(banner).toHaveTextContent('2');
  });

  it('disappears once the conflict clears', () => {
    useConflictStore.getState().note(CHAT, TWO_AGENTS, '2026-08-02T10:00:01.000Z');
    const { rerender, container } = render(<ConflictBanner chatId={CHAT} />);
    expect(screen.getByTestId('conflict-banner')).toBeInTheDocument();

    useConflictStore.getState().clear(CHAT);
    rerender(<ConflictBanner chatId={CHAT} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is announced politely via role=status and aria-live=polite', () => {
    useConflictStore.getState().note(CHAT, TWO_AGENTS, '2026-08-02T10:00:01.000Z');
    render(<ConflictBanner chatId={CHAT} />);
    const banner = screen.getByTestId('conflict-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });
});
