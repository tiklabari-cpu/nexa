import { afterEach, describe, expect, it } from 'vitest';
import { noteServerDate, resetServerClock, serverNow } from './server-clock.js';

afterEach(() => resetServerClock());

describe('the server clock (IN-03)', () => {
  it('follows a client clock that is minutes behind the API', () => {
    const received = Date.UTC(2026, 9, 1, 12, 0, 30);
    // The API says 12:05:30 while this browser thinks it is 12:00:30.
    noteServerDate('Thu, 01 Oct 2026 12:05:30 GMT', received);
    const gap = serverNow() - Date.now();
    expect(gap).toBeGreaterThan(5 * 60_000 - 1_000);
    expect(gap).toBeLessThan(5 * 60_000 + 1_000);
  });

  it('treats a gap inside the header resolution as none', () => {
    const received = Date.UTC(2026, 9, 1, 12, 0, 30);
    noteServerDate('Thu, 01 Oct 2026 12:00:31 GMT', received);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });

  it('ignores a missing or unreadable header and keeps the last gap', () => {
    noteServerDate('Thu, 01 Oct 2026 12:05:30 GMT', Date.UTC(2026, 9, 1, 12, 0, 30));
    const before = serverNow() - Date.now();
    noteServerDate(null);
    noteServerDate('not a date');
    expect(Math.abs(serverNow() - Date.now() - before)).toBeLessThan(50);
  });
});
