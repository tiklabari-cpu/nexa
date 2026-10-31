/**
 * The chime and the "enable sounds" hint (IN-10 · tm 367 · FR-MOD-13.8).
 *
 * A browser keeps a page silent until a click. These tests pin what the agent
 * sees when that happens: the chime is reported as not played, the hint shows,
 * a click on it unlocks the audio and the hint goes away — and an agent whose
 * audio simply works never sees the hint.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioUnlockHint } from './AudioUnlockHint.js';
import { audioBlocked, playChime, resetAudioForTests } from './chime.js';

type State = 'running' | 'suspended';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: State;
  currentTime = 0;
  destination = {};
  #statechange: Array<() => void> = [];
  resumeCalls = 0;
  started = 0;

  constructor() {
    // Created before any gesture, so it starts suspended unless a test says otherwise.
    this.state = FakeAudioContext.startState;
    FakeAudioContext.instances.push(this);
  }
  static startState: State = 'suspended';

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.#statechange.push(listener);
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    // Only a gesture lets it run.
    if (FakeAudioContext.gestureSeen) {
      this.state = 'running';
      for (const listener of this.#statechange) listener();
    }
    return Promise.resolve();
  }
  static gestureSeen = false;
  createGain() {
    return { gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined };
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: () => void (this.started += 1),
      stop: () => undefined,
      onended: null as null | (() => void),
    };
  }
}

function setUserActivation(hasBeenActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { hasBeenActive },
  });
}

beforeEach(() => {
  resetAudioForTests();
  FakeAudioContext.instances = [];
  FakeAudioContext.startState = 'suspended';
  FakeAudioContext.gestureSeen = false;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  setUserActivation(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  resetAudioForTests();
});

describe('playChime (FR-MOD-13.8)', () => {
  it('is not played, and is reported as blocked, before the page has had a gesture', () => {
    expect(playChime()).toBe(false);
    expect(audioBlocked()).toBe(true);
    // Not even a context was started on a page the browser has not unlocked.
    expect(FakeAudioContext.instances.flatMap((c) => c.started)).not.toContain(1);
  });

  it('plays once the context runs, with one shared context for every chime', () => {
    FakeAudioContext.startState = 'running';
    setUserActivation(true);

    expect(playChime()).toBe(true);
    expect(playChime()).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]!.started).toBe(2);
    expect(audioBlocked()).toBe(false);
  });

  it('does nothing, quietly, where there is no audio at all', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    vi.stubGlobal('AudioContext', undefined);
    expect(playChime()).toBe(false);
    expect(audioBlocked()).toBe(false);
  });
});

describe('AudioUnlockHint (FR-MOD-13.8)', () => {
  it('stays out of the way while the audio works', () => {
    render(<AudioUnlockHint />);
    expect(screen.queryByTestId('audio-unlock-hint')).toBeNull();
  });

  it('appears when a chime was refused, and a click enables the sounds', async () => {
    render(<AudioUnlockHint />);
    act(() => void playChime());

    expect(await screen.findByTestId('audio-unlock-hint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable sounds' })).toBeInTheDocument();

    // The click is the gesture the browser wanted.
    FakeAudioContext.gestureSeen = true;
    setUserActivation(true);
    await userEvent.click(screen.getByRole('button', { name: 'Enable sounds' }));

    await vi.waitFor(() => expect(screen.queryByTestId('audio-unlock-hint')).toBeNull());
    expect(audioBlocked()).toBe(false);
  });
});
