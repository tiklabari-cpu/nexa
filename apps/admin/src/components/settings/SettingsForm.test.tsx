/**
 * The save pattern's form half (tm 323.1 · GV-06): SettingsForm + SaveBar +
 * ConfirmHighRisk. What is proved:
 *
 *   - clean → Save and Discard off; an edit → "Unsaved changes", Save on; editing
 *     back to the saved value is clean again (dirty is a comparison);
 *   - an invalid draft cannot be saved;
 *   - a save moves the baseline (the bar goes quiet) and a refused save keeps
 *     what was typed and says so;
 *   - a dirty form registers the leave guard (the settings nav / app shell ask
 *     `confirmLeave`), a clean one and one mid-save do not;
 *   - a high-risk form shows the before/after, refuses to confirm without a
 *     reason, sends the reason with the save, and stays open on a refusal.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { confirmLeave } from '../../lib/dirty-guard.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { SettingsForm, type SaveExtra } from './SettingsForm.js';

interface Values {
  name: string;
  retention: number;
}

const SAVED: Values = { name: 'Support', retention: 30 };

function Fields({
  values,
  setValue,
}: {
  values: Values;
  setValue: <K extends keyof Values>(key: K, value: Values[K]) => void;
}) {
  return (
    <>
      <label>
        Name
        <input value={values.name} onChange={(event) => setValue('name', event.target.value)} />
      </label>
      <label>
        Retention
        <input
          value={String(values.retention)}
          onChange={(event) => setValue('retention', Number(event.target.value))}
        />
      </label>
    </>
  );
}

function renderForm(
  onSave: (values: Values, extra: SaveExtra) => unknown,
  extra: Partial<React.ComponentProps<typeof SettingsForm<Values>>> = {},
) {
  return render(
    <SettingsForm<Values> saved={SAVED} onSave={onSave} label="Settings" {...extra}>
      {(form) => <Fields values={form.values} setValue={form.setValue} />}
    </SettingsForm>,
  );
}

const save = () => screen.getByRole('button', { name: /^Save/ });
const discard = () => screen.getByRole('button', { name: 'Discard' });

afterEach(() => {
  resetLocale();
  vi.restoreAllMocks();
});

describe('SettingsForm + SaveBar (GV-06)', () => {
  it('is clean at first: Save and Discard are off', () => {
    renderForm(vi.fn());
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();
    expect(document.querySelector('[data-save-pattern="form"]')).toHaveAttribute(
      'data-dirty',
      'false',
    );
  });

  it('turns dirty on an edit and clean again when the edit is undone', async () => {
    renderForm(vi.fn());
    const name = screen.getByLabelText('Name');
    await userEvent.type(name, 'x');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(save()).toBeEnabled();
    expect(discard()).toBeEnabled();

    await userEvent.type(name, '{Backspace}');
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('discards back to the saved values', async () => {
    renderForm(vi.fn());
    await userEvent.type(screen.getByLabelText('Name'), ' team');
    await userEvent.click(discard());
    expect(screen.getByLabelText('Name')).toHaveValue('Support');
    expect(save()).toBeDisabled();
  });

  it('keeps Save off while the draft does not validate', async () => {
    renderForm(vi.fn(), { isValid: (values) => values.name.trim() !== '' });
    await userEvent.clear(screen.getByLabelText('Name'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('saves the draft, then reads clean without waiting for a refetch', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(onSave);
    await userEvent.type(screen.getByLabelText('Name'), ' team');
    await userEvent.click(save());
    expect(onSave).toHaveBeenCalledWith({ name: 'Support team', retention: 30 }, {});
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toHaveValue('Support team');
  });

  it('submits with Enter in a field, the same as pressing Save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(onSave);
    await userEvent.type(screen.getByLabelText('Name'), 'x{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps what was typed when the save is refused, and says so', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ type: 'internal', message: 'boom', status: 500, requestId: 'r1' }),
      );
    renderForm(onSave);
    await userEvent.type(screen.getByLabelText('Name'), ' team');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes were not saved.');
    expect(screen.getByLabelText('Name')).toHaveValue('Support team');
    expect(save()).toBeEnabled();
  });

  it('follows new server values while clean, but never overwrites an edit', async () => {
    const { rerender } = renderForm(vi.fn());
    const next: Values = { name: 'Billing', retention: 30 };
    rerender(
      <SettingsForm<Values> saved={next} onSave={vi.fn()} label="Settings">
        {(form) => <Fields values={form.values} setValue={form.setValue} />}
      </SettingsForm>,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Billing');

    await userEvent.type(screen.getByLabelText('Name'), '!');
    rerender(
      <SettingsForm<Values>
        saved={{ name: 'Sales', retention: 30 }}
        onSave={vi.fn()}
        label="Settings"
      >
        {(form) => <Fields values={form.values} setValue={form.setValue} />}
      </SettingsForm>,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Billing!');
  });

  it('holds the leave guard while dirty only', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    renderForm(vi.fn());
    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(confirmLeave(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved changes in this section. Leave and discard them?',
    );

    await userEvent.click(discard());
    confirm.mockClear();
    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stops asking while the save is in flight', async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderForm(onSave);
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(save());

    const confirm = vi.fn().mockReturnValue(false);
    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    await act(async () => finish());
  });

  it('arms the browser warning for a tab close while dirty', async () => {
    renderForm(vi.fn());
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText('Name'), 'x');
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('speaks Turkish when the console does', async () => {
    renderWithLocale(
      <SettingsForm<Values> saved={SAVED} onSave={vi.fn()}>
        {(form) => <Fields values={form.values} setValue={form.setValue} />}
      </SettingsForm>,
      'tr',
    );
    expect(screen.getByText('Tüm değişiklikler kaydedildi')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(screen.getByText('Kaydedilmemiş değişiklikler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });
});

describe('ConfirmHighRisk (GV-06-S1)', () => {
  const highRisk = { labels: { retention: 'Retention (days)' } };

  it('shows the change and will not confirm without a reason', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(onSave, { highRisk });
    await userEvent.clear(screen.getByLabelText('Retention'));
    await userEvent.type(screen.getByLabelText('Retention'), '90');
    await userEvent.click(save());

    // A before/after row for the changed, labelled field — and only that one.
    expect(screen.getByTestId('high-risk-from-retention')).toHaveTextContent('30');
    expect(screen.getByTestId('high-risk-to-retention')).toHaveTextContent('90');
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    expect(screen.getByText('Enter a reason for this change.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason with the save and closes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(onSave, { highRisk });
    await userEvent.clear(screen.getByLabelText('Retention'));
    await userEvent.type(screen.getByLabelText('Retention'), '90');
    await userEvent.click(save());

    await userEvent.type(screen.getByLabelText('Reason'), '  Legal asked for 90 days  ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith(
      { name: 'Support', retention: 90 },
      { reason: 'Legal asked for 90 days' },
    );
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('stays open on a refusal and keeps the reason typed', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ type: 'internal', message: 'boom', status: 500, requestId: 'r1' }),
      );
    renderForm(onSave, { highRisk });
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.clear(screen.getByLabelText('Retention'));
    await userEvent.type(screen.getByLabelText('Retention'), '90');
    await userEvent.click(save());
    await userEvent.type(screen.getByLabelText('Reason'), 'because');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));

    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes were not saved.');
    expect(dialog).toContainElement(screen.getByRole('alert'));
    expect(screen.getByLabelText('Reason')).toHaveValue('because');
  });

  it('cancelling keeps the draft and sends nothing', async () => {
    const onSave = vi.fn();
    renderForm(onSave, { highRisk });
    await userEvent.clear(screen.getByLabelText('Retention'));
    await userEvent.type(screen.getByLabelText('Retention'), '90');
    await userEvent.click(save());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Retention')).toHaveValue('90');
    expect(save()).toBeEnabled();
  });

  it('an ordinary form opens no dialog', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(onSave);
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(save());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
