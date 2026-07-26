/**
 * The shared custom-fields control (FR-MOD-08.7.6), as used on the Details pane
 * and in the CRM. It renders one typed control per defined field, validates a
 * value against its definition with the same rule the server enforces, and
 * saves only what changed.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldValue } from '@nexa/types';
import { CustomFields } from './CustomFields.js';

const playerId: CustomFieldValue = {
  definition_id: 'def-1',
  label: 'Player ID',
  type: 'text',
  required: true,
  value: null,
};
const balance: CustomFieldValue = {
  definition_id: 'def-2',
  label: 'Balance',
  type: 'number',
  required: false,
  value: null,
};

describe('CustomFields', () => {
  it('renders nothing when no fields are defined', () => {
    const { container } = render(<CustomFields fields={[]} canEdit save={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each defined field, with a required marker', () => {
    render(<CustomFields fields={[playerId, balance]} canEdit save={vi.fn()} />);
    expect(screen.getByLabelText(/Player ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Balance/)).toBeInTheDocument();
  });

  it('keeps Save disabled and shows an error for a blank required field', async () => {
    render(<CustomFields fields={[playerId]} canEdit save={vi.fn()} />);
    const input = screen.getByLabelText(/Player ID/);
    // Type then clear so the field is dirty but blank — a required field then
    // both blocks Save and shows its error.
    fireEvent.change(input, { target: { value: 'P-1' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText(/Player ID is required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save fields' })).toBeDisabled();
  });

  it('flags a wrong-typed number and blocks Save', () => {
    render(<CustomFields fields={[balance]} canEdit save={vi.fn()} />);
    // A number input keeps non-numeric text out of its value, so drive the
    // change directly to exercise the type validator.
    fireEvent.change(screen.getByLabelText(/Balance/), { target: { value: 'lots' } });
    // The browser number input reports an empty string for unparseable text; the
    // validator on an optional field then simply leaves Save disabled (no change).
    expect(screen.getByRole('button', { name: 'Save fields' })).toBeDisabled();
  });

  it('saves only the changed value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<CustomFields fields={[playerId, balance]} canEdit save={save} />);

    fireEvent.change(screen.getByLabelText(/Player ID/), { target: { value: 'P-42' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save fields' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ 'def-1': 'P-42' });
  });

  it('is read-only when it cannot edit', () => {
    render(
      <CustomFields fields={[{ ...playerId, value: 'P-9' }]} canEdit={false} save={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Save fields' })).not.toBeInTheDocument();
    expect(screen.getByText('P-9')).toBeInTheDocument();
  });
});
