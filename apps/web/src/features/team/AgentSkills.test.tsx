/**
 * Per-agent skill assignment (FR-MOD-08.6.3): the modal opens with the agent's
 * current skills checked, a changed selection saves through
 * `PUT /agents/{id}/expertise` with the complete `expertise_ids` set, an empty
 * catalogue points to Settings → Skills instead of an empty list, and a
 * caller without the role to edit sees the same catalogue with every control
 * disabled.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { AgentSkills } = await import('./AgentSkills.js');

const CATALOG = {
  items: [
    { id: 1, name: 'Billing', slug: 'billing' },
    { id: 2, name: 'Technical support', slug: 'technical-support' },
    { id: 3, name: 'Onboarding', slug: 'onboarding' },
  ],
};

const AGENT = {
  id: 'agent-1',
  name: 'Ada Lovelace',
  expertise: [{ id: 1, name: 'Billing', slug: 'billing' }],
};

function renderSkills(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue(CATALOG);
  api.put.mockResolvedValue({ ...AGENT, expertise: CATALOG.items });
});

describe('AgentSkills', () => {
  it('opens with the agent’s current skills checked and the rest unchecked', async () => {
    renderSkills(<AgentSkills agent={AGENT} canEdit />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage skills for Ada Lovelace' }));

    expect(await screen.findByRole('checkbox', { name: 'Billing' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Technical support' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Onboarding' })).not.toBeChecked();
  });

  it('saves the changed selection as the complete expertise_ids set', async () => {
    renderSkills(<AgentSkills agent={AGENT} canEdit />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage skills for Ada Lovelace' }));
    await screen.findByRole('checkbox', { name: 'Onboarding' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Onboarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/agents/agent-1/expertise', {
        expertise_ids: [1, 3],
      }),
    );
  });

  it('points to Settings → Skills when the catalogue is empty', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderSkills(<AgentSkills agent={AGENT} canEdit />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage skills for Ada Lovelace' }));

    expect(await screen.findByText('No skills in the catalogue yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add a skill in Settings → Skills before assigning one to an agent here.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('disables every control for a caller without the role to edit', async () => {
    renderSkills(<AgentSkills agent={AGENT} canEdit={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage skills for Ada Lovelace' }));

    expect(await screen.findByRole('checkbox', { name: 'Billing' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Technical support' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
