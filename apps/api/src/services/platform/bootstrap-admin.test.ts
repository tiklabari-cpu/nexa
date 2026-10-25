/**
 * The bootstrap CLI's input handling (tm 389.4). The refusal once an operator
 * exists — and the command itself, run as a process — is
 * `test/integration/platform-auth.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanPasswordInput,
  parseBootstrapArgs,
  PlatformBootstrapRefused,
} from './bootstrap-admin.js';

describe('the bootstrap CLI input (tm 389.4)', () => {
  it('keeps the first line of stdin and drops the line ending a terminal or echo leaves', () => {
    expect(cleanPasswordInput('a-long-password\r\n')).toBe('a-long-password');
    expect(cleanPasswordInput('a-long-password\n')).toBe('a-long-password');
    expect(cleanPasswordInput('a-long-password\r')).toBe('a-long-password');
    expect(cleanPasswordInput('a-long-password')).toBe('a-long-password');
    expect(cleanPasswordInput('first\nsecond\n')).toBe('first');
    // Inner spaces are the password's own.
    expect(cleanPasswordInput(' spaced out \n')).toBe(' spaced out ');
  });

  it('reads --email in both spellings and refuses anything else', () => {
    expect(parseBootstrapArgs(['--email', 'ops@example.test'])).toEqual({
      email: 'ops@example.test',
    });
    expect(parseBootstrapArgs(['--email=ops@example.test'])).toEqual({
      email: 'ops@example.test',
    });
    expect(() => parseBootstrapArgs([])).toThrow(PlatformBootstrapRefused);
    expect(() => parseBootstrapArgs(['--password', 'x'])).toThrow(/Unknown argument/);
  });
});
