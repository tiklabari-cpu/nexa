/**
 * Saved replies and Tags under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until the required fields are filled, and a touched empty field
 * shows its own error line. The list query is stubbed empty so the add form —
 * which lives inside the not-errored branch — renders in isolation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
  ChatFormsSettings,
} = await import('./SettingsPage.js');

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ items: [] });
  api.post.mockReset();
  api.patch.mockReset();
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

/**
 * The "show in Contacts table" checkbox (FR-MOD-03.2.3) — the one control that
 * decides whether a defined field also becomes a row-inline column, rather
 * than only showing on the Details/CRM panel.
 */
describe('CustomFieldsSettings — show in table (FR-MOD-03.2.3)', () => {
  it('sends show_in_table: true for a contact field with the box checked', async () => {
    api.post.mockResolvedValue({ id: 'cf-1' });
    renderComponent(<CustomFieldsSettings canEdit />);

    await userEvent.type(await screen.findByPlaceholderText('Player ID'), 'Player ID');
    await userEvent.selectOptions(screen.getByLabelText('On'), 'contact');
    await userEvent.click(screen.getByLabelText('Show in Contacts table'));
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/custom-fields', {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
      required: false,
      show_in_table: true,
    });
  });

  it('disables the checkbox for a ticket field and never sends it true', async () => {
    api.post.mockResolvedValue({ id: 'cf-2' });
    renderComponent(<CustomFieldsSettings canEdit />);

    await userEvent.type(await screen.findByPlaceholderText('Player ID'), 'Balance');
    // Ticket is the form's own default — no entity selection needed.
    expect(screen.getByLabelText('Show in Contacts table')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      '/settings/custom-fields',
      expect.objectContaining({ entity: 'ticket', show_in_table: false }),
    );
  });

  it('badges a field flagged show_in_table in the list', async () => {
    api.get.mockResolvedValue({
      items: [
        {
          id: 'a',
          entity: 'contact',
          label: 'Player ID',
          type: 'text',
          required: false,
          form_placement: null,
          show_in_table: true,
        },
        {
          id: 'b',
          entity: 'contact',
          label: 'Internal note',
          type: 'text',
          required: false,
          form_placement: null,
          show_in_table: false,
        },
      ],
    });
    renderComponent(<CustomFieldsSettings canEdit />);

    // The label is now an inline-editable input (rename surface, tm 245), so a
    // row is found by its display value rather than by text content.
    const playerRow = (await screen.findByDisplayValue('Player ID')).closest('li');
    expect(playerRow).not.toBeNull();
    expect(within(playerRow!).getByText('In Contacts table')).toBeInTheDocument();

    const noteRow = screen.getByDisplayValue('Internal note').closest('li');
    expect(noteRow).not.toBeNull();
    expect(within(noteRow!).queryByText('In Contacts table')).not.toBeInTheDocument();
  });
});

/**
 * `PATCH /settings/custom-fields/{fieldId}` (tm 215 TRACKED · tm 245): a
 * field could be created and deleted but never renamed, so correcting a typo
 * in the label meant deleting the field and every value stored under it.
 */
describe('CustomFieldsSettings — rename (tm 245)', () => {
  const FIELD = {
    id: 'cf-1',
    entity: 'contact' as const,
    label: 'Player ID',
    type: 'text' as const,
    required: false,
    form_placement: null,
    show_in_table: false,
  };

  it('renames a field by PATCHing on blur', async () => {
    api.get.mockResolvedValue({ items: [FIELD] });
    api.patch.mockResolvedValue({ ...FIELD, label: 'Player identifier' });
    renderComponent(<CustomFieldsSettings canEdit />);

    const field = await screen.findByDisplayValue('Player ID');
    await userEvent.clear(field);
    await userEvent.type(field, 'Player identifier');
    await userEvent.tab();

    await vi.waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/custom-fields/cf-1', {
        label: 'Player identifier',
      }),
    );
  });

  it('does not PATCH when a rename is blurred back to the same label', async () => {
    api.get.mockResolvedValue({ items: [FIELD] });
    renderComponent(<CustomFieldsSettings canEdit />);

    const field = await screen.findByDisplayValue('Player ID');
    await userEvent.click(field);
    await userEvent.tab();

    expect(api.patch).not.toHaveBeenCalled();
  });

  it('shows a rename rejection as an ErrorNotice next to the row', async () => {
    api.get.mockResolvedValue({ items: [FIELD] });
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 409,
        message: 'Another field already uses this label.',
        requestId: '-',
      }),
    );
    renderComponent(<CustomFieldsSettings canEdit />);

    const field = await screen.findByDisplayValue('Player ID');
    await userEvent.clear(field);
    await userEvent.type(field, 'Balance');
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    // The draft reverts to the label the server still holds.
    expect(await screen.findByDisplayValue('Player ID')).toBeInTheDocument();
  });

  it('offers no rename or delete surface to a read-only viewer', async () => {
    api.get.mockResolvedValue({ items: [FIELD] });
    renderComponent(<CustomFieldsSettings canEdit={false} />);

    const field = await screen.findByDisplayValue('Player ID');
    expect(field).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe('ChatFormsSettings validation (FR-MOD-08.7.7)', () => {
  it('keeps Add field disabled until a label is entered', async () => {
    renderComponent(<ChatFormsSettings canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add field' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Order number'), 'Account id');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when the label is left empty', async () => {
    renderComponent(<ChatFormsSettings canEdit />);
    const label = await screen.findByPlaceholderText('Order number');
    await userEvent.click(label);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Name the field.')).toBeInTheDocument();
  });
});

/**
 * The placement selector (08.7.7-b, tm 134.3; widened to four in tm 228) — the
 * one property that decides when a question is asked and, with it, whether the
 * answer is about the person or about the request. It is the only thing standing
 * between "pre-chat only" and the requirement's
 * "pre-chat/post-chat/ticket/prospect".
 */
describe('ChatFormsSettings placement (FR-MOD-08.7.7)', () => {
  it('defaults to pre-chat and offers all four placements the PRD counts', async () => {
    renderComponent(<ChatFormsSettings canEdit />);
    const placement = await screen.findByLabelText('Asked');
    expect(placement).toHaveValue('pre_chat');
    expect(
      Array.from((placement as HTMLSelectElement).options).map((option) => option.value),
    ).toEqual(['pre_chat', 'post_chat', 'ticket', 'prospect']);
  });

  it('creates a ticket-form field as a TICKET field, derived from the placement', async () => {
    // The entity is never a second choice: a `ticket` question's answers land on
    // the ticket the visitor's message opens, and offering the pair separately
    // would let an admin build a combination the endpoint refuses.
    api.post.mockResolvedValue({ id: 'cf-2' });
    renderComponent(<ChatFormsSettings canEdit />);

    await userEvent.type(await screen.findByPlaceholderText('Order number'), 'Affected order');
    await userEvent.selectOptions(screen.getByLabelText('Asked'), 'ticket');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/custom-fields', {
      entity: 'ticket',
      label: 'Affected order',
      type: 'text',
      required: false,
      form_placement: 'ticket',
    });
  });

  it('creates a prospect-form field as a CONTACT field — the question is about the person', async () => {
    api.post.mockResolvedValue({ id: 'cf-3' });
    renderComponent(<ChatFormsSettings canEdit />);

    await userEvent.type(await screen.findByPlaceholderText('Order number'), 'Company');
    await userEvent.selectOptions(screen.getByLabelText('Asked'), 'prospect');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/custom-fields', {
      entity: 'contact',
      label: 'Company',
      type: 'text',
      required: false,
      form_placement: 'prospect',
    });
  });

  it('asks the endpoint for every custom field, not one entity’s', async () => {
    // A ticket-form question is a ticket field, so a contact-only list would
    // hide half of this builder's own questions.
    renderComponent(<ChatFormsSettings canEdit />);
    await screen.findByPlaceholderText('Order number');
    expect(api.get).toHaveBeenCalledWith('/settings/custom-fields');
  });

  it('creates a post-chat field with form_placement: post_chat', async () => {
    api.post.mockResolvedValue({ id: 'cf-1' });
    renderComponent(<ChatFormsSettings canEdit />);

    await userEvent.type(await screen.findByPlaceholderText('Order number'), 'How did we do?');
    await userEvent.selectOptions(screen.getByLabelText('Asked'), 'post_chat');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/custom-fields', {
      entity: 'contact',
      label: 'How did we do?',
      type: 'text',
      required: false,
      form_placement: 'post_chat',
    });
  });

  it('lists the fields of all four forms, each badged with when it is asked, and no CRM-only field', async () => {
    api.get.mockResolvedValue({
      items: [
        {
          id: 'a',
          entity: 'contact',
          label: 'Order number',
          type: 'text',
          required: false,
          form_placement: 'pre_chat',
        },
        {
          id: 'b',
          entity: 'contact',
          label: 'Anything else?',
          type: 'text',
          required: false,
          form_placement: 'post_chat',
        },
        {
          id: 'd',
          entity: 'ticket',
          label: 'Affected order',
          type: 'text',
          required: false,
          form_placement: 'ticket',
        },
        {
          id: 'e',
          entity: 'contact',
          label: 'Company',
          type: 'text',
          required: false,
          form_placement: 'prospect',
        },
        {
          id: 'c',
          entity: 'contact',
          label: 'KYC status',
          type: 'text',
          required: false,
          form_placement: null,
        },
        {
          id: 'f',
          entity: 'ticket',
          label: 'Refund amount',
          type: 'number',
          required: false,
          form_placement: null,
        },
      ],
    });
    renderComponent(<ChatFormsSettings canEdit />);

    expect(await screen.findByText('Order number')).toBeInTheDocument();
    expect(screen.getByText('Anything else?')).toBeInTheDocument();
    expect(screen.getByText('Affected order')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    // A plain CRM or ticket field is not a form question and must not appear
    // here — on either entity, now that the list asks for both.
    expect(screen.queryByText('KYC status')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund amount')).not.toBeInTheDocument();
    // Scoped to the list: the same words are also the selector's options, and a
    // document-wide query would pass on those alone.
    const rows = within(screen.getByRole('list'));
    expect(rows.getByText('Before the chat')).toBeInTheDocument();
    expect(rows.getByText('After the chat')).toBeInTheDocument();
    expect(rows.getByText('Offline message — about the request')).toBeInTheDocument();
    expect(rows.getByText('Offline message — about the person')).toBeInTheDocument();
  });
});

/**
 * One sentinel per component this file's DoD claims translated: the first
 * five from I18N-i (tm 133.9), `Skills`/`TicketRules` from I18N-j (tm 133.10).
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

  it('paints Chat forms in Turkish when that is the active locale', () => {
    renderLocalized(<ChatFormsSettings canEdit />);
    expect(screen.getByRole('region', { name: 'Sohbet formları' })).toBeInTheDocument();
  });

  it('paints Skills in Turkish when that is the active locale', () => {
    renderLocalized(<Skills canEdit />);
    expect(screen.getByRole('region', { name: 'Yetenekler' })).toBeInTheDocument();
  });

  it('paints Ticket rules in Turkish when that is the active locale', () => {
    renderLocalized(<TicketRules canEdit />);
    expect(screen.getByRole('region', { name: 'Talep kuralları' })).toBeInTheDocument();
  });
});
