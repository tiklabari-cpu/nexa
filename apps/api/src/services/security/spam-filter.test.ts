/**
 * Spam classifier — negative first (FR-MOD-08.9.3).
 *
 * The false-positive boundary is the whole point of a deterministic filter, so
 * the legitimate messages that must PASS are asserted before the spam that must
 * be caught. A rule that starts eating short greetings, a genuine question that
 * happens to carry a link, or a customer repeating themselves is a worse failure
 * than a spam message slipping through.
 */
import { describe, expect, it } from 'vitest';
import { classifyText, evaluateSpam, type SpamReason } from './spam-filter.js';

describe('classifyText — legitimate messages pass (false-positive boundary)', () => {
  const legit: ReadonlyArray<[string, string]> = [
    ['a short greeting', 'hi'],
    ['a one-word greeting', 'Hello'],
    ['a Turkish greeting', 'merhaba'],
    ['a plain question', 'Where is my order?'],
    ['a question with one link', 'How do I reset my password? https://example.com/help'],
    ['two links in a real sentence', 'Compare https://a.example/x and https://b.example/y please'],
    ['a repeated-but-legitimate nudge', 'hello anyone there is anyone home hello'],
    ['emphatic punctuation', 'Please help!!! I really need this fixed today.'],
    ['an order id the visitor pasted', 'My order number is ORD-2026-000813, can you check it?'],
    [
      'a long but ordinary message',
      'I have been waiting for three days and nobody has replied to my email yet, could someone please look into this for me today?',
    ],
    ['a stretched word', 'that is sooooo frustrating'],
    ['an email address', 'you can reach me at jane.doe@example.com anytime'],
  ];

  it.each(legit)('passes %s', (_label, text) => {
    expect(classifyText(text).spam).toBe(false);
  });
});

describe('classifyText — spam is caught', () => {
  const spam: ReadonlyArray<[string, string, SpamReason]> = [
    ['a link flood', 'deals http://a.co http://b.co http://c.co http://d.co http://e.co', 'links'],
    ['a www link flood', 'www.a.co www.b.co www.c.co www.d.co', 'links'],
    ['a dominating repeated token', 'FREE FREE FREE FREE FREE FREE FREE FREE money', 'repetition'],
    ['a hammered character run', `buy${'y'.repeat(25)} now`, 'repetition'],
    ['a blocklisted prize phrase', 'Congratulations! You have won a brand new iPhone', 'blocklist'],
    ['a blocklisted claim phrase', 'Click here to claim your reward before it expires', 'blocklist'],
    ['a pharma spam token', 'cheap viagra shipped fast', 'blocklist'],
    ['a gibberish blob', 'qwertyuiopasdfghjklzxcvbnmqazwsxedcrfvtgby please', 'gibberish'],
  ];

  it.each(spam)('flags %s', (_label, text, reason) => {
    const verdict = classifyText(text);
    expect(verdict.spam).toBe(true);
    expect(verdict.reason).toBe(reason);
  });
});

describe('classifyText — boundary details', () => {
  it('does not flag three links (only a flood of four+)', () => {
    expect(classifyText('see http://a.co http://b.co and http://c.co').spam).toBe(false);
  });

  it('does not flag a token repeated fewer than five times', () => {
    expect(classifyText('please please please help me now').spam).toBe(false);
  });

  it('does not treat a long URL as a gibberish run', () => {
    const url = `https://example.com/${'a'.repeat(60)}`;
    expect(classifyText(`here is the page ${url}`).spam).toBe(false);
  });

  it('treats empty or whitespace text as clean', () => {
    expect(classifyText('').spam).toBe(false);
    expect(classifyText('   \n\t ').spam).toBe(false);
  });

  it('classifies a pathological non-alphanumeric token in linear time', () => {
    // A ~10 KB token, alphanumeric at both ends with a middle of alternating
    // zero-width spaces (U+200B) and non-joiners (U+200C): both survive
    // whitespace splitting yet are non-alphanumeric, and no character repeats
    // 20x in a row — a benign message that must neither hang nor be falsely
    // flagged. That shape is what made a `$`-anchored strip regex O(n^2) (a ~1 s
    // event-loop block from one widget message); the fix keeps it linear. Five
    // distinct filler tokens satisfy the >=6-token repetition branch without
    // themselves tripping it. The bound is generous — the linear form is ~1 ms.
    const filler = '\u200B\u200C'.repeat(4_995);
    const input = `one two three four five ${`a${filler}b`}`;
    const started = performance.now();
    expect(classifyText(input).spam).toBe(false);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('evaluateSpam — the gate', () => {
  it('passes everything when the filter is off', () => {
    expect(
      evaluateSpam({ filterEnabled: false, text: 'FREE FREE FREE FREE FREE FREE FREE' }).spam,
    ).toBe(false);
    expect(evaluateSpam({ filterEnabled: false, providerFlagged: true }).spam).toBe(false);
  });

  it('honours an upstream provider verdict without inspecting content', () => {
    const verdict = evaluateSpam({ filterEnabled: true, text: 'hello', providerFlagged: true });
    expect(verdict).toEqual({ spam: true, reason: 'provider' });
  });

  it('runs the content classifier when there is no provider verdict', () => {
    expect(evaluateSpam({ filterEnabled: true, text: 'Where is my order?' }).spam).toBe(false);
    expect(
      evaluateSpam({ filterEnabled: true, text: 'Click here to claim your prize now' }).spam,
    ).toBe(true);
  });

  it('passes when there is no text to classify (an attachment on its own)', () => {
    expect(evaluateSpam({ filterEnabled: true }).spam).toBe(false);
    expect(evaluateSpam({ filterEnabled: true, text: null }).spam).toBe(false);
  });
});
