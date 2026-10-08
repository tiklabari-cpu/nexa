/**
 * The traffic board's filter panel (13.2-h): "Add filter" offers a field not
 * already present, a row commits (and only then reaches `onChange`) once it
 * is valid, text fields debounce so a fast typist does not fire a request per
 * keystroke, and "Clear" drops every row at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { TrafficCondition } from './traffic-filters.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', () => ({ useApiClient: () => api }));

const { TrafficFilters } = await import('./TrafficFilters.js');

const TEAMS = {
  items: [
    { id: 7, name: 'Support' },
    { id: 9, name: 'Billing' },
  ],
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue(TEAMS);
});

function withClient(ui: ReactElement): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function renderFilters(initialConditions: TrafficCondition[] = []) {
  const onChange = vi.fn();
  const utils = render(
    withClient(<TrafficFilters initialConditions={initialConditions} onChange={onChange} />),
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a 2-letter country code, like US.',
    );
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

    await user.click(screen.getByRole('button', { name: 'Remove Team filter' }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
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
    const input = await screen.findByLabelText('Team');
    expect(input).toHaveValue('7');
    expect(screen.getByRole('button', { name: 'Remove Team filter' })).toBeInTheDocument();
  });

  it('a fresh row does not show an error before it has been touched', async () => {
    renderFilters();
    await addFilter('Country');
    // Empty is invalid, but nothing was typed or blurred yet — no alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('TrafficFilters localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the panel chrome in Turkish when that is the active locale', () => {
    renderWithLocale(
      withClient(<TrafficFilters initialConditions={[]} onChange={vi.fn()} />),
      'tr',
    );
    expect(screen.getByText('Tüm filtrelerle eşleştir')).toBeInTheDocument();
    expect(
      screen.getByText('Uygulanan filtre yok — her ziyaretçi gösteriliyor.'),
    ).toBeInTheDocument();
  });

  it('names every field, option and message in Turkish (O14, tm 259.18)', async () => {
    const user = userEvent.setup();
    renderWithLocale(
      withClient(<TrafficFilters initialConditions={[]} onChange={vi.fn()} />),
      'tr',
    );
    await screen.findByRole('button', { name: 'Filtre ekle' });
    await user.click(screen.getByRole('button', { name: 'Filtre ekle' }));
    // Team is offered only once the workspace's teams have loaded.
    for (const name of [
      'Etkinlik',
      'Sayfa adresi şunu içeriyor',
      'Geldiği adres şunu içeriyor',
      'Ülke',
      'Potansiyel müşteri',
      'Ekip',
    ]) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Potansiyel müşteri' }));
    expect(screen.getByRole('option', { name: 'Potansiyel müşteri değil' })).toBeInTheDocument();
  });

  it('shows a Turkish message under an invalid country, never the English one', async () => {
    const user = userEvent.setup();
    renderWithLocale(
      withClient(<TrafficFilters initialConditions={[]} onChange={vi.fn()} />),
      'tr',
    );
    await user.click(screen.getByRole('button', { name: 'Filtre ekle' }));
    await user.click(await screen.findByRole('button', { name: 'Ülke' }));
    const input = screen.getByLabelText('Ülke');
    await user.type(input, 'USA');
    await user.tab();
    expect(await screen.findByText('2 harfli bir ülke kodu kullanın, örneğin TR.')).toBeVisible();
    expect(screen.queryByText(/2-letter/)).not.toBeInTheDocument();
  });
});

describe('TrafficFilters team filter (D18-adjacent: no raw group id, tm 259.18)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('offers the workspace’s teams by name and seeds a new row with the first one', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('button', { name: 'Team' }));

    const select = screen.getByLabelText('Team');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Billing' })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([{ field: 'group_id', value: '7' }]);

    fireEvent.change(select, { target: { value: '9' } });
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'group_id', value: '9' }]);
  });

  it('keeps a restored team that is no longer in the list visible instead of swapping it', async () => {
    renderFilters([{ field: 'group_id', value: '55' }]);
    const select = await screen.findByLabelText('Team');
    expect(select).toHaveValue('55');
    expect(screen.getByRole('option', { name: 'Team 55 (not in your list)' })).toBeInTheDocument();
  });

  it('does not offer the team filter in a workspace with no teams', async () => {
    api.get.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(await screen.findByRole('button', { name: 'Country' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Team' })).not.toBeInTheDocument();
  });
});
