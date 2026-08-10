/**
 * The traffic board's filter panel (13.2-h): "Add filter" offers a field not
 * already present, a row commits (and only then reaches `onChange`) once it
 * is valid, text fields debounce so a fast typist does not fire a request per
 * keystroke, and "Clear" drops every row at once.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrafficFilters } from './TrafficFilters.js';
import type { TrafficCondition } from './traffic-filters.js';

function renderFilters(initialConditions: TrafficCondition[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <TrafficFilters initialConditions={initialConditions} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

async function addFilter(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add filter' }));
  await user.click(screen.getByRole('button', { name }));
}

describe('TrafficFilters', () => {
  it('shows the panel title and an empty-state message with no conditions', () => {
    renderFilters();
    expect(screen.getByText('Match all filters')).toBeInTheDocument();
    expect(screen.getByText('No filters applied — every visitor is shown.')).toBeInTheDocument();
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('"Add filter" opens a new row for the chosen field', async () => {
    renderFilters();
    await addFilter('Page URL contains');
    expect(screen.getByLabelText('Page URL contains')).toBeInTheDocument();
  });

  it('already-added fields drop out of the "Add filter" menu', async () => {
    const user = userEvent.setup();
    renderFilters();
    await addFilter('Country');

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(screen.queryByRole('button', { name: 'Country' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page URL contains' })).toBeInTheDocument();
  });

  it('adding a select-kind field (a valid default) commits immediately', async () => {
    const { onChange } = renderFilters();
    await addFilter('Lead');
    expect(onChange).toHaveBeenCalledWith([{ field: 'is_lead', value: 'true' }]);
  });

  it('adding a text-kind field does not commit while it is still empty', async () => {
    const { onChange } = renderFilters();
    await addFilter('Country');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an invalid value shows a field-under error and never reaches onChange', async () => {
    const { onChange } = renderFilters();
    await addFilter('Country');

    const input = screen.getByLabelText('Country');
    fireEvent.change(input, { target: { value: 'USA' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Use a 2-letter country code, like US.');
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('debounced commit for text fields', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('fast typing commits once, with the final value, not once per keystroke', async () => {
      const { onChange } = renderFilters([{ field: 'country_code', value: '' }]);
      const input = screen.getByLabelText('Country');

      fireEvent.change(input, { target: { value: 'U' } });
      fireEvent.change(input, { target: { value: 'US' } });
      fireEvent.change(input, { target: { value: 'US' } });

      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([{ field: 'country_code', value: 'US' }]);
    });

    it('a select-kind change is not debounced', () => {
      const { onChange } = renderFilters([{ field: 'is_lead', value: 'true' }]);
      const select = screen.getByLabelText('Lead');

      fireEvent.change(select, { target: { value: 'false' } });

      expect(onChange).toHaveBeenCalledWith([{ field: 'is_lead', value: 'false' }]);
    });
  });

  it('removing a row drops it from the reported list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters([{ field: 'group_id', value: '7' }]);

    await user.click(screen.getByRole('button', { name: 'Remove Group ID filter' }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByLabelText('Group ID')).not.toBeInTheDocument();
  });

  it('"Clear" removes every condition at once', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters([
      { field: 'group_id', value: '7' },
      { field: 'country_code', value: 'US' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText('No filters applied — every visitor is shown.')).toBeInTheDocument();
  });

  it('every row control has an accessible label a keyboard/AT user can reach', async () => {
    renderFilters([{ field: 'group_id', value: '7' }]);
    const input = screen.getByLabelText('Group ID');
    expect(input).toHaveValue('7');
    expect(screen.getByRole('button', { name: 'Remove Group ID filter' })).toBeInTheDocument();
  });

  it('a fresh row does not show an error before it has been touched', async () => {
    renderFilters();
    await addFilter('Country');
    // Empty is invalid, but nothing was typed or blurred yet — no alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
