/**
 * The Contacts filter panel (FR-MOD-03.2.1): "Add filter" offers a field not
 * already present, a row commits (and only then reaches `onChange`) once it
 * is valid, and "Clear" drops every row at once — the same behaviour
 * `TrafficFilters.test.tsx` already established for the shared
 * `ConditionFilters` panel, exercised here against Contacts' own field set.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomersFilters } from './CustomersFilters.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { CustomerCondition } from './customers-filters.js';

function renderFilters(initialConditions: CustomerCondition[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <CustomersFilters initialConditions={initialConditions} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

async function addFilter(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add filter' }));
  await user.click(screen.getByRole('button', { name }));
}

describe('CustomersFilters (FR-MOD-03.2.1)', () => {
  it('shows the panel title and an empty-state message with no conditions', () => {
    renderFilters();
    expect(screen.getByText('Match all filters')).toBeInTheDocument();
    expect(screen.getByText('No filters applied — everyone is shown.')).toBeInTheDocument();
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('"Add filter" opens a new row for the chosen field', async () => {
    renderFilters();
    await addFilter('Country');
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
  });

  it('already-added fields drop out of the "Add filter" menu', async () => {
    const user = userEvent.setup();
    renderFilters();
    await addFilter('Country');

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(screen.queryByRole('button', { name: 'Country' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Has tickets' })).toBeInTheDocument();
  });

  it('adding a select-kind field (a valid default) commits immediately', async () => {
    const { onChange } = renderFilters();
    await addFilter('Has tickets');
    expect(onChange).toHaveBeenCalledWith([{ field: 'has_tickets', value: 'true' }]);
  });

  it('adding a text-kind field does not commit while it is still empty', async () => {
    const { onChange } = renderFilters();
    await addFilter('Country');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an invalid country code shows a field-under error and never reaches onChange', async () => {
    const { onChange } = renderFilters();
    await addFilter('Country');

    const input = screen.getByLabelText('Country');
    fireEvent.change(input, { target: { value: 'USA' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a 2-letter country code, like US.',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a date-kind field commits the moment it is picked, without a debounce', async () => {
    const { onChange } = renderFilters();
    await addFilter('Active from');

    const input = screen.getByLabelText('Active from');
    fireEvent.change(input, { target: { value: '2026-01-01' } });

    expect(onChange).toHaveBeenCalledWith([{ field: 'last_activity_from', value: '2026-01-01' }]);
  });

  describe('debounced commit for text fields', () => {
    it('fast typing commits once, with the final value, not once per keystroke', async () => {
      vi.useFakeTimers();
      const { onChange } = renderFilters([{ field: 'country_code', value: '' }]);
      const input = screen.getByLabelText('Country');

      fireEvent.change(input, { target: { value: 'U' } });
      fireEvent.change(input, { target: { value: 'US' } });
      fireEvent.change(input, { target: { value: 'US' } });

      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([{ field: 'country_code', value: 'US' }]);
      vi.useRealTimers();
    });
  });

  it('removing a row drops it from the reported list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters([{ field: 'has_tickets', value: 'true' }]);

    await user.click(screen.getByRole('button', { name: 'Remove Has tickets filter' }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByLabelText('Has tickets')).not.toBeInTheDocument();
  });

  it('"Clear" removes every condition at once', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters([
      { field: 'has_tickets', value: 'true' },
      { field: 'country_code', value: 'US' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText('No filters applied — everyone is shown.')).toBeInTheDocument();
  });
});

describe('CustomersFilters localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the panel chrome in Turkish when that is the active locale', () => {
    renderWithLocale(<CustomersFilters initialConditions={[]} onChange={vi.fn()} />, 'tr');
    expect(screen.getByText('Tüm filtrelerle eşleştir')).toBeInTheDocument();
    expect(screen.getByText('Uygulanan filtre yok — herkes gösteriliyor.')).toBeInTheDocument();
  });
});
