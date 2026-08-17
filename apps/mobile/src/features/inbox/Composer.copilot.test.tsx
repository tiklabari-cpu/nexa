/**
 * The composer end of the Copilot hand-off (FR-MOD-12.3 / 13.7-i) — the
 * mobile counterpart of `apps/web/src/features/inbox/Composer.copilot.test.tsx`.
 *
 * A draft offered by Copilot must land in the reply field — as a reply, never
 * an internal note — ready for the agent to edit and send. The rest of the
 * composer (send, mode switch, errors) has its own coverage in
 * `ChatScreen.test.tsx`; this pins only the hand-off.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Composer } from './Composer';
import { copilotDraftStore, offerDraft } from '../copilot/copilotDraft';
import { ThemeProvider } from '../../theme/theme';

function renderComposer(chatId: string) {
  return render(
    <ThemeProvider>
      <Composer chatId={chatId} onSend={jest.fn()} sending={false} error={null} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  copilotDraftStore.clear('CHAT1');
  copilotDraftStore.clear('OTHER');
});

describe('Composer ← Copilot draft', () => {
  it('fills the reply field with a drafted reply and consumes it', async () => {
    await renderComposer('CHAT1');
    const input = screen.getByTestId('composer-input');
    expect(input.props.value).toBe('');

    await act(async () => {
      offerDraft('CHAT1', 'Refunds over 500 go to finance.');
    });

    expect(screen.getByTestId('composer-input').props.value).toBe(
      'Refunds over 500 go to finance.',
    );
    // Consumed, so a re-render does not re-apply it over the agent's edits.
    expect(copilotDraftStore.getDraft('CHAT1')).toBeUndefined();
  });

  it('switches to reply mode even if a note was in progress', async () => {
    await renderComposer('CHAT1');
    await fireEvent.press(screen.getByTestId('composer-mode-note'));

    await act(async () => {
      offerDraft('CHAT1', 'Refunds over 500 go to finance.');
    });

    expect(screen.getByTestId('composer-mode-reply')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('ignores a draft addressed to a different chat', async () => {
    await renderComposer('CHAT1');

    await act(async () => {
      offerDraft('OTHER', 'not for this chat');
    });

    expect(screen.getByTestId('composer-input').props.value).toBe('');
  });
});
