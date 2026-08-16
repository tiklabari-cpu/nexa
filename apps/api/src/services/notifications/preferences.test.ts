import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@nexa/types';
import {
  NOTIFICATION_PREFERENCE_SELECT,
  serialiseNotificationPreferences,
  toPreferenceColumns,
} from './preferences.js';

const row = {
  notifyEnabled: true,
  notifySound: false,
  notifyDesktop: true,
  notifyPush: false,
  notifyEmail: true,
};

describe('serialiseNotificationPreferences', () => {
  it('maps every column to its contract name', () => {
    expect(serialiseNotificationPreferences(row)).toEqual({
      enabled: true,
      sound: false,
      desktop: true,
      push: false,
      email: true,
    });
  });

  it('answers the defaults for a principal with no membership', () => {
    // A bot or an app token owns no membership. "How would this person be
    // reached?" then has no row to read, and the honest answer is the one a
    // fresh membership gets rather than silence.
    expect(serialiseNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(serialiseNotificationPreferences(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('does not hand back a reference to the shared defaults', () => {
    const prefs = serialiseNotificationPreferences(null);
    prefs.push = false;
    expect(DEFAULT_NOTIFICATION_PREFERENCES.push).toBe(true);
  });

  it('selects exactly the five columns it reads', () => {
    // The select is exported so `/auth/me` can fold it into a query it already
    // makes. If the two drifted, that query would read a column the serialiser
    // does not use, or fail to read one it does.
    expect(Object.keys(NOTIFICATION_PREFERENCE_SELECT).sort()).toEqual(Object.keys(row).sort());
  });
});

describe('toPreferenceColumns', () => {
  it('writes only the channels the patch names', () => {
    expect(toPreferenceColumns({ sound: false })).toEqual({ notifySound: false });
  });

  it('keeps `false` and drops `undefined` — the distinction the whole patch rests on', () => {
    // `false` is a person switching a channel off; `undefined` is a client that
    // did not mention it. Collapsing the two would let a screen that toggled
    // one checkbox silence the four it never showed.
    expect(toPreferenceColumns({ enabled: false, push: undefined })).toEqual({
      notifyEnabled: false,
    });
  });

  it('is empty for an empty patch', () => {
    expect(toPreferenceColumns({})).toEqual({});
  });

  it('maps all five when all five are given', () => {
    expect(
      toPreferenceColumns({
        enabled: true,
        sound: true,
        desktop: false,
        push: false,
        email: true,
      }),
    ).toEqual({
      notifyEnabled: true,
      notifySound: true,
      notifyDesktop: false,
      notifyPush: false,
      notifyEmail: true,
    });
  });
});
