/**
 * The server's own system lines in the console's language (tm 398): "Chat
 * archived" is English on the wire, and a Turkish console says it in Turkish.
 */
import { describe, expect, it } from 'vitest';
import { translate, type Locale } from '../../lib/i18n.js';
import { eventText } from './systemEventText.js';
import type { ChatEvent } from './types.js';

const tFor = (locale: Locale) => (key: string, params?: Record<string, string | number>) =>
  translate(locale, key, params);

function system(text: string, properties: Record<string, unknown>): ChatEvent {
  return {
    id: 'C1_9',
    chat_id: 'C1',
    thread_id: 'T1',
    type: 'system_message',
    text,
    author_id: null,
    author_type: 'system',
    recipients: 'all',
    attachment_url: null,
    properties,
    created_at: '2026-11-04T10:00:00.000Z',
  };
}

describe('eventText', () => {
  it('says an archived chat in Turkish on a Turkish console and in English on an English one', () => {
    const archived = system('Chat archived', { system_event: 'chat_deactivated' });
    expect(eventText(archived, tFor('tr'))).toBe('Sohbet arşivlendi');
    expect(eventText(archived, tFor('en'))).toBe('Chat archived');
  });

  it('tells the three ways a chat closes apart', () => {
    const rollover = system('Chat closed at the end of the day', {
      system_event: 'chat_deactivated',
      reason: 'day_rollover',
    });
    const timeout = system('Chat closed after inactivity', {
      system_event: 'chat_deactivated',
      reason: 'timeout',
    });
    expect(eventText(rollover, tFor('tr'))).toBe('Sohbet gün sonunda kapatıldı');
    expect(eventText(timeout, tFor('tr'))).toBe('Sohbet hareketsizlik nedeniyle kapatıldı');
    expect(eventText(rollover, tFor('en'))).toBe('Chat closed at the end of the day');
    expect(eventText(timeout, tFor('en'))).toBe('Chat closed after inactivity');
  });

  it('keeps the stored text for an event it does not know, and for a null text', () => {
    expect(
      eventText(system('Chat transferred', { system_event: 'chat_transferred' }), tFor('tr')),
    ).toBe('Chat transferred');
    expect(eventText({ ...system('x', {}), text: null }, tFor('tr'))).toBeNull();
  });

  it('never rewrites a person’s message that happens to carry the property', () => {
    const message: ChatEvent = {
      ...system('Chat archived', { system_event: 'chat_deactivated' }),
      type: 'message',
      author_type: 'customer',
    };
    expect(eventText(message, tFor('tr'))).toBe('Chat archived');
  });
});
