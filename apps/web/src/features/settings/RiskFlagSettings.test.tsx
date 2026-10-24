/**
 * Settings → Risk flags (AI-27 · tm 302.3): the saved Responsible Gaming team
 * and urgent-mail addresses land in the form, a change saves only what changed,
 * a bad address never reaches the network, the catalogue is read off the
 * platform's own table, and anyone below admin is not shown the section.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { RiskFlagSettings } from './RiskFlagSettings.js';
import type { RiskFlagSettingsData } from '../risk/riskFlags.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
  authState: { agent: null as { account_id: string; role: string } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

const SAVED: RiskFlagSettingsData = {
  rg_group_id: 2,
  notify_emails: ['rg@example.com'],
  promo_block: { fraud_suspected: true, complaint_formal: false },
  updated_by: null,
  updated_at: null,
};

function mount(canEdit = true) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RiskFlagSettings canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/risk-flags/settings') return SAVED;
    if (path === '/groups') {
      return {
        items: [
          { id: 1, name: 'Support' },
          { id: 2, name: 'Responsible Gaming' },
        ],
      };
    }
    return { items: [] };
  });
  api.put.mockImplementation(async (_path: string, body: Partial<RiskFlagSettingsData>) => ({
    ...SAVED,
    ...body,
  }));
  authState.agent = { account_id: 'a-1', role: 'admin' };
});

afterEach(() => resetLocale());

describe('Risk flag settings (AI-27)', () => {
  it('is not drawn for an agent', () => {
    authState.agent = { account_id: 'a-1', role: 'agent' };
    mount();
    expect(screen.queryByRole('heading', { name: 'Risk flags' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('starts from the saved team and addresses', async () => {
    mount();
    expect(await screen.findByLabelText('Responsible Gaming team')).toHaveValue('2');
    expect(screen.getByLabelText('Also email urgent flags to')).toHaveValue('rg@example.com');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves only the field that changed', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Responsible Gaming team'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/risk-flags/settings', { rg_group_id: 1 }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('sends the address list trimmed and lower-cased, and can clear the team', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Responsible Gaming team'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Also email urgent flags to'), {
      target: { value: ' RG@example.com, Lead@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/risk-flags/settings', {
        rg_group_id: null,
        notify_emails: ['rg@example.com', 'lead@example.com'],
      }),
    );
  });

  it('lets the list be emptied — nobody beyond the supervisors is mailed', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Also email urgent flags to'), {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/risk-flags/settings', { notify_emails: [] }),
    );
  });

  it('refuses a bad address and a sixth address before the network', async () => {
    mount();
    const field = await screen.findByLabelText('Also email urgent flags to');
    fireEvent.change(field, { target: { value: 'rg@example.com, not-an-address' } });
    fireEvent.blur(field);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '“not-an-address” is not a valid email address.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(field, {
      target: { value: 'a@x.com b@x.com c@x.com d@x.com e@x.com f@x.com' },
    });
    expect(await screen.findByText('At most 5 addresses.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('keeps a team that no longer exists selectable instead of dropping it', async () => {
    api.get.mockImplementation(async (path: string) =>
      path === '/risk-flags/settings'
        ? { ...SAVED, rg_group_id: 9 }
        : { items: [{ id: 1, name: 'Support' }] },
    );
    mount();
    expect(
      await screen.findByRole('option', { name: 'Team #9 (no longer exists)' }),
    ).toBeInTheDocument();
  });

  it("words the server's refusal under the form", async () => {
    api.put.mockRejectedValue(
      new ApiClientError({ type: 'validation', status: 400, message: 'x', requestId: 'r' }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText('Responsible Gaming team'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
  });

  it('is read-only without the write scope', async () => {
    mount(false);
    expect(await screen.findByLabelText('Responsible Gaming team')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('lists every kind of flag with its severity, who clears it and what it does', async () => {
    mount();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    const row = within(table).getByRole('row', { name: /Self-exclusion request/ });
    expect(row).toHaveTextContent('Urgent');
    expect(row).toHaveTextContent('Admin and up');
    expect(row).toHaveTextContent('The AI offers no bonus, promotion or deposit.');
    expect(within(table).getByRole('row', { name: /Abusive/ })).toHaveTextContent(
      'It marks the conversation; it does not change what the AI does.',
    );
  });

  it('is Turkish in a Turkish console', async () => {
    renderWithLocale(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RiskFlagSettings canEdit />
      </QueryClientProvider>,
      'tr',
    );
    expect(await screen.findByLabelText('Sorumlu Oyun ekibi')).toHaveValue('2');
    expect(screen.getAllByText('Bayrak türleri').length).toBeGreaterThan(0);
  });

  describe('campaigns for flagged players (EN-01 · tm 350)', () => {
    it('shows the responsible gaming flags on and locked, and the workspace’s two as saved', async () => {
      mount();
      const locked = await screen.findByRole('checkbox', { name: /Responsible gaming signal/ });
      expect(locked).toBeChecked();
      expect(locked).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /Self-harm/ })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'Suspected fraud' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Formal complaint' })).not.toBeChecked();
      expect(screen.getByRole('button', { name: 'Save campaign rules' })).toBeDisabled();
    });

    it('saves only the changed type, with the reason the high-risk confirm asks for', async () => {
      api.put.mockImplementation(async () => ({
        ...SAVED,
        promo_block: { fraud_suspected: true, complaint_formal: true },
      }));
      mount();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Formal complaint' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save campaign rules' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByTestId('high-risk-from-complaint_formal')).toHaveTextContent(
        'Does not block campaigns',
      );
      expect(within(dialog).getByTestId('high-risk-to-complaint_formal')).toHaveTextContent(
        'Blocks campaigns',
      );
      fireEvent.change(within(dialog).getByLabelText('Reason'), {
        target: { value: 'Şikâyet eden oyunculara bonus göstermeyelim.' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));

      await waitFor(() =>
        expect(api.put).toHaveBeenCalledWith('/risk-flags/settings', {
          promo_block: { complaint_formal: true },
          reason: 'Şikâyet eden oyunculara bonus göstermeyelim.',
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('checkbox', { name: 'Formal complaint' })).toBeChecked();
    });

    it('is read-only without the right to edit', async () => {
      mount(false);
      expect(await screen.findByRole('checkbox', { name: 'Suspected fraud' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Save campaign rules' })).not.toBeInTheDocument();
    });
  });
});
