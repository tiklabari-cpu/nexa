/**
 * The Copilot assist screen (FR-MOD-12.1 / 12.3, 13.7-i KAPSAM: summary +
 * reply suggestion, salt-tüketici). Pins the behaviour that matters: the two
 * assists call the right endpoint, a drafted reply is handed to the composer
 * through the shared store rather than sent, and an archived conversation
 * disables both with a reason — the same three things
 * `apps/web/src/features/inbox/CopilotPanel.test.tsx` pins for its summary
 * and reply sections.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { CopilotScreen } from './CopilotScreen';
import { CopilotContext } from './context';
import { copilotDraftStore } from './copilotDraft';
import type { CopilotApi } from './api';
import type { CopilotReplyDraft, CopilotSummary } from './types';
import { ThemeProvider } from '../../theme/theme';

function fakeApi(overrides: Partial<CopilotApi> = {}): CopilotApi {
  return {
    summarise: async () => ({ summary: '', note_event_id: '' }),
    draftReply: async () => ({ draft: '', sources: [] }),
    ...overrides,
  };
}

async function mount(chatId: string, api: CopilotApi, chatActive = true): Promise<void> {
  await render(
    <ThemeProvider>
      <CopilotContext.Provider value={api}>
        <CopilotScreen chatId={chatId} chatActive={chatActive} />
      </CopilotContext.Provider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  copilotDraftStore.clear('CHAT123');
});

describe('CopilotScreen', () => {
  it('opens with both assists on offer', async () => {
    await mount('CHAT123', fakeApi());

    expect(screen.getByTestId('copilot-summarise')).toBeOnTheScreen();
    expect(screen.getByTestId('copilot-draft-reply')).toBeOnTheScreen();
  });

  it('summarises into an internal note (12.3 / 02.5)', async () => {
    const summary: CopilotSummary = {
      summary: 'Customer asked about a late order.',
      note_event_id: 'e1',
    };
    await mount('CHAT123', fakeApi({ summarise: async () => summary }));

    await fireEvent.press(screen.getByTestId('copilot-summarise'));
    await act(async () => {});

    expect(screen.getByText('Customer asked about a late order.')).toBeOnTheScreen();
    expect(screen.getByText('Added as an internal note.')).toBeOnTheScreen();
  });

  it('shows an error rather than swallowing a failed summary request', async () => {
    await mount(
      'CHAT123',
      fakeApi({
        summarise: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    await fireEvent.press(screen.getByTestId('copilot-summarise'));
    await act(async () => {});

    expect(screen.getByTestId('copilot-summary-error')).toHaveTextContent(
      'Could not reach the server.',
    );
  });

  it('drafts a reply and hands it to the composer rather than sending it (12.3)', async () => {
    const draft: CopilotReplyDraft = {
      draft: 'Refunds over 500 go to finance.',
      sources: [{ name: 'Refund policy', score: 0.8 }],
    };
    await mount('CHAT123', fakeApi({ draftReply: async () => draft }));

    await fireEvent.press(screen.getByTestId('copilot-draft-reply'));
    await act(async () => {});

    expect(screen.getByText('Refunds over 500 go to finance.')).toBeOnTheScreen();
    expect(screen.getByText('From: Refund policy')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('copilot-insert'));

    expect(copilotDraftStore.getDraft('CHAT123')).toBe('Refunds over 500 go to finance.');
  });

  it('calls onInserted once a suggestion is handed off', async () => {
    const onInserted = jest.fn();
    const draft: CopilotReplyDraft = { draft: 'Refunds over 500 go to finance.', sources: [] };
    await render(
      <ThemeProvider>
        <CopilotContext.Provider value={fakeApi({ draftReply: async () => draft })}>
          <CopilotScreen chatId="CHAT123" onInserted={onInserted} />
        </CopilotContext.Provider>
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId('copilot-draft-reply'));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('copilot-insert'));

    expect(onInserted).toHaveBeenCalledTimes(1);
  });

  it('says so when the knowledge base has no suggestion', async () => {
    await mount('CHAT123', fakeApi({ draftReply: async () => ({ draft: '', sources: [] }) }));

    await fireEvent.press(screen.getByTestId('copilot-draft-reply'));
    await act(async () => {});

    expect(screen.getByTestId('copilot-reply-empty')).toBeOnTheScreen();
  });

  it('shows an error rather than swallowing a failed reply request', async () => {
    await mount(
      'CHAT123',
      fakeApi({
        draftReply: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    await fireEvent.press(screen.getByTestId('copilot-draft-reply'));
    await act(async () => {});

    expect(screen.getByTestId('copilot-reply-error')).toHaveTextContent(
      'Could not reach the server.',
    );
  });

  it('disables both assists on an archived conversation, with a reason', async () => {
    await mount('CHAT123', fakeApi(), false);

    expect(screen.getByText('Reopen the conversation to use Copilot.')).toBeOnTheScreen();
    expect(screen.getByTestId('copilot-summarise')).toBeDisabled();
    expect(screen.getByTestId('copilot-draft-reply')).toBeDisabled();
  });

  it('waits for the request rather than showing stale results while pending', async () => {
    let resolveSummary: (value: CopilotSummary) => void = () => {};
    const pending = new Promise<CopilotSummary>((resolve) => {
      resolveSummary = resolve;
    });
    await mount('CHAT123', fakeApi({ summarise: async () => pending }));

    await fireEvent.press(screen.getByTestId('copilot-summarise'));

    expect(screen.getByText('Summarising…')).toBeOnTheScreen();

    await act(async () => {
      resolveSummary({ summary: 'Done.', note_event_id: 'e1' });
    });

    await waitFor(() => expect(screen.getByText('Done.')).toBeOnTheScreen());
  });
});
