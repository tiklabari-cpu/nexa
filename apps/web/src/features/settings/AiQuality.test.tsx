/**
 * Settings › AI kalite (tm 319.3 · AI-24): the sample rate and the two
 * switches are saved through the section's SaveBar, a rate outside the bounds
 * keeps Save off; the rubric's platform criteria stay critical and typed, a
 * workspace's own criterion is added with a key made from its name and saved
 * as a new version; a reader without the write sees it all read-only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_QA_RUBRIC } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AiQuality, criterionKeyOf } = await import('./AiQuality.js');

const SETTINGS = {
  sample_percent: 5,
  sample_percent_min: 1,
  sample_percent_max: 20,
  prescore_enabled: true,
  conflict_check: true,
};
const RUBRIC = {
  id: 'r0000000-0000-4000-8000-000000000000',
  version: 1,
  criteria: PLATFORM_QA_RUBRIC.map((criterion) => ({ ...criterion })),
  created_by: null,
  created_at: '2026-10-28T02:00:00.000Z',
};

function renderSection(canEdit: boolean): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AiQuality canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/qa/settings') return Promise.resolve(SETTINGS);
    if (path === '/qa/rubric') return Promise.resolve(RUBRIC);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('AiQuality settings (AI-24)', () => {
  it('saves the sample rate and the switches, and keeps Save off outside the bounds', async () => {
    renderSection(true);
    const percent = await screen.findByLabelText('Random sample (%)');
    const sampling = screen.getByRole('form', { name: 'Sampling' });

    await userEvent.clear(percent);
    await userEvent.type(percent, '25');
    expect(screen.getByText('A whole number from 1 to 20.')).toBeInTheDocument();
    expect(within(sampling).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.clear(percent);
    await userEvent.type(percent, '10');
    await userEvent.click(screen.getByLabelText('Let the model pre-score queued conversations'));
    api.put.mockResolvedValueOnce({ ...SETTINGS, sample_percent: 10, prescore_enabled: false });
    await userEvent.click(within(sampling).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/qa/settings', {
        sample_percent: 10,
        prescore_enabled: false,
        conflict_check: true,
      }),
    );
  });

  it('keeps the platform’s critical criteria critical, and saves a new criterion as a new version', async () => {
    renderSection(true);
    const rubric = await screen.findByRole('form', { name: 'Rubric' });

    // The locked two: neither retyped, nor made non-critical, nor removed.
    expect(within(rubric).getByLabelText('Type of “Compliance rules kept”')).toBeDisabled();
    expect(within(rubric).getByLabelText('“Compliance rules kept” is critical')).toBeDisabled();
    expect(
      within(rubric).queryByRole('button', { name: 'Remove “Compliance rules kept”' }),
    ).toBeNull();
    expect(within(rubric).getByLabelText('Weight of “Compliance rules kept”')).toBeEnabled();
    expect(within(rubric).getAllByText('Locked')).toHaveLength(2);

    const save = within(rubric).getByRole('button', { name: 'Save as new version' });
    expect(save).toBeDisabled();
    await userEvent.click(within(rubric).getByRole('button', { name: 'Add criterion' }));
    // A criterion with no name is not a rubric yet.
    expect(within(rubric).getByRole('alert')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.type(
      within(rubric).getByLabelText('Name of criterion 8'),
      'Bonus şartı açıklandı',
    );
    await userEvent.selectOptions(
      within(rubric).getByLabelText('Type of “Bonus şartı açıklandı”'),
      'score_1_5',
    );
    await userEvent.click(within(rubric).getByRole('button', { name: 'Remove “Tone”' }));

    api.put.mockResolvedValueOnce({ ...RUBRIC, id: 'r2', version: 2 });
    await userEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [path, body] = api.put.mock.calls[0]!;
    expect(path).toBe('/qa/rubric');
    const criteria = (body as { criteria: Array<{ key: string }> }).criteria;
    expect(criteria.map((criterion) => criterion.key)).toEqual([
      'topic',
      'required_info',
      'faithfulness',
      'guardrails',
      'handoff_timing',
      'handoff_summary',
      'bonus_sarti_aciklandi',
    ]);
    expect(criteria.at(-1)).toEqual({
      key: 'bonus_sarti_aciklandi',
      label: 'Bonus şartı açıklandı',
      type: 'score_1_5',
      weight: 1,
      critical: false,
      locked: false,
    });
  });

  it('is read-only without the write', async () => {
    renderSection(false);
    expect(await screen.findByLabelText('Random sample (%)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(await screen.findByText(/^Version 1 ·/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add criterion' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('criterionKeyOf', () => {
  it('folds a Turkish name into a key, and never repeats one', () => {
    expect(criterionKeyOf('Çekim süresi doğru', new Set())).toBe('cekim_suresi_dogru');
    expect(criterionKeyOf('İade', new Set(['iade']))).toBe('iade_2');
    expect(criterionKeyOf('3 adım', new Set())).toBe('c_3_adim');
    expect(criterionKeyOf('!!!', new Set())).toBe('criterion');
  });
});
