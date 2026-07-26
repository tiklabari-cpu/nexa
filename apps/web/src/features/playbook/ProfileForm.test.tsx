/**
 * The persona form's contract (FR-MOD-06.4): a required name gates Save, edits
 * flow to the live preview, and a change to any persona field — including the
 * multi-select languages — makes the form dirty enough to save.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ProfileForm } = await import('./ProfileForm.js');

const AGENT: AiAgent = {
  id: 'agent-1',
  name: 'Ada',
  kind: 'ai_agent',
  tone: 'friendly',
  avatar_url: null,
  languages: ['en'],
  answer_length: 'short',
  active: true,
  skills_count: 2,
};

function renderForm(agent: AiAgent = AGENT, canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileForm agent={agent} canEdit={canEdit} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.patch.mockReset();
  api.patch.mockResolvedValue(AGENT);
});

describe('ProfileForm', () => {
  it('disables Save until a change is made', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('disables Save and shows an error when the required name is cleared', async () => {
    const user = userEvent.setup();
    renderForm();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.tab(); // blur to surface the error

    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(screen.getByText(/Give the assistant a name/)).toBeInTheDocument();
  });

  it('enables Save once a field changes and PATCHes the persona', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Answer length'), 'long');
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeEnabled();

    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ answer_length: 'long', name: 'Ada' }),
    );
  });

  it('reflects the name in the live preview as it is typed', async () => {
    const user = userEvent.setup();
    renderForm();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Nova');

    // The preview panel renames with the field.
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  it('toggles a language and treats it as a change worth saving', async () => {
    const user = userEvent.setup();
    renderForm();

    const german = screen.getByRole('switch', { name: 'Deutsch' });
    expect(german).toHaveAttribute('aria-checked', 'false');
    await user.click(german);
    expect(german).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  });

  it('is read-only without edit permission', () => {
    renderForm(AGENT, false);
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    // The preview still renders so a viewer sees the current persona.
    const previews = screen.getAllByText('Ada');
    expect(previews.length).toBeGreaterThan(0);
  });
});
