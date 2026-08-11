/**
 * Reports "Save view" (FR-MOD-07.7, 07.7-h). Derived acceptance criterion (no
 * PRD KK text for Save view — see PLAN.md 07.7-h): a report view (tab + date
 * range + baseline) saves under a name, reapplying it restores the same
 * view, it can be deleted, and it survives a reload; a malformed or blocked
 * `localStorage` must never crash the screen.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addSavedReportView,
  loadSavedReportViews,
  removeSavedReportView,
  saveSavedReportViews,
  SAVED_REPORT_VIEW_NAME_MAX,
  useSavedReportViews,
  type SavedReportView,
} from './report-views.js';

const STORAGE_KEY = 'nexa.reports.saved-views';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('saved report views store', () => {
  it('returns an empty list for malformed or non-array storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(loadSavedReportViews()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');
    expect(loadSavedReportViews()).toEqual([]);
  });

  it('drops rows with an unknown tab, mode, or baseline value', () => {
    const good: SavedReportView = {
      id: 'g',
      name: 'Good',
      tab: 'overview',
      mode: 30,
      customFrom: '',
      customTo: '',
      baseline: null,
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        good,
        { ...good, id: 'b1', tab: 'nope' },
        { ...good, id: 'b2', mode: 'nope' },
        { ...good, id: 'b3', mode: '30' },
        { ...good, id: 'b4', baseline: 'industry' },
        { ...good, id: 'b5', name: 42 },
        { ...good, id: 'b6', customFrom: 2026 },
      ]),
    );
    expect(loadSavedReportViews()).toEqual([good]);
  });

  it('never throws when storage access is blocked', () => {
    const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(() => saveSavedReportViews([], blocked)).not.toThrow();
    expect(loadSavedReportViews(blocked)).toEqual([]);
  });

  it('defaults to no saved views', () => {
    expect(loadSavedReportViews()).toEqual([]);
  });

  it('round-trips a saved view (custom range + benchmark baseline) through storage', () => {
    const view: SavedReportView = {
      id: 'a',
      name: 'Q1 vs last year',
      tab: 'breakdown',
      mode: 'custom',
      customFrom: '2026-01-01',
      customTo: '2026-03-31',
      baseline: 'previous_year',
    };
    saveSavedReportViews([view]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([view]);
    expect(loadSavedReportViews()).toEqual([view]);
  });

  it('does not touch the Inbox saved-views key', () => {
    saveSavedReportViews([
      {
        id: 'a',
        name: 'A',
        tab: 'overview',
        mode: 7,
        customFrom: '',
        customTo: '',
        baseline: null,
      },
    ]);
    expect(localStorage.getItem('nexa.inbox.saved-views')).toBeNull();
  });
});

describe('addSavedReportView / removeSavedReportView', () => {
  it('appends a view built from a name and the current filter', () => {
    const { views, added } = addSavedReportView(
      [],
      {
        name: '  Staffing this quarter  ',
        tab: 'staffing',
        mode: 90,
        customFrom: '',
        customTo: '',
        baseline: 'previous_period',
      },
      () => 'id-1',
    );
    expect(added).toEqual({
      id: 'id-1',
      name: 'Staffing this quarter',
      tab: 'staffing',
      mode: 90,
      customFrom: '',
      customTo: '',
      baseline: 'previous_period',
    });
    expect(views).toHaveLength(1);
  });

  it('caps the name length', () => {
    const long = 'x'.repeat(80);
    const { added } = addSavedReportView(
      [],
      { name: long, tab: 'overview', mode: 30, customFrom: '', customTo: '', baseline: null },
      () => 'id',
    );
    expect(added?.name).toHaveLength(SAVED_REPORT_VIEW_NAME_MAX);
  });

  it('rejects an empty (or whitespace-only) name and leaves the list unchanged', () => {
    const existing: SavedReportView[] = [
      {
        id: 'a',
        name: 'A',
        tab: 'overview',
        mode: 30,
        customFrom: '',
        customTo: '',
        baseline: null,
      },
    ];
    const { views, added } = addSavedReportView(existing, {
      name: '   ',
      tab: 'reviews',
      mode: 7,
      customFrom: '',
      customTo: '',
      baseline: null,
    });
    expect(added).toBeNull();
    expect(views).toBe(existing);
  });

  it('removes a view by id and leaves the rest', () => {
    const list: SavedReportView[] = [
      {
        id: 'a',
        name: 'A',
        tab: 'overview',
        mode: 30,
        customFrom: '',
        customTo: '',
        baseline: null,
      },
      { id: 'b', name: 'B', tab: 'reviews', mode: 7, customFrom: '', customTo: '', baseline: null },
    ];
    expect(removeSavedReportView(list, 'a')).toEqual([list[1]]);
    expect(removeSavedReportView(list, 'missing')).toEqual(list);
  });
});

describe('useSavedReportViews', () => {
  it('adds a view, persists it, and survives a reload', () => {
    const first = renderHook(() => useSavedReportViews());
    expect(first.result.current.views).toEqual([]);

    let created: SavedReportView | null = null;
    act(() => {
      created = first.result.current.add({
        name: 'AI agent — 30d',
        tab: 'ai-agent',
        mode: 30,
        customFrom: '',
        customTo: '',
        baseline: null,
      });
    });
    expect(created).not.toBeNull();
    expect(first.result.current.views).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    first.unmount();

    // A fresh mount is what a reload is: the hook re-reads storage on init.
    const second = renderHook(() => useSavedReportViews());
    expect(second.result.current.views).toHaveLength(1);
    expect(second.result.current.views[0]!.name).toBe('AI agent — 30d');
  });

  it('does not store a view with an empty name', () => {
    const { result } = renderHook(() => useSavedReportViews());
    let created: SavedReportView | null = {
      id: 'x',
      name: 'x',
      tab: 'overview',
      mode: 30,
      customFrom: '',
      customTo: '',
      baseline: null,
    };
    act(() => {
      created = result.current.add({
        name: '',
        tab: 'overview',
        mode: 30,
        customFrom: '',
        customTo: '',
        baseline: null,
      });
    });
    expect(created).toBeNull();
    expect(result.current.views).toEqual([]);
  });

  it('removes a saved view', () => {
    const { result } = renderHook(() => useSavedReportViews());
    let id = '';
    act(() => {
      id = result.current.add({
        name: 'Temp',
        tab: 'topics',
        mode: 365,
        customFrom: '',
        customTo: '',
        baseline: null,
      })!.id;
    });
    expect(result.current.views).toHaveLength(1);
    act(() => result.current.remove(id));
    expect(result.current.views).toEqual([]);
    expect(loadSavedReportViews()).toEqual([]);
  });
});
