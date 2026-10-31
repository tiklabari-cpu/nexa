/**
 * The gap between this browser's clock and the API's, read off the `Date`
 * header of every response (IN-03 · tm 361).
 *
 * A counter that says "4 min" from a server timestamp is wrong by the gap if
 * the laptop's clock is off. The header has whole-second resolution and
 * arrives after a round trip, so a gap under {@link CLOCK_NOISE_MS} is noise
 * and counts as none — the correction exists for a clock that is minutes off,
 * not to chase network jitter.
 */
const CLOCK_NOISE_MS = 2_000;

let offsetMs = 0;

/** Record the gap from a response's `Date` header; a missing or unreadable one changes nothing. */
export function noteServerDate(header: string | null, receivedAt: number = Date.now()): void {
  if (!header) return;
  const sent = Date.parse(header);
  if (Number.isNaN(sent)) return;
  // The header is truncated to the second: the server's moment lies in [sent, sent + 1 s).
  const gap = sent + 500 - receivedAt;
  offsetMs = Math.abs(gap) < CLOCK_NOISE_MS ? 0 : gap;
}

/** The server's idea of now, in epoch milliseconds. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Test seam: forget the recorded gap. */
export function resetServerClock(): void {
  offsetMs = 0;
}
