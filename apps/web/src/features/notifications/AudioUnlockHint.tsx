/**
 * "Enable sounds" — shown when a chime was wanted and the browser would not play
 * it yet (IN-10 · tm 367).
 *
 * Browsers keep a page silent until it has seen a click or a key press. A
 * console that was reloaded and left alone has had neither, so its first chime
 * would be swallowed without a word. This puts that fact in front of the agent
 * *at the moment it happens*: one small button, whose click is the gesture the
 * browser wanted and plays the chime so they hear what they enabled. It is gone
 * the moment the audio runs, and never shows for an agent who has sound off —
 * nothing asks for a chime then.
 */
import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import {
  audioBlocked,
  installAudioUnlock,
  playChime,
  subscribeAudioBlocked,
  unlockAudio,
} from './chime.js';

export function AudioUnlockHint(): ReactElement | null {
  const t = useTranslate();
  const blocked = useSyncExternalStore(subscribeAudioBlocked, audioBlocked, () => false);

  // The first click or key press anywhere unlocks the audio on its own; the
  // hint is for the agent who has not made one yet.
  useEffect(() => installAudioUnlock(), []);

  if (!blocked) return null;

  return (
    <div
      role="status"
      data-testid="audio-unlock-hint"
      className="fixed bottom-4 left-4 z-50 flex max-w-xs items-center gap-3 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs text-content shadow-lg"
    >
      <span>{t('shell.audio.hint')}</span>
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          // The click is the gesture; the chime proves it worked.
          window.setTimeout(playChime, 50);
        }}
        className="shrink-0 rounded-md border border-border px-2 py-1 font-medium text-content-brand hover:bg-surface-2"
      >
        {t('shell.audio.enable')}
      </button>
    </div>
  );
}
