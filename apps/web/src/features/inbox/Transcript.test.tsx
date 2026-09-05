/**
 * The transcript's scrolling, which is the whole difficulty of reading a
 * conversation backwards (NFR-P5 / FR-MOD-02.3.1).
 *
 * A list that only ever grows at the bottom needs one rule — follow the tail
 * unless the reader has scrolled away from it. Growing at the *top* needs the
 * opposite: the browser keeps `scrollTop` across an insert, so prepending a
 * page of history silently pushes the line being read a page further down.
 * These pin the arithmetic that cancels that out, and the three states that
 * must not trigger a request (no history left, one already in flight, nowhere
 * near the top).
 *
 * jsdom has no layout, so the scroll box is faked: `scrollHeight` is derived
 * from the number of children the container actually has, which means a
 * prepended page grows it by exactly as many rows as were prepended, and
 * `scrollTop` is a plain settable value. That is enough — what is under test is
 * the correction, not the browser's own scrolling.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

/** Fake row height and viewport, in the same units the component reads. */
const ROW_PX = 40;
const VIEWPORT_PX = 200;

function message(seq: number): ChatEvent {
  return {
    id: `TJ1H8CFKRV_${seq}`,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: `m${seq}`,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    // One clock day throughout: a day divider would add a child and put the
    // faked geometry out of step with the row count.
    created_at: `2026-08-27T10:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

/** `count` messages ending at `last`, oldest-first — the order rendered. */
function thread(last: number, count: number): ChatEvent[] {
  return Array.from({ length: count }, (_, i) => message(last - count + 1 + i));
}

function fakeScrollBox(node: HTMLElement): void {
  let scrollTop = 0;
  Object.defineProperty(node, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  Object.defineProperty(node, 'scrollHeight', {
    configurable: true,
    get: () => node.children.length * ROW_PX,
  });
}

type Props = Parameters<typeof Transcript>[0];

function setup(props: Partial<Props> = {}) {
  const initial: Props = {
    chatId: 'TJ1H8CFKRV',
    events: [],
    loading: false,
    currentAgentId: null,
    ...props,
  };
  const view = render(<Transcript {...initial} />);
  const log = screen.getByRole('log');
  fakeScrollBox(log);
  return {
    log,
    update: (next: Partial<Props>) => view.rerender(<Transcript {...initial} {...next} />),
  };
}

/** Puts the reader at `top` and lets the component see it. */
function scrollTo(log: HTMLElement, top: number): void {
  log.scrollTop = top;
  fireEvent.scroll(log);
}

describe('Transcript — asking for history', () => {
  let onLoadOlder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onLoadOlder = vi.fn();
  });

  it('asks for the previous page as the reader nears the top', () => {
    const { log } = setup({ events: thread(14, 10), hasOlder: true, onLoadOlder });

    scrollTo(log, 400);
    expect(onLoadOlder).not.toHaveBeenCalled();

    scrollTo(log, 100);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not ask once the thread has no more history', () => {
    const { log } = setup({ events: thread(14, 10), hasOlder: false, onLoadOlder });
    scrollTo(log, 0);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('does not ask again while a page is already in flight', () => {
    const { log } = setup({
      events: thread(14, 10),
      hasOlder: true,
      isLoadingOlder: true,
      onLoadOlder,
    });
    scrollTo(log, 0);
    scrollTo(log, 10);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('says that history is loading, in words and not only in shapes', () => {
    setup({ events: thread(14, 10), hasOlder: true, isLoadingOlder: true, onLoadOlder });
    expect(screen.getByTestId('transcript-older-loading')).toBeInTheDocument();
    // Inside the log's live region: the reader asked for this by scrolling, and
    // a silent pause reads exactly like the start of the conversation.
    expect(screen.getByText('Loading earlier messages…')).toBeInTheDocument();
  });
});

describe('Transcript — where the reader ends up', () => {
  it('keeps the reader on the same message when history lands above them', () => {
    const { log, update } = setup({ events: thread(14, 10), hasOlder: true });

    scrollTo(log, 80);
    // Five events arrive on top, so the box is five rows taller.
    update({ events: [...thread(4, 5), ...thread(14, 10)] });

    // Exactly the height of what was inserted — the line being read has not
    // moved a pixel relative to the viewport.
    expect(log.scrollTop).toBe(80 + 5 * ROW_PX);
  });

  it('is not thrown off by the loading skeleton it showed in between', () => {
    const { log, update } = setup({ events: thread(14, 10), hasOlder: true });
    scrollTo(log, 80);

    // The skeleton is in the scroll flow, so it inflates `scrollHeight` for as
    // long as it is up; a nudge while it is up must not be measured.
    update({ events: thread(14, 10), hasOlder: true, isLoadingOlder: true });
    fireEvent.scroll(log);

    update({ events: [...thread(4, 5), ...thread(14, 10)], hasOlder: true });
    expect(log.scrollTop).toBe(80 + 5 * ROW_PX);
  });

  it('follows a new message for a reader who is at the bottom', () => {
    const { log, update } = setup({ events: thread(14, 10) });

    // 400 of content, 200 of viewport: 200 is the bottom.
    scrollTo(log, 200);
    update({ events: thread(15, 11) });

    expect(log.scrollTop).toBe(11 * ROW_PX);
  });

  it('leaves a reader who is up in the history exactly where they are', () => {
    const { log, update } = setup({ events: thread(14, 10) });

    scrollTo(log, 40);
    update({ events: thread(15, 11) });

    expect(log.scrollTop).toBe(40);
  });

  it('opens another conversation at its newest message, not at the old scroll', () => {
    const { log, update } = setup({ events: thread(14, 10) });
    scrollTo(log, 40);

    update({ chatId: 'OTHERCHAT1', events: [message(90), message(91), message(92)] });

    expect(log.scrollTop).toBe(3 * ROW_PX);
  });

  it('does not mistake a re-cut chain for a different conversation', () => {
    // A refetch of a multi-page transcript re-reads the chain from the current
    // tail, so a few messages arriving while the agent reads can leave it
    // reaching one message less far back — a new head with nothing new in it.
    // Treated as a chat switch, that would drop the reader at the bottom.
    const { log, update } = setup({ events: thread(14, 10), hasOlder: true });
    scrollTo(log, 80);

    update({ events: thread(14, 9) });

    // One row shorter, and the reader moves up with it rather than to the end.
    expect(log.scrollTop).toBe(80 - ROW_PX);
  });
});

describe('Transcript — rich text (FR-MOD-02.3.5)', () => {
  function agentMessage(seq: number, text: string): ChatEvent {
    return { ...message(seq), author_id: 'AGENT1', author_type: 'agent', text };
  }

  function customerMessage(seq: number, text: string): ChatEvent {
    return { ...message(seq), author_type: 'customer', text };
  }

  it('renders an agent’s **bold** and *italic* markdown as formatted text', () => {
    render(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={[agentMessage(1, '**bold** and *italic*')]}
        loading={false}
        currentAgentId={null}
      />,
    );
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('italic', { selector: 'em' })).toBeInTheDocument();
  });

  it('renders a `- ` line as a bullet', () => {
    render(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={[agentMessage(1, '- first\n- second')]}
        loading={false}
        currentAgentId={null}
      />,
    );
    expect(screen.getByText(/• first/)).toBeInTheDocument();
    expect(screen.getByText(/• second/)).toBeInTheDocument();
  });

  // The XSS-negative half of the decision (`#### K02.3.5`): the parser never
  // touches raw HTML either way, so this is a product boundary, not a
  // sanitisation one — a customer's own asterisks must read back exactly as
  // they typed them rather than being reinterpreted as the agent's formatting.
  it('leaves the customer’s own asterisks as literal text', () => {
    render(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={[customerMessage(1, '**not bold**')]}
        loading={false}
        currentAgentId={null}
      />,
    );
    expect(screen.getByText('**not bold**')).toBeInTheDocument();
    expect(screen.queryByText('not bold', { selector: 'strong' })).not.toBeInTheDocument();
  });
});
