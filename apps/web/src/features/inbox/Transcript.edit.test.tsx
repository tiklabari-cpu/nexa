/**
 * Correcting a message after it was sent, from the console side
 * (FR-MOD-02.3.7 · PRD §5.2).
 *
 * Two halves, and they answer to different masters. The **control** is offered
 * only where the server would accept the write, so an agent is not invited to
 * press a button that can only come back 403. The **marker** is shown on every
 * bubble that carries one, whoever wrote it: the edit rewrites the text in
 * place, so nobody reading the transcript can see what it used to say — being
 * told that it changed is the whole of what is left.
 *
 * The one refusal deliberately not mirrored here is `channel_delivered`: the
 * transcript has no way to know a conversation arrived over SMS, and guessing
 * would either hide the control on conversations it works on or claim a
 * delivered message was recalled. It surfaces as the inline failure instead.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

const ME = 'agent-me';
const NOW = new Date();

function event(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id: 'TJ1H8CFKRV_1',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: 'Order 12345 is on its way',
    author_id: ME,
    author_type: 'agent',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

type Props = Parameters<typeof Transcript>[0];

function setup(props: Partial<Props> = {}) {
  const onEdit = vi.fn().mockResolvedValue(undefined);
  const initial: Props = {
    chatId: 'TJ1H8CFKRV',
    events: [event()],
    loading: false,
    currentAgentId: ME,
    onEdit,
    ...props,
  };
  render(<Transcript {...initial} />);
  return { onEdit };
}

const editButton = () => screen.queryByRole('button', { name: 'Edit this message' });

describe('Transcript — offering the correction', () => {
  it('offers it on the agent’s own recent message', () => {
    setup();
    expect(editButton()).toBeInTheDocument();
  });

  it("never offers it on the customer's own words", () => {
    // Theirs to keep. The server refuses it too — this is the surface half of
    // the same rule.
    setup({ events: [event({ author_type: 'customer', author_id: 'cust-1' })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it("never offers it on a teammate's message", () => {
    setup({ events: [event({ author_id: 'agent-someone-else' })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it('never offers it on the AI persona’s reply', () => {
    // A bot answers for the workspace and there is nobody behind it to regret
    // a sentence.
    setup({ events: [event({ author_type: 'bot', author_id: ME })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it('never offers it on a system notice', () => {
    setup({ events: [event({ type: 'system_message', author_type: 'system' })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it('stops offering it once the correction window has closed', () => {
    const old = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString();
    setup({ events: [event({ created_at: old })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it('does not offer it on a message still being sent', () => {
    // The optimistic bubble has no server-side event to correct yet.
    setup({ events: [event({ id: 'pending-1', properties: { pending: true } })] });
    expect(editButton()).not.toBeInTheDocument();
  });

  it('offers nothing at all when the surface passes no handler', () => {
    // An archived conversation: `InboxPage` withholds `onEdit`, and the whole
    // affordance disappears rather than failing when pressed.
    render(
      <Transcript chatId="TJ1H8CFKRV" events={[event()]} loading={false} currentAgentId={ME} />,
    );
    expect(editButton()).not.toBeInTheDocument();
  });
});

describe('Transcript — making the correction', () => {
  it('sends the corrected text and closes the editor', async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton()!);
    const field = screen.getByLabelText('Corrected message');
    expect(field).toHaveValue('Order 12345 is on its way');

    await userEvent.clear(field);
    await userEvent.type(field, 'Order 54321 is on its way');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith('TJ1H8CFKRV_1', 'Order 54321 is on its way');
    await waitFor(() =>
      expect(screen.queryByLabelText('Corrected message')).not.toBeInTheDocument(),
    );
  });

  it('sends nothing when the agent cancels', async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton()!);
    await userEvent.type(screen.getByLabelText('Corrected message'), ' — wait');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Corrected message')).not.toBeInTheDocument();
    // The message is still on screen, unchanged: cancelling is not a delete.
    expect(screen.getByText('Order 12345 is on its way')).toBeInTheDocument();
  });

  it('refuses to save an emptied field rather than treating it as a delete', async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton()!);
    await userEvent.clear(screen.getByLabelText('Corrected message'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps the editor open and says so when the server refuses', async () => {
    // The `channel_delivered` case lands here: a reply already delivered as an
    // SMS cannot be recalled, and the agent has to learn that rather than
    // believe they took it back.
    const onEdit = vi.fn().mockRejectedValue(new Error('not_allowed'));
    render(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={[event()]}
        loading={false}
        currentAgentId={ME}
        onEdit={onEdit}
      />,
    );

    await userEvent.click(editButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The correction was not saved.');
    expect(screen.getByLabelText('Corrected message')).toBeInTheDocument();
  });
});

describe('Transcript — the edited marker', () => {
  it('marks a corrected message, on the agent’s own bubble', () => {
    setup({ events: [event({ properties: { edited_at: NOW.toISOString() } })] });
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });

  it("marks it on a teammate's bubble too, which carries no Edit control", () => {
    // The marker is about the reader, not the author: whoever is looking at
    // this transcript can no longer see what the message said.
    setup({
      events: [
        event({ author_id: 'agent-someone-else', properties: { edited_at: NOW.toISOString() } }),
      ],
    });
    expect(screen.getByText(/edited/)).toBeInTheDocument();
    expect(editButton()).not.toBeInTheDocument();
  });

  it('marks nothing on a message that was never corrected', () => {
    setup();
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });

  it('ignores a malformed marker rather than blanking the transcript', () => {
    // `properties` arrives from the wire; a throw in here would take the whole
    // conversation with it.
    setup({
      events: [event({ properties: { edited_at: 42 } as unknown as Record<string, never> })],
    });
    expect(screen.getByText('Order 12345 is on its way')).toBeInTheDocument();
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });
});
