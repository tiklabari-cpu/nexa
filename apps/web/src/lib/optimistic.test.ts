/**
 * The optimistic helper: proves the four steps every optimistic mutation shares
 * happen in one place — guess now, snapshot, roll back on failure, reconcile on
 * settle — so no call site can forget one.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { optimisticCacheUpdate } from './optimistic.js';

interface List {
  items: Array<{ id: string; on: boolean }>;
}

function seededClient(data: List): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['things'], data);
  return client;
}

function toggleHandlers(client: QueryClient) {
  return optimisticCacheUpdate<List, { id: string }>({
    queryClient: client,
    queryKey: ['things'],
    update: (current, { id }) => ({
      items: (current?.items ?? []).map((t) => (t.id === id ? { ...t, on: true } : t)),
    }),
  });
}

describe('optimisticCacheUpdate', () => {
  it('applies the guess immediately and snapshots what was there', async () => {
    const client = seededClient({ items: [{ id: 'a', on: false }] });
    const context = await toggleHandlers(client).onMutate({ id: 'a' });

    expect(client.getQueryData<List>(['things'])).toEqual({ items: [{ id: 'a', on: true }] });
    expect(context.previous).toEqual({ items: [{ id: 'a', on: false }] });
  });

  it('rolls the cache back to the snapshot when the request fails', async () => {
    const client = seededClient({ items: [{ id: 'a', on: false }] });
    const handlers = toggleHandlers(client);

    const context = await handlers.onMutate({ id: 'a' });
    expect(client.getQueryData<List>(['things'])).toEqual({ items: [{ id: 'a', on: true }] });

    handlers.onError(new Error('nope'), { id: 'a' }, context);
    expect(client.getQueryData<List>(['things'])).toEqual({ items: [{ id: 'a', on: false }] });
  });

  it('invalidates its own key and any extra keys once settled', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    optimisticCacheUpdate<List, { id: string }>({
      queryClient: client,
      queryKey: ['things'],
      update: (current) => current ?? { items: [] },
      invalidateKeys: [['list']],
    }).onSettled();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['things'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['list'] });
  });
});
