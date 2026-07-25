/**
 * The optimistic-update dance, in one place (FR-EK-A.2).
 *
 * A mutation that wants the UI to move before the server answers always does the
 * same four steps: cancel any in-flight refetch that would land on top of the
 * guess, snapshot the current cache, write the optimistic value, and — if the
 * request fails — put the snapshot back so the screen never keeps a change the
 * server rejected. Written by hand at each call site that dance drifts: one
 * place forgets to cancel and a stale refetch clobbers the guess, another
 * forgets to roll back and a failed toggle stays flipped. This spells it once.
 *
 * Spread the result into `useMutation` and add your own `onSuccess` alongside:
 *
 *   useMutation({
 *     mutationFn: (v) => api.patch(url, v),
 *     ...optimisticCacheUpdate({ queryClient, queryKey, update }),
 *   })
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** What `onMutate` snapshots so `onError` can undo a failed change. */
export interface RollbackContext<TData> {
  previous: TData | undefined;
}

export interface OptimisticOptions<TData, TVariables> {
  queryClient: QueryClient;
  /** The cache entry the change is guessing at. */
  queryKey: QueryKey;
  /** Produce the optimistic cache value from the current one and the variables. */
  update: (current: TData | undefined, variables: TVariables) => TData;
  /** Extra keys to refetch once settled — a list the same change also touches. */
  invalidateKeys?: QueryKey[];
}

export interface OptimisticHandlers<TData, TVariables> {
  onMutate: (variables: TVariables) => Promise<RollbackContext<TData>>;
  onError: (
    error: unknown,
    variables: TVariables,
    context: RollbackContext<TData> | undefined,
  ) => void;
  onSettled: () => void;
}

export function optimisticCacheUpdate<TData, TVariables>(
  options: OptimisticOptions<TData, TVariables>,
): OptimisticHandlers<TData, TVariables> {
  const { queryClient, queryKey, update, invalidateKeys } = options;
  return {
    onMutate: async (variables) => {
      // Stop an in-flight refetch from resolving after our guess and overwriting it.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TData>(queryKey);
      queryClient.setQueryData<TData>(queryKey, update(previous, variables));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Never keep a change the server refused: restore exactly what was there.
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      // The server is the source of truth; reconcile the guess once it is done.
      void queryClient.invalidateQueries({ queryKey });
      for (const key of invalidateKeys ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  };
}
