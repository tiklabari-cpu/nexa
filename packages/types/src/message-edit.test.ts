import { describe, expect, it } from 'vitest';
import {
  EDITED_AT_PROPERTY,
  EDITED_BY_PROPERTY,
  MESSAGE_EDIT_WINDOW_SECONDS,
  isEditableEventType,
  isWithinEditWindow,
  readEditedAt,
  stripEditMarkers,
} from './message-edit.js';

describe('isEditableEventType', () => {
  it('accepts a plain message', () => {
    expect(isEditableEventType('message')).toBe(true);
  });

  it('refuses every other event type', () => {
    // Rewriting the text of one of these would leave the event disagreeing
    // with its own contents: a file event means its attachment, a system
    // message is the product speaking, and a form is a structured payload.
    for (const type of ['system_message', 'rich_message', 'file', 'filled_form']) {
      expect(isEditableEventType(type), type).toBe(false);
    }
  });
});

describe('isWithinEditWindow', () => {
  const sent = new Date('2026-09-11T10:00:00.000Z');

  it('allows a correction inside the window', () => {
    expect(isWithinEditWindow(sent, new Date('2026-09-11T10:14:59.000Z'))).toBe(true);
  });

  it('allows it at exactly the boundary and refuses one millisecond later', () => {
    const boundary = new Date(sent.getTime() + MESSAGE_EDIT_WINDOW_SECONDS * 1000);
    expect(isWithinEditWindow(sent, boundary)).toBe(true);
    expect(isWithinEditWindow(sent, new Date(boundary.getTime() + 1))).toBe(false);
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(isWithinEditWindow(sent.toISOString(), new Date('2026-09-11T10:01:00.000Z'))).toBe(true);
  });

  it('tolerates an event stamped a moment in the future rather than sealing it', () => {
    // Clock skew between the database and this process must not make a message
    // permanently uneditable — that would be a refusal nobody could explain.
    expect(isWithinEditWindow(sent, new Date(sent.getTime() - 50))).toBe(true);
  });

  it('refuses an unparseable timestamp', () => {
    expect(isWithinEditWindow('not a date', sent)).toBe(false);
  });
});

describe('readEditedAt', () => {
  it('reads the marker the server wrote', () => {
    expect(readEditedAt({ [EDITED_AT_PROPERTY]: '2026-09-11T10:05:00.000Z' })).toBe(
      '2026-09-11T10:05:00.000Z',
    );
  });

  it('reads a never-edited event as null', () => {
    expect(readEditedAt({})).toBeNull();
    expect(readEditedAt({ pending: true })).toBeNull();
  });

  it('never throws on a malformed properties bag', () => {
    // It arrives from the wire and is rendered inside a transcript; a throw
    // here would blank the conversation.
    for (const value of [null, undefined, 'string', 42, { edited_at: 7 }, { edited_at: '' }]) {
      expect(readEditedAt(value)).toBeNull();
    }
  });
});

describe('stripEditMarkers', () => {
  it('removes both markers and keeps everything else', () => {
    expect(
      stripEditMarkers({
        [EDITED_AT_PROPERTY]: '2026-09-11T10:05:00.000Z',
        [EDITED_BY_PROPERTY]: 'agent-1',
        source: 'widget',
      }),
    ).toEqual({ source: 'widget' });
  });

  it('leaves a bag that carries neither untouched', () => {
    expect(stripEditMarkers({ source: 'widget' })).toEqual({ source: 'widget' });
  });
});
