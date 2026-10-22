/**
 * One identifier, copied alone (ID-05 · tm 329).
 *
 * What is pinned: the clipboard gets the 10 characters and nothing else, "Copied"
 * shows for 1.5 s and then goes, the number is spelled out for a screen reader,
 * the name comes from the ids catalogue (so it is the same in both languages),
 * and a refused clipboard selects the number instead of failing silently.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyId } from './CopyId.js';
import { renderWithLocale, resetLocale } from '../test/i18n.js';

const THREAD = 'TJ1H8CFKRV';
const CHAT = 'K3M9Q2XW7B';

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.useRealTimers();
  resetLocale();
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** Let the clipboard promise settle without moving the 1.5 s clock. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('CopyId', () => {
  it('copies the number alone — no name, no link — and says so for 1.5 s', async () => {
    render(<CopyId kind="chat" value={CHAT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Chat ID' }));
    await settle();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CHAT);
    expect(screen.getByRole('status')).toHaveTextContent('Copied');

    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('names the number the way the ids catalogue does, and reads it one character at a time', () => {
    render(<CopyId kind="thread" value={THREAD} />);

    expect(screen.getByText('Thread ID')).toBeInTheDocument();
    // What is drawn is the number; what is read aloud is spelled out.
    expect(screen.getByText(THREAD)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('T J 1 H 8 C F K R V')).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Copy Thread ID' })).toBeInTheDocument();
  });

  it('can leave the name out where a heading already says it', () => {
    render(<CopyId kind="thread" value={THREAD} showLabel={false} />);

    expect(screen.queryByText('Thread ID')).toBeNull();
    // The button still says which number it copies.
    expect(screen.getByRole('button', { name: 'Copy Thread ID' })).toBeInTheDocument();
  });

  it('names the same two numbers in Turkish', () => {
    renderWithLocale(<CopyId kind="chat" value={CHAT} />, 'tr');

    expect(screen.getByText('Chat ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat ID numarasını kopyala' })).toBeInTheDocument();
  });

  it('shows "Kopyalandı" in Turkish', async () => {
    renderWithLocale(<CopyId kind="chat" value={CHAT} />, 'tr');

    fireEvent.click(screen.getByRole('button', { name: 'Chat ID numarasını kopyala' }));
    await settle();

    expect(screen.getByRole('status')).toHaveTextContent('Kopyalandı');
  });

  it('selects the number when the clipboard is refused, and does not claim it copied', async () => {
    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    render(<CopyId kind="chat" value={CHAT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Chat ID' }));
    await settle();

    expect(window.getSelection()?.toString()).toBe(CHAT);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('selects the number when there is no clipboard at all', () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    render(<CopyId kind="chat" value={CHAT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Chat ID' }));

    expect(window.getSelection()?.toString()).toBe(CHAT);
  });

  it('draws the number as a link when it is also a way in, and still copies only the number', async () => {
    render(
      <MemoryRouter>
        <CopyId kind="thread" value={THREAD} href={`/app/inbox?chat=${THREAD}`} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: THREAD })).toHaveAttribute(
      'href',
      `/app/inbox?chat=${THREAD}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Thread ID' }));
    await settle();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(THREAD);
  });
});
