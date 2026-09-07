/**
 * The composer's tag tool (FR-MOD-02.3.5's fifth and last composer tool,
 * `#### K02.3.5`).
 *
 * A dedicated toolbar trigger rather than a second meaning for `#`: that key
 * already opens the canned-reply picker (`Composer.canned.test.tsx`), so the
 * "does not collide with canned `#`" tests here prove the two triggers stay
 * independent rather than re-deriving the canned picker's own behaviour.
 * Adding/removing a tag itself goes through `useChatAction`'s `tag`/`untag`
 * mutations — already exercised as the Details panel's tag section — so these
 * tests are about the composer's own wiring: the library it reads, what it
 * already-applied tags it withholds, and that a typed tag reaches the same
 * endpoint.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const CHAT = 'CHAT1';

interface Stub {
  fetchMock: ReturnType<typeof vi.fn>;
  tagPosts: Array<{ tag: string }>;
}

/**
 * One fetch stub for the whole tree: the canned-reply library (kept empty
 * unless a case needs it), the tag library, and `POST /chats/:id/tags`.
 */
function stubFetch(options?: {
  cannedResponses?: Array<{ id: string; shortcut: string; text: string }>;
  tagLibrary?: string[];
}): Stub {
  const tagPosts: Array<{ tag: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.includes('/settings/canned-responses')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items: options?.cannedResponses ?? [] }),
      };
    }
    if (method === 'GET' && url.includes('/settings/tags')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items: (options?.tagLibrary ?? []).map((name) => ({ name })) }),
      };
    }
    if (method === 'POST' && url.includes(`/chats/${CHAT}/tags`)) {
      tagPosts.push(JSON.parse(String(init?.body)) as { tag: string });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ tag: JSON.parse(String(init?.body)).tag }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, tagPosts };
}

function setup(tags: string[] = []): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId={CHAT} disabled={false} tags={tags} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — tag picker (FR-MOD-02.3.5)', () => {
  it('reads its suggestions from the tag library endpoint', async () => {
    const { fetchMock } = stubFetch({ tagLibrary: ['billing'] });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Chat tags' }));

    expect(await screen.findByRole('button', { name: 'billing' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/settings/tags'))).toBe(
        true,
      ),
    );
  });

  it('does not re-suggest a tag already on the chat', async () => {
    stubFetch({ tagLibrary: ['vip', 'billing'] });
    setup(['vip']);

    await userEvent.click(screen.getByRole('button', { name: 'Chat tags' }));

    expect(await screen.findByRole('button', { name: 'billing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'vip' })).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a bare blank panel when nothing is left to suggest', async () => {
    stubFetch({ tagLibrary: [] });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Chat tags' }));

    expect(await screen.findByText('No tags to suggest yet.')).toBeInTheDocument();
  });

  it('adds the clicked suggestion to the chat', async () => {
    const { tagPosts } = stubFetch({ tagLibrary: ['billing'] });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Chat tags' }));
    await userEvent.click(await screen.findByRole('button', { name: 'billing' }));

    await waitFor(() => expect(tagPosts).toContainEqual({ tag: 'billing' }));
  });

  it('reaches a suggestion with the keyboard and Escape closes the picker again', async () => {
    stubFetch({ tagLibrary: ['billing'] });
    setup();
    const user = userEvent.setup();

    const trigger = screen.getByRole('button', { name: 'Chat tags' });
    await user.click(trigger);
    trigger.focus();
    const suggestion = await screen.findByRole('button', { name: 'billing' });

    // The trigger has focus after the click; ArrowDown roves into the panel
    // the same way it does for the emoji and assignee pickers (`Dropdown`'s
    // own generic mechanism — this proves this panel's markup wires into it).
    await user.keyboard('{ArrowDown}');
    expect(suggestion).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'billing' })).not.toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it('adds a free-typed tag on Enter, not limited to the library', async () => {
    const { tagPosts } = stubFetch({ tagLibrary: [] });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Chat tags' }));
    const input = screen.getByLabelText('Add a new tag');
    await userEvent.type(input, 'urgent{Enter}');

    await waitFor(() => expect(tagPosts).toContainEqual({ tag: 'urgent' }));
    expect(input).toHaveValue('');
  });

  it('leaves the canned-reply `#` picker untouched, even when a tag shares its name', async () => {
    stubFetch({
      cannedResponses: [{ id: 'c1', shortcut: 'vip', text: 'Thanks for being a VIP customer!' }],
      tagLibrary: ['vip'],
    });
    setup();

    const textarea = screen.getByLabelText('Reply to the customer');
    await userEvent.type(textarea, '#vip');

    // `#` still opens only the canned-reply list — a tag of the same name is
    // not a second thing it could resolve to.
    const option = await screen.findByRole('option', { name: /VIP customer/ });
    expect(option).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat tags' })).toBeInTheDocument();
  });
});
