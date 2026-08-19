/**
 * Settings → Security: SIEM export screen (C6-f).
 *
 * Everything this screen appears to enforce is the server's
 * (`GET|PATCH /settings/siem`, `GET /settings/siem/status` — C6-b/C6-c); these
 * tests pin the screen: it hides entirely below `admin` (mirroring
 * `minimumRole: 'admin'`), shows the destination and on/off state, PATCHes the
 * right body on toggle/select, reports last export/run and counts (with a
 * meaningful "Never"/"0" before anything has shipped), and shows the gap
 * warning only when `chain_gap_detected` is literally `true` — never for
 * `null` (no chain yet) or `false` (checked, clean).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { SiemExport } = await import('./SiemExport.js');

const OFF_NEVER_RUN = { enabled: false, target: null };
const ON_NEVER_RUN = { enabled: true, target: 'file' };
const STATUS_NEVER_RUN = {
  enabled: false,
  target: null,
  last_run_at: null,
  last_exported_at: null,
  exported_count: 0,
  pending_count: 0,
  chain_gap_detected: null,
};
const STATUS_RUNNING = {
  enabled: true,
  target: 'file',
  last_run_at: '2026-08-15T12:30:00.000Z',
  last_exported_at: '2026-08-15T12:29:00.000Z',
  exported_count: 4200,
  pending_count: 3,
  chain_gap_detected: false,
};
const STATUS_GAP = { ...STATUS_RUNNING, chain_gap_detected: true };

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGet(settings: unknown, status: unknown): (path: string) => Promise<unknown> {
  return (path: string) => {
    if (path === '/settings/siem') return Promise.resolve(settings);
    if (path === '/settings/siem/status') return Promise.resolve(status);
    throw new Error(`unexpected GET ${path}`);
  };
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation(mockGet(OFF_NEVER_RUN, STATUS_NEVER_RUN));
});

describe('SiemExport', () => {
  it('renders nothing below admin, and never fetches', () => {
    currentRole = 'agent';
    renderComponent(<SiemExport canEdit={false} />);

    expect(screen.queryByText('SIEM export')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the off state and a meaningful never-run empty state', async () => {
    renderComponent(<SiemExport canEdit />);

    expect(await screen.findByRole('checkbox', { name: /Enable export/ })).not.toBeChecked();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getAllByText('Never')).toHaveLength(2);
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('shows the destination, delivery counts and timestamps once running', async () => {
    api.get.mockImplementation(mockGet(ON_NEVER_RUN, STATUS_RUNNING));
    renderComponent(<SiemExport canEdit />);

    expect(await screen.findByRole('checkbox', { name: /Enable export/ })).toBeChecked();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('file');
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('toggles the export on by PATCHing enabled', async () => {
    renderComponent(<SiemExport canEdit />);
    const checkbox = await screen.findByRole('checkbox', { name: /Enable export/ });

    await userEvent.click(checkbox);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/siem', { enabled: true }),
    );
  });

  it('changes the destination by PATCHing target', async () => {
    api.get.mockImplementation(mockGet(ON_NEVER_RUN, STATUS_RUNNING));
    renderComponent(<SiemExport canEdit />);
    const select = await screen.findByRole('combobox', { name: 'Destination' });

    await userEvent.selectOptions(select, 'file');

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/siem', { target: 'file' }),
    );
  });

  it('shows the gap warning only when chain_gap_detected is true', async () => {
    api.get.mockImplementation(mockGet(ON_NEVER_RUN, STATUS_RUNNING));
    renderComponent(<SiemExport canEdit />);
    await screen.findByRole('checkbox', { name: /Enable export/ });

    expect(screen.queryByText(/gap was found/)).not.toBeInTheDocument();
  });

  it('shows no gap warning while the chain has never started (null)', async () => {
    renderComponent(<SiemExport canEdit />);
    await screen.findByRole('checkbox', { name: /Enable export/ });

    expect(screen.queryByText(/gap was found/)).not.toBeInTheDocument();
  });

  it('warns when a chain gap is detected', async () => {
    api.get.mockImplementation(mockGet(ON_NEVER_RUN, STATUS_GAP));
    renderComponent(<SiemExport canEdit />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/gap was found/);
  });

  it('disables the controls for a read-only viewer', async () => {
    renderComponent(<SiemExport canEdit={false} />);

    expect(await screen.findByRole('checkbox', { name: /Enable export/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination' })).toBeDisabled();
  });

  it('answers a rejection through the ADR-06 catalogue, not the server’s own wording', async () => {
    api.patch.mockRejectedValue(
      new ApiClientError({ type: 'not_allowed', status: 403, message: 'Nope.', requestId: '-' }),
    );
    renderComponent(<SiemExport canEdit />);
    const checkbox = await screen.findByRole('checkbox', { name: /Enable export/ });

    await userEvent.click(checkbox);

    expect(await screen.findByRole('alert')).toHaveTextContent('That is not allowed here.');
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('SiemExport localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints SiemExport in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <SiemExport canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'SIEM dışa aktarımı' })).toBeInTheDocument();
  });
});
