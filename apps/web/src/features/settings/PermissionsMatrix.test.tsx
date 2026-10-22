/**
 * Settings › Roles and permissions (RL-02 · tm 325.4).
 *
 * Every value, default and lock is the server's (`GET /settings/permissions`);
 * the fixture is built from the same catalogue the server builds it from
 * (`CAPABILITIES` + `capabilityLock`), so a row added there is drawn here too.
 * What these tests pin is what the screen can get wrong on its own:
 *
 *   1. locked cells are drawn with their reason, and never offered as a control;
 *   2. Save is the GV-06 flow — before/after per moved cell, a required reason —
 *      and the PUT carries only the cells that moved;
 *   3. "Reset to default" sends the default value (the server then drops the
 *      workspace's choice);
 *   4. only the Kurucu edits — a Yönetici reads, a Team Lead or Agent is shown
 *      nothing.
 */
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  MATRIX_ROLES,
  capabilityLock,
  type CapabilityDefinition,
  type CapabilityValue,
} from '@siyahtus/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { hasMessage } from '../../lib/i18n.js';
import type { PermissionMatrix as Matrix } from './PermissionsMatrix.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
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

const { PermissionsMatrix } = await import('./PermissionsMatrix.js');

/** The server's answer for a workspace whose choices are `stored` (`capability|role` → value). */
function matrixWith(stored: Record<string, CapabilityValue> = {}, version = 0): Matrix {
  return {
    version,
    roles: [...MATRIX_ROLES],
    capabilities: CAPABILITIES.map((definition: CapabilityDefinition) => ({
      key: definition.key,
      group: definition.group,
      values: [...definition.values],
      floor_role: definition.floorRole,
      owner_only: definition.ownerOnly === true,
      cells: MATRIX_ROLES.map((role) => ({
        role,
        default: definition.defaults[role],
        value: stored[`${definition.key}|${role}`] ?? definition.defaults[role],
        lock: capabilityLock(definition, role),
      })),
    })),
  };
}

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function row(capability: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`tr[data-capability="${capability}"]`);
  if (!found) throw new Error(`no row for ${capability}`);
  return found;
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.put.mockReset();
});

async function confirmWithReason(
  user: ReturnType<typeof userEvent.setup>,
  reason: string,
): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Reason'), reason);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
  return dialog;
}

describe('PermissionsMatrix (RL-02)', () => {
  it('draws every capability under its group, one column per role', async () => {
    api.get.mockResolvedValue(matrixWith());

    renderComponent(<PermissionsMatrix canEdit />);

    const table = await screen.findByRole('table', { name: 'Permissions by role' });
    for (const role of ['Owner', 'Admin', 'Team Lead', 'Agent']) {
      expect(within(table).getByRole('columnheader', { name: role })).toBeInTheDocument();
    }
    for (const group of ['Chats', 'Player data', 'Reports', 'Billing']) {
      expect(within(table).getByRole('columnheader', { name: group })).toBeInTheDocument();
    }
    expect(table.querySelectorAll('tr[data-capability]')).toHaveLength(CAPABILITIES.length);
  });

  it('locks the Owner column, Owner-only rows and cells below the floor, and says why', async () => {
    api.get.mockResolvedValue(matrixWith());

    renderComponent(<PermissionsMatrix canEdit />);
    await screen.findByRole('table');

    // The Owner column: every row, never a control.
    for (const tr of document.querySelectorAll('tr[data-capability]')) {
      const ownerCell = tr.querySelectorAll('td')[0]!;
      expect(ownerCell.querySelector('[data-locked="owner_column"]')).not.toBeNull();
      expect(ownerCell.querySelector('input, select')).toBeNull();
    }
    // An Owner-only row: locked for everyone else too.
    const sso = row('settings.sso');
    expect(sso.querySelectorAll('[data-locked="owner_only"]')).toHaveLength(3);
    expect(within(sso).queryByRole('switch')).toBeNull();
    // Erasing a player has an Admin floor: Team Lead and Agent are locked off.
    const erase = row('customers.erase');
    expect(erase.querySelectorAll('[data-locked="below_floor"]')).toHaveLength(2);
    expect(
      within(erase).getByRole('switch', { name: 'Erase a player’s data — Admin' }),
    ).toBeChecked();
    expect(
      within(erase).getAllByText(
        /locked: Platform safety: this role cannot be given this permission\./,
      ),
    ).toHaveLength(2);
  });

  it('saves a moved level through the before/after confirm, sending only that cell (GV-06-S1)', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(matrixWith());
    api.put.mockResolvedValue(matrixWith({ 'reports.view|team_lead': 'all' }, 1));

    renderComponent(<PermissionsMatrix canEdit />);

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'View reports — Team Lead' }),
      'all',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('View reports — Team Lead')).toBeInTheDocument();
    expect(within(dialog).getByTestId('high-risk-from-reports.view|team_lead')).toHaveTextContent(
      'None',
    );
    expect(within(dialog).getByTestId('high-risk-to-reports.view|team_lead')).toHaveTextContent(
      'All',
    );
    // No reason, no save.
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    expect(api.put).not.toHaveBeenCalled();

    await confirmWithReason(user, 'Leads run their own weekly review');

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/permissions', {
        changes: [{ role: 'team_lead', capability: 'reports.view', value: 'all' }],
        reason: 'Leads run their own weekly review',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('turns a switch on and off, and an untouched switch back is not a change', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(matrixWith());
    api.put.mockResolvedValue(matrixWith({ 'settings.tags|agent': 'on' }, 1));

    renderComponent(<PermissionsMatrix canEdit />);

    const tags = await screen.findByRole('switch', { name: 'Tags — Agent' });
    expect(tags).not.toBeChecked();
    await user.click(tags);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(tags);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    await user.click(tags);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await confirmWithReason(user, 'Agents curate their tags');

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/permissions', {
        changes: [{ role: 'agent', capability: 'settings.tags', value: 'on' }],
        reason: 'Agents curate their tags',
      }),
    );
  });

  it('marks a workspace choice and resets that cell by sending its default', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(matrixWith({ 'reports.view|agent': 'all' }, 3));
    api.put.mockResolvedValue(matrixWith({}, 4));

    renderComponent(<PermissionsMatrix canEdit />);

    const reports = await screen.findByRole('combobox', { name: 'View reports — Agent' });
    expect(reports).toHaveValue('all');
    expect(within(row('reports.view')).getByText('Changed')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Reset View reports — Agent to the default (None)' }),
    );
    expect(reports).toHaveValue('none');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await confirmWithReason(user, 'Back to the default');

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/permissions', {
        changes: [{ role: 'agent', capability: 'reports.view', value: 'none' }],
        reason: 'Back to the default',
      }),
    );
  });

  it('"Reset all to defaults" moves every changed cell back in the draft, and is off when there is none', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(
      matrixWith({ 'reports.view|agent': 'all', 'settings.tags|team_lead': 'on' }, 2),
    );

    renderComponent(<PermissionsMatrix canEdit />);

    const resetAll = await screen.findByRole('button', { name: 'Reset all to defaults' });
    expect(resetAll).toBeEnabled();
    await user.click(resetAll);

    expect(screen.getByRole('combobox', { name: 'View reports — Agent' })).toHaveValue('none');
    expect(screen.getByRole('switch', { name: 'Tags — Team Lead' })).not.toBeChecked();
    expect(resetAll).toBeDisabled();
    // Nothing is sent until Save.
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('keeps the confirm open with the failure when the server refuses the change', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(matrixWith());
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'locked',
        requestId: 'req-1',
        details: { reason: 'locked', role: 'agent', capability: 'settings.tags' },
      }),
    );

    renderComponent(<PermissionsMatrix canEdit />);

    await user.click(await screen.findByRole('switch', { name: 'Tags — Agent' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await confirmWithReason(user, 'Try it');

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tags — Agent' })).toBeChecked();
  });

  it('shows an Admin the matrix read-only: no control is live and there is no Save', async () => {
    currentRole = 'admin';
    api.get.mockResolvedValue(matrixWith({ 'reports.view|agent': 'all' }, 1));

    renderComponent(<PermissionsMatrix canEdit={false} />);

    expect(
      await screen.findByText(/Read-only: only the Owner can change who may do what/),
    ).toBeInTheDocument();
    for (const control of [...screen.getAllByRole('switch'), ...screen.getAllByRole('combobox')]) {
      expect(control).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull();
    // The workspace's choice is still visible to the reader.
    expect(screen.getByRole('combobox', { name: 'View reports — Agent' })).toHaveValue('all');
  });

  it.each(['team_lead', 'agent'])('shows a %s nothing (the endpoint is Admin and up)', (role) => {
    currentRole = role;
    renderComponent(<PermissionsMatrix canEdit={false} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('has a name in both languages for every catalogue row, group, value and lock', () => {
    const keys = [
      ...CAPABILITIES.map((definition) => definition.labelKey),
      ...CAPABILITY_GROUPS.map((group) => `permissions.group.${group}`),
      ...['off', 'on', 'none', 'own', 'team', 'all'].map((value) => `permissions.value.${value}`),
      ...['owner_column', 'owner_only', 'below_floor'].map((lock) => `permissions.lock.${lock}`),
    ];
    for (const key of keys) {
      expect(hasMessage('en', key), `en ${key}`).toBe(true);
      expect(hasMessage('tr', key), `tr ${key}`).toBe(true);
    }
  });
});
