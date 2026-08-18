/**
 * The offline signal has one job the tests below are all about: it must be a
 * *measurement*, never a guess. A band that appears because nothing has been
 * tried yet, or one that stays up after the network came back, teaches an agent
 * to ignore it — and an ignored band is the same as no band at all.
 */
import { ConnectivityStore } from './connectivity';

/** A clock a test can move, so the "last updated" stamp is checkable. */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

describe('ConnectivityStore', () => {
  it('starts online, because nothing has failed yet', () => {
    const store = new ConnectivityStore();

    expect(store.getSnapshot()).toEqual({ online: true, lastReachableAt: null });
  });

  it('goes offline when a request could not reach anything', () => {
    const store = new ConnectivityStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.reportUnreachable();

    expect(store.getSnapshot().online).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('remembers when the server was last reached, frozen at the moment it was lost', () => {
    const time = clock();
    const store = new ConnectivityStore(time.now);

    store.reportReachable(); // t = 1000
    time.advance(30_000);
    store.reportUnreachable(); // the radio went away at t = 31000

    // The band answers "as of when?", and the answer is the last success, not
    // the failure that revealed it.
    expect(store.getSnapshot()).toEqual({ online: false, lastReachableAt: 1_000 });
  });

  it('comes back the moment anything answers', () => {
    const time = clock();
    const store = new ConnectivityStore(time.now);
    const listener = jest.fn();
    store.reportUnreachable();
    store.subscribe(listener);

    time.advance(5_000);
    store.reportReachable();

    expect(store.getSnapshot()).toEqual({ online: true, lastReachableAt: 6_000 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('wakes nobody for a success while already online', () => {
    const store = new ConnectivityStore();
    const listener = jest.fn();
    store.subscribe(listener);

    // Every screen's every request lands here. Publishing each one would
    // re-render both banners on every poll for a value neither is showing.
    store.reportReachable();
    store.reportReachable();

    expect(listener).not.toHaveBeenCalled();
  });

  it('hands out the same snapshot until something changes', () => {
    const store = new ConnectivityStore();

    // `useSyncExternalStore` re-renders whenever this reference moves; a fresh
    // object per call would be an infinite render loop rather than a bug that
    // shows up later.
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.reportUnreachable();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('stops telling a subscriber that unsubscribed', () => {
    const store = new ConnectivityStore();
    const listener = jest.fn();

    store.subscribe(listener)();
    store.reportUnreachable();

    expect(listener).not.toHaveBeenCalled();
  });

  it('forgets everything on reset, so a new session starts without a verdict', () => {
    const store = new ConnectivityStore();
    store.reportReachable();
    store.reportUnreachable();

    store.reset();

    expect(store.getSnapshot()).toEqual({ online: true, lastReachableAt: null });
  });
});
