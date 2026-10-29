import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDGET_AVAILABILITY_MODE,
  isWidgetAvailabilityMode,
  widgetAvailability,
} from './widget-availability.js';

describe('widgetAvailability (WG-09)', () => {
  it('opens a chat with the AI whenever an AI would answer, in either mode', () => {
    for (const mode of ['always', 'agents_only'] as const) {
      for (const humansOnline of [false, true]) {
        expect(widgetAvailability({ mode, aiAvailable: true, humansOnline })).toEqual({
          can_start_chat: true,
          answered_by: 'ai',
        });
      }
    }
  });

  it('opens a chat with a person while anyone accepts chats', () => {
    expect(
      widgetAvailability({ mode: 'agents_only', aiAvailable: false, humansOnline: true }),
    ).toEqual({ can_start_chat: true, answered_by: 'human' });
  });

  it('with nobody to answer, `always` still opens a chat and `agents_only` does not', () => {
    expect(widgetAvailability({ mode: 'always', aiAvailable: false, humansOnline: false })).toEqual(
      { can_start_chat: true, answered_by: 'none' },
    );
    expect(
      widgetAvailability({ mode: 'agents_only', aiAvailable: false, humansOnline: false }),
    ).toEqual({ can_start_chat: false, answered_by: 'none' });
  });

  it('defaults to `always` and knows only the two modes', () => {
    expect(DEFAULT_WIDGET_AVAILABILITY_MODE).toBe('always');
    expect(isWidgetAvailabilityMode('agents_only')).toBe(true);
    expect(isWidgetAvailabilityMode('never')).toBe(false);
    expect(isWidgetAvailabilityMode(undefined)).toBe(false);
  });
});
