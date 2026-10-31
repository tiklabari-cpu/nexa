import { describe, expect, it } from 'vitest';
import {
  CANNED_VARIABLES,
  escapeCannedValue,
  fillCannedResponse,
  findCannedResponseProblems,
  firstNameOf,
} from './canned-variables.js';

describe('saved-reply variables (IN-06)', () => {
  it('knows the nine variables the composer can fill', () => {
    expect(CANNED_VARIABLES).toEqual([
      'customer.name',
      'customer.first_name',
      'customer.username',
      'customer.email',
      'agent.name',
      'agent.first_name',
      'chat.id',
      'thread.id',
      'company.name',
    ]);
  });

  it('accepts every catalogue variable and refuses an unknown or malformed one', () => {
    expect(findCannedResponseProblems('Hi {{customer.name}}, {{ agent.first_name }} here')).toEqual(
      [],
    );
    expect(findCannedResponseProblems('Hi {{customer.nam}}')).toMatchObject([
      { token: '{{customer.nam}}', reason: 'unknown_variable' },
    ]);
    // A ticket-only variable is not a saved-reply one.
    expect(findCannedResponseProblems('{{ticket.id}}')).toMatchObject([
      { reason: 'unknown_variable' },
    ]);
    expect(findCannedResponseProblems('Hi {{customer.name}')).toMatchObject([
      { reason: 'malformed', token: '{{' },
    ]);
    expect(findCannedResponseProblems('Plain text, no braces')).toEqual([]);
  });

  it('fills a known value and puts the fallback where a value is missing', () => {
    const filled = fillCannedResponse(
      'Merhaba {{customer.name}}, ben {{agent.first_name}}. Kullanıcı: {{customer.username}}',
      { 'customer.name': 'Ayşe Yılmaz', 'agent.first_name': 'Mert', 'customer.username': null },
      'Değerli üyemiz',
    );
    expect(filled.text).toBe('Merhaba Ayşe Yılmaz, ben Mert. Kullanıcı: Değerli üyemiz');
    expect(filled.fallbacks).toHaveLength(1);
    const [range] = filled.fallbacks;
    expect(filled.text.slice(range!.start, range!.end)).toBe('Değerli üyemiz');
  });

  it('records every fallback in order and leaves an unknown placeholder untouched', () => {
    const filled = fillCannedResponse(
      '{{customer.name}} / {{nope.x}} / {{customer.email}}',
      {},
      'X',
    );
    expect(filled.text).toBe('X / {{nope.x}} / X');
    expect(filled.fallbacks).toEqual([
      { start: 0, end: 1 },
      { start: 17, end: 18 },
    ]);
  });

  it('escapes what the player typed: no markers, no line breaks, no re-expansion', () => {
    const filled = fillCannedResponse(
      'Hi {{customer.name}}',
      { 'customer.name': '**Boss**\n- {{agent.name}}' },
      'friend',
    );
    expect(filled.text).toBe('Hi ∗∗Boss∗∗ - {{agent.name}}');
    expect(filled.text).not.toContain('*');
    expect(filled.text).not.toContain('\n');
    expect(escapeCannedValue('   ')).toBe('');
    expect(escapeCannedValue('a'.repeat(500))).toHaveLength(120);
  });

  it('treats a blank value as missing', () => {
    expect(fillCannedResponse('{{customer.name}}', { 'customer.name': '  ' }, 'F').text).toBe('F');
  });

  it('takes the first word of a name', () => {
    expect(firstNameOf('  Ayşe  Nur Yılmaz ')).toBe('Ayşe');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
