/**
 * The browser's half of campaign targeting (EN-03 · tm 352.2): the rules only
 * the browser can decide, the clock they run on, and what is reported to the
 * server. Pure — a fake host and fake timers.
 */
import type { CampaignShowWhen } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTargeting,
  showWhenHolds,
  type CampaignCard,
  type TargetingHost,
} from './targeting.js';

const time = (op: 'gte' | 'gt', value: number): CampaignShowWhen['rules'][number] => ({
  field: 'time_on_page',
  op,
  value,
});
const exit: CampaignShowWhen['rules'][number] = {
  field: 'exit_intent',
  op: 'equals',
  value: true,
};

const exitWhen: CampaignShowWhen = { match: 'all', rules: [exit] };

describe('showWhenHolds', () => {
  it('all needs every rule, any needs one', () => {
    const rules = [time('gte', 30), exit];
    expect(showWhenHolds({ match: 'all', rules }, 30, false)).toBe(false);
    expect(showWhenHolds({ match: 'all', rules }, 30, true)).toBe(true);
    expect(showWhenHolds({ match: 'any', rules }, 5, true)).toBe(true);
    expect(showWhenHolds({ match: 'any', rules }, 31, false)).toBe(true);
    expect(showWhenHolds({ match: 'any', rules }, 29, false)).toBe(false);
  });

  it('gt is strict, gte is not', () => {
    expect(showWhenHolds({ match: 'all', rules: [time('gt', 30)] }, 30, false)).toBe(false);
    expect(showWhenHolds({ match: 'all', rules: [time('gte', 30)] }, 30, false)).toBe(true);
  });

  it('never holds for no rules or a rule it cannot read', () => {
    expect(showWhenHolds({ match: 'all', rules: [] }, 99, true)).toBe(false);
    expect(showWhenHolds({ match: 'any', rules: [] }, 99, true)).toBe(false);
    const unknown = { field: 'country', op: 'equals', value: 'TR' } as const;
    expect(showWhenHolds({ match: 'any', rules: [unknown] }, 99, true)).toBe(false);
    expect(showWhenHolds({ match: 'all', rules: [time('gte', '30' as never)] }, 99, true)).toBe(
      false,
    );
  });
});

describe('createTargeting', () => {
  const slot: { campaign: CampaignCard | null } = { campaign: null };
  let host: TargetingHost & {
    api: { post: ReturnType<typeof vi.fn> };
    render: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    dismissed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    slot.campaign = null;
    host = {
      url: 'https://shop.test/home',
      since: Date.now(),
      slot,
      api: { post: vi.fn(async () => undefined) },
      dismissed: vi.fn(() => false),
      render: vi.fn(),
      refresh: vi.fn(),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const offered = (
    when: CampaignShowWhen,
    id = 'camp-1',
  ): { id: string; message: string; show_when: CampaignShowWhen } => ({
    id,
    message: 'Hi',
    show_when: when,
  });
  const ready = (): boolean => slot.campaign?.ready === true;

  it('draws a waiting card the moment its seconds on the page are up, counted from the page', async () => {
    const targeting = createTargeting(host, window);
    await vi.advanceTimersByTimeAsync(12_000);
    // Offered at 12 s: 18 s still to go, not 30.
    targeting.offer(offered({ match: 'all', rules: [time('gte', 30)] }));
    expect(slot.campaign).toMatchObject({ id: 'camp-1', ready: false, shown: false });
    await vi.advanceTimersByTimeAsync(17_900);
    expect(ready()).toBe(false);
    expect(host.render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(ready()).toBe(true);
    expect(host.render).toHaveBeenCalledTimes(1);
  });

  it('draws it at once when the seconds are already up', () => {
    const targeting = createTargeting({ ...host, since: Date.now() - 60_000 }, window);
    targeting.offer(offered({ match: 'all', rules: [time('gte', 30)] }));
    expect(ready()).toBe(true);
  });

  it('gt waits a hair past its seconds', async () => {
    const targeting = createTargeting(host, window);
    targeting.offer(offered({ match: 'all', rules: [time('gt', 10)] }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready()).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(ready()).toBe(true);
  });

  it('keeps its progress when the same card is offered again, and starts afresh for another', async () => {
    const targeting = createTargeting(host, window);
    const both = offered({ match: 'all', rules: [time('gte', 5), exit] });
    targeting.offer(both);
    targeting.exit();
    targeting.offer(both);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ready()).toBe(true);

    // Another card, after that one is gone: an exit made earlier does not count.
    slot.campaign = null;
    targeting.offer(offered({ match: 'all', rules: [exit] }, 'camp-2'));
    expect(slot.campaign).toMatchObject({ id: 'camp-2', ready: false });
  });

  it('counts an exit only while a card waits', () => {
    const targeting = createTargeting(host, window);
    targeting.exit();
    targeting.offer(offered({ match: 'all', rules: [exit] }));
    expect(ready()).toBe(false);
    targeting.exit();
    expect(ready()).toBe(true);
  });

  it('drops a waiting card the server no longer offers, and takes the one it offers instead', () => {
    const targeting = createTargeting(host, window);
    targeting.offer(offered({ match: 'all', rules: [exit] }));
    targeting.offer(null);
    expect(slot.campaign).toBeNull();
    expect(host.render).toHaveBeenCalledTimes(1);

    targeting.offer(offered({ match: 'all', rules: [exit] }, 'camp-1'));
    targeting.offer(offered({ match: 'all', rules: [exit] }, 'camp-2'));
    expect(slot.campaign?.id).toBe('camp-2');
  });

  it('never replaces a card that is already drawn, and skips one the visitor waved away', () => {
    const targeting = createTargeting(host, window);
    slot.campaign = { id: 'drawn', message: 'Hi', when: null, ready: true, shown: false };
    targeting.offer(offered({ match: 'all', rules: [exit] }, 'camp-9'));
    expect(slot.campaign.id).toBe('drawn');
    expect(host.render).not.toHaveBeenCalled();

    slot.campaign = null;
    host.dismissed.mockReturnValue(true);
    targeting.offer(offered({ match: 'all', rules: [exit] }));
    expect(slot.campaign).toBeNull();
  });

  it('a new page drops a card that waited for the old one, restarts the clock and reports the page', async () => {
    const targeting = createTargeting(host, window);
    targeting.track();
    targeting.offer(offered({ match: 'all', rules: [time('gte', 20)] }));
    await vi.advanceTimersByTimeAsync(15_000);

    targeting.page('https://shop.test/deposit');
    expect(slot.campaign).toBeNull();
    expect(host.render).toHaveBeenCalledTimes(1);
    // The old timer is gone: 20 s from the first page passes with nothing drawn.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.render).toHaveBeenCalledTimes(1);

    expect(host.api.post).toHaveBeenCalledExactlyOnceWith('/customer/visit', {
      url: 'https://shop.test/deposit',
    });
    expect(host.refresh).toHaveBeenCalledTimes(1);

    // The clock restarted at the page change (t = 15 s): due at 35 s.
    targeting.offer(offered({ match: 'all', rules: [time('gte', 20)] }));
    await vi.advanceTimersByTimeAsync(9_900);
    expect(ready()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(ready()).toBe(true);
  });

  it('leaves a card that is already drawn on screen when the page changes', () => {
    const targeting = createTargeting(host, window);
    slot.campaign = { id: 'c', message: 'Hi', when: exitWhen, ready: true, shown: true };
    targeting.page('https://shop.test/next');
    expect(slot.campaign?.id).toBe('c');
  });

  it('ignores the page it is already on, and reports nothing until the workspace tracks', async () => {
    const targeting = createTargeting(host, window);
    targeting.page('https://shop.test/home');
    targeting.page('https://shop.test/next');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.api.post).not.toHaveBeenCalled();
  });

  it('sends one report for a burst of variable calls, carrying the last set whole', async () => {
    const targeting = createTargeting(host, window);
    targeting.track();
    targeting.variables({ a: 1, b: 2 });
    targeting.variables({ k0: true, extra: 'v' });
    await vi.advanceTimersByTimeAsync(0);

    expect(host.api.post).toHaveBeenCalledTimes(1);
    expect(host.api.post).toHaveBeenCalledWith('/customer/visit', {
      url: 'https://shop.test/home',
      variables: { k0: true, extra: 'v' },
    });
  });

  it('keeps what the server takes of the variables: twenty keys, a hundred characters, plain values', async () => {
    const targeting = createTargeting(host, window);
    targeting.track();
    const many: Record<string, unknown> = {
      ' plan ': 'x'.repeat(150),
      nested: { a: 1 },
      nothing: null,
      bad: Number.NaN,
      '': 'blank',
    };
    for (let i = 0; i < 30; i += 1) many[`k${i}`] = i;
    targeting.variables(many);
    await vi.advanceTimersByTimeAsync(0);
    const { variables } = host.api.post.mock.calls[0]![1] as { variables: Record<string, unknown> };
    expect(Object.keys(variables)).toHaveLength(20);
    expect(variables['plan']).toBe('x'.repeat(100));
    expect(variables).not.toHaveProperty('nested');
    expect(variables).not.toHaveProperty('bad');
  });

  it('sends nothing for no variables, and variables set before the mint go out when it tracks', async () => {
    const targeting = createTargeting(host, window);
    targeting.variables({});
    targeting.variables({ plan: 'premium' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.api.post).not.toHaveBeenCalled();
    targeting.track();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.api.post).toHaveBeenCalledTimes(1);
  });

  it('holds reports at least two seconds apart, so the chat keeps its share of the rate limit', async () => {
    const targeting = createTargeting(host, window);
    targeting.track();
    targeting.page('https://shop.test/a');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.api.post).toHaveBeenCalledTimes(1);

    targeting.page('https://shop.test/b');
    await vi.advanceTimersByTimeAsync(1_900);
    expect(host.api.post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(host.api.post).toHaveBeenCalledTimes(2);
    expect(host.api.post.mock.calls[1]).toEqual([
      '/customer/visit',
      { url: 'https://shop.test/b' },
    ]);
  });

  it('reports a drawn card once, to the shown route, and not a card that was never held', () => {
    const targeting = createTargeting(host, window);
    slot.campaign = { id: 'c/1', message: 'Hi', when: exitWhen, ready: true, shown: false };
    targeting.shown();
    targeting.shown();
    expect(host.api.post).toHaveBeenCalledExactlyOnceWith('/customer/campaigns/c%2F1/shown');

    host.api.post.mockClear();
    slot.campaign = { id: 'c2', message: 'Hi', when: null, ready: true, shown: false };
    targeting.shown();
    expect(host.api.post).not.toHaveBeenCalled();
  });

  it('asks the server again even when the report failed, and stops cleanly', async () => {
    host.api.post.mockRejectedValueOnce(new Error('429'));
    const targeting = createTargeting(host, window);
    targeting.track();
    targeting.page('https://shop.test/a');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.refresh).toHaveBeenCalledTimes(1);

    targeting.offer(offered({ match: 'all', rules: [time('gte', 5)] }));
    targeting.stop();
    targeting.page('https://shop.test/b');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready()).toBe(false);
    expect(host.api.post).toHaveBeenCalledTimes(1);
  });
});
