/**
 * The risk flags in the inbox (AI-27 · tm 302.3): the header's chips and the
 * Details panel's Risk section read the same two lists, show what the server
 * lets the caller see and nothing more, and call the routes that flag and clear
 * — refusals worded in the dialog, in the console's language.
 *
 * Acceptance (KK): a Team Lead cannot clear an `rg_signal` and a Manager can,
 * with a reason; a note only reaches a caller the server sent it to; the flag
 * the player got yesterday is on today's conversation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { applyPush } from '../inbox/useInbox.js';
import { flag } from '../../test/risk-flags.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { RiskChips } from './RiskChips.js';
import { RiskSection } from './RiskSection.js';
import type { RiskFlagItem } from './riskFlags.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), request: vi.fn() },
  authState: { agent: null as { account_id: string; role: string } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

const CHAT = 'CHAT1';
const CUSTOMER = 'cust-1';

/** What the two list routes answer: the chat's flags, then the player's. */
let chatFlags: RiskFlagItem[];
let playerFlags: RiskFlagItem[];

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(ui: ReactElement, queryClient = client()) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const refusal = (type: ApiClientError['type'], status: number, reason: string) =>
  new ApiClientError({
    type,
    status,
    message: 'refused',
    requestId: 'req-1',
    details: { reason },
  });

beforeEach(() => {
  chatFlags = [];
  playerFlags = [];
  api.get.mockReset();
  api.post.mockReset();
  api.request.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/risk-flags')) return { items: chatFlags };
    if (path.startsWith('/customers/')) return { items: playerFlags };
    return { items: [] };
  });
  api.post.mockResolvedValue(flag());
  api.request.mockResolvedValue(flag({ status: 'cleared' }));
  authState.agent = { account_id: 'agent-1', role: 'admin' };
});

afterEach(() => resetLocale());

describe('RiskChips — the header (AI-27)', () => {
  it('draws nothing for a conversation with no active flag', async () => {
    mount(<RiskChips chatId={CHAT} customerId={CUSTOMER} compact={false} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('asks for the active flags of the chat and of the player', async () => {
    mount(<RiskChips chatId={CHAT} customerId={CUSTOMER} compact={false} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get).toHaveBeenCalledWith(`/risk-flags?chat_id=${CHAT}&status=active`);
    expect(api.get).toHaveBeenCalledWith(`/customers/${CUSTOMER}/risk-flags?status=active`);
  });

  it('shows the most urgent flags first and folds the rest into a count', async () => {
    chatFlags = [
      flag({ id: 'a', type: 'abusive', severity: 'info' }),
      flag({ id: 'b', type: 'self_harm', severity: 'urgent' }),
      flag({ id: 'c', type: 'complaint_formal', severity: 'high' }),
      flag({ id: 'd', type: 'multi_account', severity: 'info', raised_at: '2026-10-18T10:00:00Z' }),
    ];
    mount(<RiskChips chatId={CHAT} customerId={CUSTOMER} compact={false} />);
    const list = await screen.findByRole('list', { name: 'Risk flags' });
    const chips = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(chips[0]).toContain('Self-harm');
    expect(chips[1]).toContain('Formal complaint');
    expect(chips[2]).toBe('+2');
    expect(within(list).getByText('+2')).toHaveAttribute('title', 'Abusive, Multiple accounts');
  });

  it('names the severity beside the type for a screen reader, not by colour alone', async () => {
    chatFlags = [flag({ type: 'self_harm', severity: 'urgent' })];
    mount(<RiskChips chatId={CHAT} customerId={CUSTOMER} compact={false} />);
    const chip = await screen.findByTitle('Self-harm — Urgent');
    expect(chip).toHaveTextContent('Urgent');
  });

  it('collapses to one counted flag that still names every type when the header is narrow', async () => {
    chatFlags = [
      flag({ id: 'a', type: 'self_harm', severity: 'urgent' }),
      flag({ id: 'b', type: 'abusive', severity: 'info' }),
    ];
    mount(<RiskChips chatId={CHAT} customerId={CUSTOMER} compact />);
    const badge = (await screen.findByText('Risk flags: Self-harm, Abusive')).parentElement!;
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('data-severity', 'urgent');
  });

  it('is Turkish in a Turkish console', async () => {
    chatFlags = [flag({ type: 'self_exclusion_request', severity: 'urgent' })];
    renderWithLocale(
      <QueryClientProvider client={client()}>
        <RiskChips chatId={CHAT} customerId={CUSTOMER} compact={false} />
      </QueryClientProvider>,
      'tr',
    );
    expect(await screen.findByText('Hesap kapatma talebi')).toBeInTheDocument();
  });
});

describe('RiskSection — what the panel shows (AI-27)', () => {
  it('says so when nothing is flagged', async () => {
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    expect(
      await screen.findByText('No active risk flags on this conversation or this player.'),
    ).toBeInTheDocument();
  });

  it('says it could not read the flags rather than that there are none', async () => {
    api.get.mockRejectedValue(
      new ApiClientError({ type: 'authorization', status: 403, message: 'no', requestId: 'r' }),
    );
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The risk flags could not be read.');
    expect(screen.queryByText(/No active risk flags/)).not.toBeInTheDocument();
  });

  it("marks a player's claim as a claim and says what the flag does to the AI", async () => {
    chatFlags = [
      flag({
        id: 'x',
        scope: 'member',
        type: 'self_exclusion_request',
        severity: 'urgent',
        basis: 'declared',
        source: 'ai_rule',
        rule_ref: 'G1',
      }),
    ];
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    const card = await screen.findByText(
      'Based on what the player said — their identity has not been verified.',
    );
    const item = card.closest('li')!;
    expect(within(item).getByText(/raised by an AI guardrail/)).toBeInTheDocument();
    expect(
      within(item).getByText('The AI offers no bonus, promotion or deposit.'),
    ).toBeInTheDocument();
    expect(within(item).getByText('The player is shown no campaign.')).toBeInTheDocument();
    expect(within(item).getByText(/Stays on the player/)).toBeInTheDocument();
  });

  it("shows yesterday's member flag on today's conversation, as raised earlier", async () => {
    playerFlags = [
      flag({
        id: 'y',
        scope: 'member',
        type: 'rg_signal',
        chat_id: 'YESTERDAY',
        severity: 'high',
      }),
    ];
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    expect(await screen.findByText(/Raised in an earlier conversation/)).toBeInTheDocument();
    expect(screen.getByText('Responsible gaming signal')).toBeInTheDocument();
  });

  it('shows the note only when the server sent it', async () => {
    chatFlags = [
      flag({
        id: 'seen',
        type: 'complaint_formal',
        note: 'Player threatened a chargeback',
        details_visible: true,
      }),
      // Even a note that reached the panel is not drawn without the server's say-so.
      flag({
        id: 'hidden',
        type: 'abusive',
        severity: 'info',
        note: 'Should not be drawn',
        details_visible: false,
      }),
    ];
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    expect(await screen.findByText('Player threatened a chargeback')).toBeInTheDocument();
    expect(screen.getAllByText(/^Note/)).toHaveLength(1);
    expect(screen.queryByText('Should not be drawn')).not.toBeInTheDocument();
  });

  it('refreshes the moment a risk-flag push arrives, whoever raised it', async () => {
    const { queryClient } = mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    await screen.findByText('No active risk flags on this conversation or this player.');

    chatFlags = [flag({ id: 'ai', type: 'self_harm', severity: 'urgent', source: 'ai_rule' })];
    act(() => applyPush(queryClient, 'risk_flag_raised', { chat_id: CHAT, flag_id: 'ai' }));
    expect(await screen.findByText(/raised by an AI guardrail/)).toBeInTheDocument();

    chatFlags = [];
    act(() => applyPush(queryClient, 'risk_flag_cleared', { chat_id: CHAT, flag_id: 'ai' }));
    expect(
      await screen.findByText('No active risk flags on this conversation or this player.'),
    ).toBeInTheDocument();
  });
});

describe('RiskSection — clearing a flag (AI-27-S2)', () => {
  beforeEach(() => {
    chatFlags = [flag({ id: 'rg', scope: 'member', type: 'rg_signal', severity: 'high' })];
  });

  it('gives an agent no button, and says who can', async () => {
    authState.agent = { account_id: 'agent-1', role: 'agent' };
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    expect(await screen.findByText('Only Admin and up can clear this flag.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear flag/ })).not.toBeInTheDocument();
  });

  it('asks a manager for a reason and sends it to the route', async () => {
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear flag: Responsible gaming signal' }),
    );

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Clear flag' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), {
      target: { value: '  Player confirmed they are fine  ' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('DELETE', '/risk-flags/rg', {
        reason: 'Player confirmed they are fine',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("explains that clearing a self-exclusion request does not change the operator's decision", async () => {
    chatFlags = [
      flag({ id: 'se', scope: 'member', type: 'self_exclusion_request', severity: 'urgent' }),
    ];
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Clear flag: Self-exclusion request/ }),
    );
    expect(
      await screen.findByText(
        "Clearing this flag does not change the operator's decision about the account.",
      ),
    ).toBeInTheDocument();
  });

  it('words the server’s refusal in the dialog and keeps it open', async () => {
    api.request.mockRejectedValue(refusal('authorization', 403, 'risk_flag_clear_role'));
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Clear flag: Responsible gaming signal/ }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), {
      target: { value: 'ok' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear flag' }));
    expect(
      await within(dialog).findByText('Your role cannot clear this kind of flag.'),
    ).toBeInTheDocument();
  });
});

describe('RiskSection — flagging a conversation (AI-27)', () => {
  it('offers no button to a caller who cannot write in the conversation', async () => {
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag={false} />);
    await screen.findByText('No active risk flags on this conversation or this player.');
    expect(
      screen.queryByRole('button', { name: 'Flag this conversation' }),
    ).not.toBeInTheDocument();
  });

  it('flags with a type and a trimmed note, and tells the agent what the type does', async () => {
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    fireEvent.click(await screen.findByRole('button', { name: 'Flag this conversation' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('What for'), {
      target: { value: 'underage_suspected' },
    });
    expect(within(dialog).getByText(/Severity: Urgent\./)).toBeInTheDocument();
    expect(
      within(dialog).getByText('The AI writes nothing more here; a person answers.'),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
      target: { value: '  says they are 16  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add flag' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT}/risk-flags`, {
        type: 'underage_suspected',
        note: 'says they are 16',
      }),
    );
  });

  it('sends no note when none was written, and does not offer a type already on the chat', async () => {
    chatFlags = [flag({ type: 'complaint_formal' })];
    mount(<RiskSection chatId={CHAT} customerId={CUSTOMER} canFlag />);
    fireEvent.click(await screen.findByRole('button', { name: 'Flag this conversation' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(dialog)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Formal complaint');
    expect(options[0]).toBe('Responsible gaming signal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add flag' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT}/risk-flags`, {
        type: 'rg_signal',
      }),
    );
  });
});
