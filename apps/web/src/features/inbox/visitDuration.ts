/**
 * The Details panel's live visit duration (FR-MOD-02.4.1–.6).
 *
 * The PRD asks for "süre/ziyaret canlı" — a duration that runs, not a number
 * that sits still until something else happens to refetch the chat. The server
 * cannot give that on its own: `visit_info.duration_seconds` is `now - started`
 * measured once, when the response was written, so on screen it freezes the
 * moment it arrives and only moves when an unrelated event invalidates the
 * chat query. A visitor reading a page quietly produces no events at all, which
 * is exactly when an agent looks at this number.
 *
 * So the counter is anchored rather than polled: remember the server's figure
 * and the instant it landed, and add the wall-clock time since. No extra
 * request per second, and each refetch re-anchors, so drift cannot accumulate.
 *
 * It only runs while the visit is open (`visit_info.ongoing`). A finished visit
 * has a fixed length and ticking it would show a number nothing ever measured.
 */
import { useEffect, useState } from 'react';

import { formatDuration as formatDurationIn } from '../../lib/format.js';

/**
 * The server's figure plus the time since it was taken.
 *
 * `null` in, `null` out — an unknown duration stays unknown rather than
 * becoming "0s and counting". A clock that jumped backwards (or a `now` from
 * before the anchor) cannot push the count below where it started.
 */
export function liveDurationSeconds(
  base: number | null,
  anchoredAt: number,
  now: number,
): number | null {
  if (base === null) return null;
  const elapsed = Math.floor((now - anchoredAt) / 1000);
  return elapsed > 0 ? base + elapsed : base;
}

/**
 * `liveDurationSeconds` as a hook: re-anchors whenever the server's figure
 * changes, and re-renders once a second while the visit is open.
 *
 * The anchor is derived state rather than a ref because it has to survive the
 * render that observes a new `base` *and* be readable during that same render;
 * setting it during render is the sanctioned form of that, and React re-runs
 * the component immediately instead of painting the stale value.
 */
export function useLiveDurationSeconds(base: number | null, ongoing: boolean): number | null {
  const [anchor, setAnchor] = useState(() => ({ base, at: Date.now() }));
  const [now, setNow] = useState(anchor.at);

  if (anchor.base !== base) {
    const at = Date.now();
    setAnchor({ base, at });
    setNow(at);
  }

  // One timer, owned by the panel that shows the number. It stops with the
  // visit and with the component, so a finished visit costs nothing.
  useEffect(() => {
    if (!ongoing || base === null) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [ongoing, base]);

  if (!ongoing) return base;
  return liveDurationSeconds(anchor.base, anchor.at, now);
}

/** "45s" · "3m 20s" · "1h 4m" ("3 dk 20 sn" in Turkish). A dash when the length is unknown. */
export function formatDuration(seconds: number | null): string {
  return formatDurationIn(seconds, undefined, 'hour') ?? '—';
}
