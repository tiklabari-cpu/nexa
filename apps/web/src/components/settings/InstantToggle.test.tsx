/**
 * InstantToggle (tm 323.1 · GV-06): the one control that writes without Save,
 * so the tests pin what makes that safe — it is marked as instant, it confirms
 * with "Saved" + Undo, and a refused write puts the switch back.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { InstantToggle } from './InstantToggle.js';

afterEach(() => {
  resetLocale();
  vi.useRealTimers();
});

describe('InstantToggle (GV-06)', () => {
  it('is marked as an instant control and says so', () => {
    render(<InstantToggle label="Pin navigation" checked={false} onChange={vi.fn()} />);
    expect(document.querySelector('[data-save-pattern="instant"]')).not.toBeNull();
    expect(screen.getByText('Saves instantly')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Pin navigation' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('writes on the flip, then offers Saved and Undo', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<InstantToggle label="Pin navigation" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'),
    );
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('puts the switch back and says so when the write is refused', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('no'));
    render(<InstantToggle label="Pin navigation" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveTextContent("This setting couldn't be saved.");
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('is off while the write is in flight, so a double click sends one request', async () => {
    let finish: () => void = () => undefined;
    const onChange = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<InstantToggle label="Pin navigation" checked={false} onChange={onChange} />);
    await userEvent.dblClick(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch')).toBeDisabled();
    await act(async () => finish());
  });

  it('follows the server value when the prop moves', () => {
    const { rerender } = render(
      <InstantToggle label="Pin navigation" checked={false} onChange={vi.fn()} />,
    );
    rerender(<InstantToggle label="Pin navigation" checked onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('lets the Saved note fade after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<InstantToggle label="Pin navigation" checked={false} onChange={vi.fn()} />);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('switch'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('speaks Turkish when the console does', async () => {
    renderWithLocale(
      <InstantToggle label="Gezinmeyi sabitle" checked={false} onChange={vi.fn()} />,
      'tr',
    );
    expect(screen.getByText('Anında kaydedilir')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText('Kaydedildi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Geri al' })).toBeInTheDocument();
  });
});
