/**
 * The words around a message that did not go, and where its text lands when
 * the agent takes it back (tm 437). The store and screen halves are in
 * `store.test.ts` and `ChatScreen.test.tsx`; this pins the copy, the merge
 * rule, and the composer's end of "Cancel".
 */
import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { Composer, type ComposerHandle } from './Composer';
import { failedSendCopy, mergeReturnedDraft } from './failedSend';
import { ThemeProvider } from '../../theme/theme';

describe('failed send copy (tm 437)', () => {
  it('says it in Turkish and in English', () => {
    expect(failedSendCopy('tr')).toEqual({
      notSent: 'Gönderilemedi.',
      retry: 'Tekrar dene',
      cancel: 'İptal',
      cancelHint: 'Metni yazma alanına geri koyar.',
    });
    expect(failedSendCopy('en')).toEqual({
      notSent: 'Not sent.',
      retry: 'Try again',
      cancel: 'Cancel',
      cancelHint: 'Puts the text back in the message box.',
    });
  });
});

describe('mergeReturnedDraft (tm 437)', () => {
  it('fills an empty composer with the message, mode included', () => {
    expect(
      mergeReturnedDraft(
        { text: '  ', recipients: 'all' },
        { text: 'a note', recipients: 'agents' },
      ),
    ).toEqual({ text: 'a note', recipients: 'agents' });
    expect(
      mergeReturnedDraft(
        { text: '', recipients: 'agents' },
        { text: 'a reply', recipients: 'all' },
      ),
    ).toEqual({ text: 'a reply', recipients: 'all' });
  });

  it('keeps what is typed, the returned message first', () => {
    expect(
      mergeReturnedDraft(
        { text: 'typed', recipients: 'all' },
        { text: 'returned', recipients: 'all' },
      ),
    ).toEqual({ text: 'returned\ntyped', recipients: 'all' });
  });

  it('makes the merge a note when either half was one, so nothing internal reaches the customer', () => {
    expect(
      mergeReturnedDraft(
        { text: 'thanks!', recipients: 'all' },
        { text: 'card declined', recipients: 'agents' },
      ).recipients,
    ).toBe('agents');
    expect(
      mergeReturnedDraft(
        { text: 'internal', recipients: 'agents' },
        { text: 'hello', recipients: 'all' },
      ).recipients,
    ).toBe('agents');
  });
});

describe('Composer.restore (tm 437)', () => {
  it('loses neither of two messages taken back before the screen re-renders', async () => {
    const ref = createRef<ComposerHandle>();
    await render(
      <ThemeProvider>
        <Composer ref={ref} chatId="CHAT1" onSend={jest.fn()} sending={false} error={null} />
      </ThemeProvider>,
    );

    await act(async () => {
      ref.current?.restore({ text: 'first', recipients: 'all' });
      ref.current?.restore({ text: 'second', recipients: 'agents' });
    });

    expect(screen.getByTestId('composer-input').props.value).toBe('second\nfirst');
    expect(screen.getByTestId('composer-mode-note')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('shows a returned message in a closed composer rather than dropping it', async () => {
    const ref = createRef<ComposerHandle>();
    await render(
      <ThemeProvider>
        <Composer
          ref={ref}
          chatId="CHAT1"
          onSend={jest.fn()}
          sending={false}
          error={null}
          disabled
        />
      </ThemeProvider>,
    );

    await act(async () => {
      ref.current?.restore({ text: 'on my way', recipients: 'all' });
    });

    expect(screen.getByTestId('composer-input').props.value).toBe('on my way');
    expect(screen.getByTestId('composer-send')).toBeDisabled();
  });
});
