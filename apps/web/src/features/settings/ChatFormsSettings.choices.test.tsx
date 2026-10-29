/**
 * Settings › Chat forms — list questions, editing and order (WG-04). A list
 * question is added with its options (a topic's with the team each routes
 * to), an existing question is edited in place, and ↑ / ↓ move a question
 * within its own form.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRECHAT_CONFIG } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ChatFormsSettings } = await import('./SettingsPage.js');

let customFields: Array<Record<string, unknown>>;

function field(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    entity: 'contact',
    required: false,
    form_placement: 'pre_chat',
    show_in_table: false,
    options: null,
    position: 0,
    created_at: '2026-10-29T00:00:00Z',
    updated_at: '2026-10-29T00:00:00Z',
    ...overrides,
  };
}

function renderCard(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ChatFormsSettings canEdit />
    </QueryClientProvider>,
  );
}

/** The add-a-question form. */
function addForm(): HTMLElement {
  return screen.getByRole('button', { name: 'Add field' }).closest('form')!;
}

beforeEach(() => {
  customFields = [];
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/settings/prechat') {
      return { brand_id: 'b', configured: false, ...structuredClone(DEFAULT_PRECHAT_CONFIG) };
    }
    if (url === '/groups') return { items: [{ id: 7, name: 'Finans' }] };
    return { items: customFields };
  });
  api.post.mockResolvedValue({});
  api.patch.mockResolvedValue({});
});

describe('list questions (WG-04)', () => {
  it('adds a topic with its options and the team each one routes to', async () => {
    renderCard();
    await screen.findByText('No chat questions');
    const form = addForm();

    await userEvent.type(within(form).getByLabelText('Label'), 'Konu');
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'topic');
    // Nothing to save until the list has an option.
    expect(within(form).getByRole('button', { name: 'Add field' })).toBeDisabled();
    expect(within(form).getByText('Add at least one option.')).toBeInTheDocument();

    await userEvent.click(within(form).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(form).getByLabelText('Option 1'), 'Para çekme');
    await userEvent.selectOptions(within(form).getByLabelText('Team for option 1'), 'Finans');
    await userEvent.click(within(form).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(form).getByLabelText('Option 2'), 'Diğer');

    await userEvent.click(within(form).getByRole('button', { name: 'Add field' }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/custom-fields', {
      entity: 'contact',
      label: 'Konu',
      type: 'topic',
      required: false,
      form_placement: 'pre_chat',
      options: [
        { value: 'Para çekme', label: 'Para çekme', target_group_id: 7 },
        { value: 'Diğer', label: 'Diğer' },
      ],
    });
  });

  it('offers a topic only before the chat, and only while the workspace has none', async () => {
    renderCard();
    await screen.findByText('No chat questions');
    const form = addForm();
    const types = () =>
      within(within(form).getByLabelText('Type'))
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);

    expect(types()).toContain('topic');
    await userEvent.selectOptions(within(form).getByLabelText('Asked'), 'post_chat');
    expect(types()).not.toContain('topic');
    expect(types()).toContain('multiselect');
  });

  it('refuses two options with the same label', async () => {
    renderCard();
    await screen.findByText('No chat questions');
    const form = addForm();
    await userEvent.type(within(form).getByLabelText('Label'), 'Oyun');
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'select');
    await userEvent.click(within(form).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(form).getByLabelText('Option 1'), 'Slot');
    await userEvent.click(within(form).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(form).getByLabelText('Option 2'), 'Slot');
    expect(within(form).getByText('Two options have the same label.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add field' })).toBeDisabled();
  });
});

describe('editing and ordering a form', () => {
  beforeEach(() => {
    customFields = [
      field({ id: 'b', label: 'Second', type: 'text', position: 1 }),
      field({
        id: 'a',
        label: 'Oyun',
        type: 'select',
        position: 0,
        options: [{ value: 'slots', label: 'Slot' }],
      }),
      field({ id: 'p', label: 'After', type: 'text', form_placement: 'post_chat', position: 0 }),
    ];
  });

  it('lists each form in its order and moves a question within its own form', async () => {
    renderCard();
    await screen.findByText('Oyun');
    const rows = screen
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.flex-1')?.textContent);
    expect(rows).toEqual(['Oyun', 'Second', 'After']);

    // The first and last of each form cannot move past its edge.
    expect(screen.getByRole('button', { name: 'Move Oyun up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Second down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move After up' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Move Second up' }));
    expect(api.patch).toHaveBeenCalledWith('/settings/custom-fields/b', { position: 0 });
  });

  it('edits a list question in place: label, required and options, keeping stored values', async () => {
    renderCard();
    await screen.findByText('Oyun');
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Oyun' }));

    const editor = screen.getByRole('button', { name: 'Cancel' }).closest('form')!;
    const label = within(editor).getByLabelText('Label');
    await userEvent.clear(label);
    await userEvent.type(label, 'Oyun türü');
    await userEvent.click(within(editor).getByRole('checkbox', { name: 'Required' }));
    // Reword the saved option, add a new one.
    const first = within(editor).getByLabelText('Option 1');
    await userEvent.clear(first);
    await userEvent.type(first, 'Slot oyunları');
    await userEvent.click(within(editor).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(editor).getByLabelText('Option 2'), 'Poker');

    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/settings/custom-fields/a', {
      label: 'Oyun türü',
      required: true,
      options: [
        { value: 'slots', label: 'Slot oyunları' },
        { value: 'Poker', label: 'Poker' },
      ],
    });
  });
});
