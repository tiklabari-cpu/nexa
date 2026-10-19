/**
 * Settings › Security › Sensitive data (tm 300.2 · AI-26) — the page states the
 * server's policy, so it is held to the policy itself: every type in the
 * catalogue has a row, and the player/team columns say exactly what
 * `DEFAULT_SENSITIVE_POLICY` masks.
 */
import { DEFAULT_SENSITIVE_POLICY, SENSITIVE_TYPES } from '@siyahtus/types';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { SensitiveData } from './SensitiveData.js';

describe('SensitiveData', () => {
  afterEach(() => {
    resetLocale();
  });

  it('has one row per sensitive type', () => {
    render(<SensitiveData />);
    const table = screen.getByRole('table', { name: 'What is masked, and in whose messages' });
    // The header row, then one per type.
    expect(within(table).getAllByRole('row')).toHaveLength(SENSITIVE_TYPES.length + 1);
  });

  it("says an IBAN is masked in a visitor's message and shown in full in the team's", () => {
    render(<SensitiveData />);
    const row = screen.getByRole('row', { name: /^IBAN/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Masked');
    expect(cells[2]).toHaveTextContent('Shown in full');
  });

  it('matches the server policy for every type', () => {
    render(<SensitiveData />);
    for (const row of screen.getAllByRole('row').slice(1)) {
      const index = screen.getAllByRole('row').indexOf(row) - 1;
      const type = SENSITIVE_TYPES[index]!;
      const cells = within(row).getAllByRole('cell');
      expect(cells[1]).toHaveTextContent(
        DEFAULT_SENSITIVE_POLICY.customer.includes(type) ? 'Masked' : 'Shown in full',
      );
      expect(cells[2]).toHaveTextContent(
        DEFAULT_SENSITIVE_POLICY.agent.includes(type) ? 'Masked' : 'Shown in full',
      );
    }
  });

  it('tells the owner that attachments are not masked', () => {
    render(<SensitiveData />);
    expect(screen.getByText(/a receipt may show a card number or an IBAN/)).toBeInTheDocument();
  });

  it('reads in Turkish when that is the active locale', () => {
    renderWithLocale(<SensitiveData />, 'tr');
    expect(screen.getByRole('heading', { name: 'Hassas veri' })).toBeInTheDocument();
    expect(screen.getAllByText('Maskelenir').length).toBeGreaterThan(0);
  });
});
