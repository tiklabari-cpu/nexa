/**
 * The console's chime, and the browser rule that can silence it (IN-10 · tm 367).
 *
 * A browser keeps an `AudioContext` suspended until the page has seen a user
 * gesture. A console that was reloaded and then left alone while the agent
 * works elsewhere has had no gesture — its first chime would fail without a
 * word, which is the worst way for "play a sound" to fail. So:
 *
 *  - one shared context rather than a new one per chime (a fresh context needs
 *    its own permission and is not free), resumed on the first click or key;
 *  - when a chime is wanted and the context is not running, the state is
 *    published ({@link audioBlocked}) and the shell shows a one-click "enable
 *    sounds" hint — the agent finds out *here*, not by missing a player.
 *
 * Best-effort throughout: no audio device, no `AudioContext` (jsdom) or a
 * blocked context is a silent no-op, never an exception.
 */

let context: AudioContext | null = null;
let blocked = false;
const listeners = new Set<() => void>();
let gestureListenersInstalled = false;

function setBlocked(next: boolean): void {
  if (blocked === next) return;
  blocked = next;
  for (const listener of listeners) listener();
}

/** Is a wanted chime waiting on a user gesture? Drives the "enable sounds" hint. */
export function audioBlocked(): boolean {
  return blocked;
}

export function subscribeAudioBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/** True once the page has been clicked, tapped or typed into (unknown → true). */
function hasUserGesture(): boolean {
  const activation = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  return activation ? activation.hasBeenActive : true;
}

function getContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor();
    context.addEventListener('statechange', () => {
      if (context?.state === 'running') setBlocked(false);
    });
  } catch {
    context = null;
  }
  return context;
}

/**
 * Called from a user gesture: create the context if need be and let it run.
 * Safe to call repeatedly.
 */
export function unlockAudio(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    setBlocked(false);
    return;
  }
  void ctx.resume().then(
    () => setBlocked(ctx.state !== 'running'),
    () => undefined,
  );
}

/**
 * Unlock the audio on the first click or key press, once. Called by the shell.
 * Returns the way to take the listeners off again.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined' || gestureListenersInstalled) return () => undefined;
  gestureListenersInstalled = true;
  const unlock = (): void => {
    unlockAudio();
    off();
  };
  const off = (): void => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    gestureListenersInstalled = false;
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  return off;
}

/**
 * A short two-tone chime, synthesised so the app ships no audio asset and needs
 * no network fetch. Returns whether it was started — false when the browser has
 * not let this page make sound yet (the hint is then showing).
 */
export function playChime(): boolean {
  try {
    const ctx = getContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      if (!hasUserGesture()) {
        setBlocked(true);
        return false;
      }
      void ctx.resume().then(
        () => setBlocked(ctx.state !== 'running'),
        () => undefined,
      );
      // Not running yet: this chime is lost, the next one is not.
      setBlocked(true);
      return false;
    }

    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => {
      gain.disconnect();
    };
    return true;
  } catch {
    // No audio device or a blocked context — the badge still tells the agent.
    return false;
  }
}

/** For tests: forget the shared context and the blocked flag. */
export function resetAudioForTests(): void {
  context = null;
  blocked = false;
  listeners.clear();
  gestureListenersInstalled = false;
}
