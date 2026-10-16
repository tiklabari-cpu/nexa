/**
 * A link between two customer records joins the agent's history view and
 * nothing else (ID-03 · K4 · tm 287.4). The day's conversation (ID-02) and the
 * AI's memory (AI-02, K5) are read by customer number — so the code that
 * builds them must never read `customer_identity_links`, or a username typed on
 * a stranger's phone plus one mistaken click would put a member's history in
 * front of the AI answering the stranger.
 *
 * The integration suite (`customer-identity-links.test.ts`) shows today's model
 * prompt carries no linked conversation; this keeps the next change to the AI
 * or the conversation services from quietly starting to read links. A module
 * that has a real reason to must argue it here first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

/** Where the AI's context and the visitor's conversation are put together. */
const MUST_NOT_READ_LINKS = [
  'services/ai',
  'services/chat',
  'services/bots',
  'routes/customer.ts',
  'routes/copilot.ts',
];

const LINK_READERS =
  /customer_identity_links|customerIdentityLink|CustomerIdentityService|customer-identity/;

function sourceFiles(path: string): string[] {
  const full = join(SRC, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => sourceFiles(join(path, entry)));
}

describe('customer identity links stay out of the AI and the conversation (ID-03 · K4)', () => {
  const files = MUST_NOT_READ_LINKS.flatMap(sourceFiles).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );

  it('found the modules it guards', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith('ai-responder.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('chat-service.ts'))).toBe(true);
  });

  it('finds no read of customer_identity_links in them', () => {
    const readers = files
      .filter((file) => LINK_READERS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(readers).toEqual([]);
  });
});
