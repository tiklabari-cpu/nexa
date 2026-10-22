/**
 * The draft behind a Settings form (tm 323.1 · GV-06).
 *
 * Settings screens used to save in three different ways: a checkbox that wrote
 * the moment it was ticked, a form that wrote on Save, and a section whose
 * half-edited draft vanished when the person clicked another section. This is
 * the one state machine the "write on Save" kind shares — the values being
 * edited, the baseline they are compared with, and the save in flight.
 *
 * - **Dirty is a comparison, not a flag.** The draft is compared with the last
 *   saved values, so typing a letter and deleting it again is clean.
 * - **A save moves the baseline.** After a successful save the saved values
 *   become the new baseline, so the bar goes quiet without waiting for a
 *   refetch; a refetch that returns the same values changes nothing.
 * - **A failed save keeps the draft.** Nothing is reset on an error — the
 *   person retries from what they typed.
 * - **New server data does not clobber an edit.** When the saved values change
 *   underneath (a refetch, another tab) a clean draft follows them; a dirty one
 *   keeps what the person typed and only moves the baseline.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Structural equality for JSON-shaped values (what a settings form holds). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]));
}

/** The top-level keys whose value differs between `baseline` and `values`. */
export function changedKeys<V extends object>(baseline: V, values: V): (keyof V)[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(values)]) as Set<keyof V>;
  return [...keys].filter((key) => !valuesEqual(baseline[key], values[key]));
}

export type SaveResult = { ok: true } | { ok: false; error: unknown };

export interface SettingsDraft<V extends object, X> {
  values: V;
  baseline: V;
  /** Set one field. */
  setValue: <K extends keyof V>(key: K, value: V[K]) => void;
  /** Merge several fields at once. */
  patch: (changes: Partial<V>) => void;
  dirty: boolean;
  changed: (keyof V)[];
  saving: boolean;
  /** The last save's rejection; cleared by the next edit, save or discard. */
  error: unknown;
  /** Never rejects: the result says whether the save went through and why not. */
  save: (extra: X) => Promise<SaveResult>;
  discard: () => void;
}

export function useSettingsDraft<V extends object, X = undefined>(options: {
  saved: V;
  onSave: (values: V, extra: X) => unknown;
}): SettingsDraft<V, X> {
  const { saved, onSave } = options;
  const [values, setValues] = useState<V>(saved);
  const [baseline, setBaseline] = useState<V>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Refs mirror the state the effects and `save` must read without re-running.
  const baselineRef = useRef(baseline);
  const valuesRef = useRef(values);
  const savingRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  valuesRef.current = values;

  useEffect(() => {
    if (valuesEqual(saved, baselineRef.current)) return;
    const wasClean = valuesEqual(valuesRef.current, baselineRef.current);
    baselineRef.current = saved;
    setBaseline(saved);
    if (wasClean) setValues(saved);
  }, [saved]);

  const setValue = useCallback(<K extends keyof V>(key: K, value: V[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  }, []);

  const patch = useCallback((changes: Partial<V>): void => {
    setValues((current) => ({ ...current, ...changes }));
    setError(null);
  }, []);

  const discard = useCallback((): void => {
    setValues(baselineRef.current);
    setError(null);
  }, []);

  const save = useCallback(async (extra: X): Promise<SaveResult> => {
    // State lags a render behind a click; the ref is what makes a double-click
    // send one request.
    if (savingRef.current) return { ok: false, error: null };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const submitted = valuesRef.current;
    try {
      await onSaveRef.current(submitted, extra);
    } catch (failure) {
      setError(failure);
      return { ok: false, error: failure };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    baselineRef.current = submitted;
    setBaseline(submitted);
    return { ok: true };
  }, []);

  return {
    values,
    baseline,
    setValue,
    patch,
    dirty: !valuesEqual(values, baseline),
    changed: changedKeys(baseline, values),
    saving,
    error,
    save,
    discard,
  };
}
