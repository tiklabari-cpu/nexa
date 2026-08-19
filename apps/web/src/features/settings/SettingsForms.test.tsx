/**
 * Saved replies and Tags under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until the required fields are filled, and a touched empty field
 * shows its own error line. The list query is stubbed empty so the add form —
 * which lives inside the not-errored branch — renders in isolation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the components pick up the stubbed client.
const {
  CannedResponses,
  Tags,
  Skills,
  TicketRules,
  TicketEmailTemplates,
  CustomFieldsSettings,
  PreChatFormSettings,
} = await import('./SettingsPage.js');

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ items: [] });
});

describe('CannedResponses validation', () => {
  it('keeps Save reply disabled until both fields are filled', async () => {
    renderComponent(<CannedResponses canEdit />);
    const submit = await screen.findByRole('button', { name: 'Save reply' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('shipping'), 'promo');
    expect(submit).toBeDisabled(); // the reply is still empty

    await userEvent.type(
      screen.getByPlaceholderText(/Standard delivery/),
      'Free shipping this week.',
    );
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when a required field is left empty', async () => {
    renderComponent(<CannedResponses canEdit />);
    const shortcut = await screen.findByPlaceholderText('shipping');
    await userEvent.click(shortcut);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Enter a shortcut.')).toBeInTheDocument();
  });
});

describe('Tags validation', () => {
  it('keeps Add tag disabled until a name is entered', async () => {
    renderComponent(<Tags canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add tag' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('vip'), 'billing');
    expect(submit).toBeEnabled();
  });
});

describe('Skills validation', () => {
  it('keeps Add skill disabled until a name is entered', async () => {
    renderComponent(<Skills canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add skill' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Billing'), 'Technical support');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when the name is left empty', async () => {
    renderComponent(<Skills canEdit />);
    const name = await screen.findByPlaceholderText('Billing');
    await userEvent.click(name);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Name the skill.')).toBeInTheDocument();
  });
});

describe('TicketRules validation', () => {
  it('keeps Add rule disabled until name, condition and action are all filled', async () => {
    renderComponent(<TicketRules canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add rule' });
    expect(submit).toBeDisabled(); // both condition and action still empty

    await userEvent.type(screen.getByPlaceholderText('Refunds'), 'Refund desk');
    expect(submit).toBeDisabled(); // no condition yet

    await userEvent.type(screen.getByPlaceholderText('refund'), 'refund');
    expect(submit).toBeDisabled(); // action value still empty

    await userEvent.type(screen.getByPlaceholderText('50'), '50');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when the subject condition is left empty', async () => {
    renderComponent(<TicketRules canEdit />);
    const subject = await screen.findByPlaceholderText('refund');
    await userEvent.click(subject);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Enter the text the subject must contain.')).toBeInTheDocument();
  });
});

describe('TicketEmailTemplates validation (FR-MOD-08.7.5)', () => {
  // fireEvent sets the raw value: user-event treats `{{` as an escape for a
  // literal `{`, which would fight the very braces these fields are about.
  it('keeps Add template disabled until name, subject and body are valid', async () => {
    renderComponent(<TicketEmailTemplates canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add template' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Ticket received'), 'Ack');
    fireEvent.change(screen.getByPlaceholderText(/We received your ticket/), {
      target: { value: 'Ticket {{ticket.id}}' },
    });
    expect(submit).toBeDisabled(); // body still empty

    fireEvent.change(screen.getByPlaceholderText(/^Hi /), {
      target: { value: 'Hi {{customer.name}}' },
    });
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error and blocks submit on an unknown variable (KK)', async () => {
    renderComponent(<TicketEmailTemplates canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add template' });
    await userEvent.type(screen.getByPlaceholderText('Ticket received'), 'Ack');
    fireEvent.change(screen.getByPlaceholderText(/We received your ticket/), {
      target: { value: 'Hello' },
    });

    const body = screen.getByPlaceholderText(/^Hi /);
    fireEvent.change(body, { target: { value: 'Hi {{customer.foo}}' } });
    fireEvent.blur(body);

    expect(screen.getByText(/Unknown variable/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });
});

describe('CustomFieldsSettings validation (FR-MOD-08.7.6)', () => {
  it('keeps Add field disabled until a label is entered', async () => {
    renderComponent(<CustomFieldsSettings canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add field' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Player ID'), 'KYC status');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when the label is left empty', async () => {
    renderComponent(<CustomFieldsSettings canEdit />);
    const label = await screen.findByPlaceholderText('Player ID');
    await userEvent.click(label);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Name the field.')).toBeInTheDocument();
  });
});

describe('PreChatFormSettings validation (FR-MOD-08.7.7)', () => {
  it('keeps Add field disabled until a label is entered', async () => {
    renderComponent(<PreChatFormSettings canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add field' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Order number'), 'Account id');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when the label is left empty', async () => {
    renderComponent(<PreChatFormSettings canEdit />);
    const label = await screen.findByPlaceholderText('Order number');
    await userEvent.click(label);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Name the field.')).toBeInTheDocument();
  });
});

/**
 * One sentinel per component this file's DoD claims translated (I18N-i, tm
 * 133.9) — `Skills`/`TicketRules` are I18N-j's (tm 133.10) and stay English.
 */
describe('Settings forms localisation (NFR-I18N2)', () => {
  function renderLocalized(ui: ReactElement): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, 'tr');
  }

  afterEach(() => {
    resetLocale();
  });

  it('paints Saved replies in Turkish when that is the active locale', () => {
    renderLocalized(<CannedResponses canEdit />);
    expect(screen.getByRole('region', { name: 'Kayıtlı yanıtlar' })).toBeInTheDocument();
  });

  it('paints Tags in Turkish when that is the active locale', () => {
    renderLocalized(<Tags canEdit />);
    expect(screen.getByRole('region', { name: 'Etiketler' })).toBeInTheDocument();
  });

  it('paints Ticket email templates in Turkish when that is the active locale', () => {
    renderLocalized(<TicketEmailTemplates canEdit />);
    expect(screen.getByRole('region', { name: 'Talep e-posta şablonları' })).toBeInTheDocument();
  });

  it('paints Custom fields in Turkish when that is the active locale', () => {
    renderLocalized(<CustomFieldsSettings canEdit />);
    expect(screen.getByRole('region', { name: 'Özel alanlar' })).toBeInTheDocument();
  });

  it('paints Pre-chat form in Turkish when that is the active locale', () => {
    renderLocalized(<PreChatFormSettings canEdit />);
    expect(screen.getByRole('region', { name: 'Sohbet öncesi form' })).toBeInTheDocument();
  });
});
