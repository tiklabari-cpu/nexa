/**
 * Billing details (tm 383 · BL-02): the owner's form, its validation (the same
 * rules the API applies), the band when no details exist, and the read-only
 * view an admin gets.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { BillingProfileSection } = await import('./BillingProfile.js');

const SAVED = {
  legal_name: 'Işıklı Oyun Ltd. Şti.',
  address_line1: 'Gökdeniz Sk. No: 5',
  address_line2: null,
  city: 'İstanbul',
  postal_code: '34000',
  country: 'TR',
  tax_office: 'Büyük Mükellefler',
  tax_id: '1234567890',
  vat_id: null,
  invoice_email: 'muhasebe@example.com',
  updated_at: '2026-11-01T10:00:00.000Z',
};

function signIn(role: string): void {
  useAuth.setState({
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['billing_manage', 'reports_read'],
      routing_status: 'accepting_chats',
    },
  } as never);
}

function renderSection(canEdit: boolean): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BillingProfileSection canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
});

afterEach(() => {
  useAuth.setState({ agent: null });
});

describe('BillingProfileSection', () => {
  it('asks the owner for details when none exist, and saves them (FR-MOD-10.3)', async () => {
    signIn('owner');
    api.get.mockResolvedValue({ profile: null });
    api.put.mockResolvedValue({ profile: SAVED });
    renderSection(true);

    expect(await screen.findByText('No billing details yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add billing details' }));

    await userEvent.type(screen.getByLabelText('Legal name'), SAVED.legal_name);
    await userEvent.type(screen.getByLabelText('Address'), SAVED.address_line1);
    await userEvent.type(screen.getByLabelText('City'), SAVED.city);
    await userEvent.type(screen.getByLabelText('Postal code (optional)'), '34000');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'TR');
    await userEvent.type(screen.getByLabelText('Tax number'), '123 456 7890');
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/billing/profile', {
        legal_name: SAVED.legal_name,
        address_line1: SAVED.address_line1,
        address_line2: null,
        city: 'İstanbul',
        postal_code: '34000',
        country: 'TR',
        tax_office: null,
        tax_id: '123 456 7890',
        vat_id: null,
        invoice_email: null,
      }),
    );
    expect(await screen.findByTestId('billing-profile')).toHaveTextContent('1234567890');
    expect(screen.queryByText('No billing details yet')).not.toBeInTheDocument();
  });

  it('refuses an invalid Turkish tax number before sending it', async () => {
    signIn('owner');
    api.get.mockResolvedValue({ profile: { ...SAVED } });
    renderSection(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit billing details' }));
    const taxId = screen.getByLabelText('Tax number');
    await userEvent.clear(taxId);
    await userEvent.type(taxId, '12345');
    await userEvent.tab();
    expect(await screen.findByText(/Not a valid tax number for this country/)).toBeInTheDocument();
    expect(taxId).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(api.put).not.toHaveBeenCalled();

    await userEvent.clear(taxId);
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('A company in Türkiye needs a tax number.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('pins the API’s refusal on the field it names', async () => {
    signIn('owner');
    api.get.mockResolvedValue({ profile: { ...SAVED, country: 'DE', tax_id: null } });
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'vat_id: invalid',
        requestId: 'r-1',
        details: { field: 'vat_id', reason: 'vat_id_invalid' },
      }),
    );
    renderSection(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit billing details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(
      await screen.findByText('A VAT number starts with a two-letter country code.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('VAT number (optional)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows an admin the details without a way to change them', async () => {
    signIn('admin');
    api.get.mockResolvedValue({ profile: SAVED });
    renderSection(false);
    expect(await screen.findByTestId('billing-profile')).toHaveTextContent(SAVED.legal_name);
    expect(screen.queryByRole('button', { name: 'Edit billing details' })).not.toBeInTheDocument();
  });

  it('does not ask at all for a role below admin', () => {
    signIn('agent');
    renderSection(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByText('Billing details')).not.toBeInTheDocument();
  });
});
