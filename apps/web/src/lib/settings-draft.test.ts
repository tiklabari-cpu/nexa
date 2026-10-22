/**
 * The draft state machine behind SettingsForm (tm 323.1 · GV-06): dirty is a
 * comparison with the saved values, a save moves the baseline, a refusal keeps
 * the draft, and fresh server data never overwrites an edit.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { changedKeys, useSettingsDraft, valuesEqual } from './settings-draft.js';

interface V {
  name: string;
  tags: string[];
  nested: { on: boolean };
}
const SAVED: V = { name: 'a', tags: ['x'], nested: { on: false } };

describe('valuesEqual / changedKeys', () => {
  it('compares JSON-shaped values structurally', () => {
    expect(valuesEqual(SAVED, { name: 'a', tags: ['x'], nested: { on: false } })).toBe(true);
    expect(valuesEqual(SAVED, { ...SAVED, tags: ['x', 'y'] })).toBe(false);
    expect(valuesEqual(SAVED, { ...SAVED, nested: { on: true } })).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
    expect(valuesEqual(null, {})).toBe(false);
    expect(valuesEqual(NaN, NaN)).toBe(true);
  });

  it('names only the top-level keys that differ', () => {
    expect(changedKeys(SAVED, { ...SAVED, name: 'b', nested: { on: true } })).toEqual([
      'name',
      'nested',
    ]);
    expect(changedKeys(SAVED, SAVED)).toEqual([]);
  });
});

describe('useSettingsDraft', () => {
  it('is dirty only while the draft differs from the saved values', () => {
    const { result } = renderHook(() => useSettingsDraft({ saved: SAVED, onSave: vi.fn() }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setValue('name', 'b'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.changed).toEqual(['name']);
    act(() => result.current.setValue('name', 'a'));
    expect(result.current.dirty).toBe(false);
  });

  it('moves the baseline on a successful save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSettingsDraft<V, { reason?: string }>({ saved: SAVED, onSave }),
    );
    act(() => result.current.patch({ name: 'b' }));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save({ reason: 'why' });
    });
    expect(outcome).toEqual({ ok: true });
    expect(onSave).toHaveBeenCalledWith({ ...SAVED, name: 'b' }, { reason: 'why' });
    expect(result.current.dirty).toBe(false);
    expect(result.current.baseline.name).toBe('b');
  });

  it('keeps the draft and reports the error when the save is refused', async () => {
    const failure = new Error('no');
    const { result } = renderHook(() =>
      useSettingsDraft({ saved: SAVED, onSave: vi.fn().mockRejectedValue(failure) }),
    );
    act(() => result.current.setValue('name', 'b'));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save(undefined);
    });
    expect(outcome).toEqual({ ok: false, error: failure });
    expect(result.current.dirty).toBe(true);
    expect(result.current.values.name).toBe('b');
    expect(result.current.error).toBe(failure);
    act(() => result.current.setValue('name', 'c'));
    expect(result.current.error).toBeNull();
  });

  it('sends one request for a double save', async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useSettingsDraft({ saved: SAVED, onSave }));
    act(() => result.current.setValue('name', 'b'));
    await act(async () => {
      void result.current.save(undefined);
      void result.current.save(undefined);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('follows new saved values while clean and keeps an edit while dirty', () => {
    const { result, rerender } = renderHook(
      ({ saved }) => useSettingsDraft({ saved, onSave: vi.fn() }),
      { initialProps: { saved: SAVED } },
    );
    rerender({ saved: { ...SAVED, name: 'server' } });
    expect(result.current.values.name).toBe('server');
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setValue('name', 'mine'));
    rerender({ saved: { ...SAVED, name: 'server2' } });
    expect(result.current.values.name).toBe('mine');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.discard());
    expect(result.current.values.name).toBe('server2');
  });
});
