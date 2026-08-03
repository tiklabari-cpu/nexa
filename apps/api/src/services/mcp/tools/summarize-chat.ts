/**
 * `summarize_chat` — MCP adapter for the copilot conversation summary
 * (FR-MOD-08.8.3-f).
 *
 * It reads a chat's transcript, summarises it with the same deterministic
 * `summariseConversation` the copilot route uses, and returns the summary — and
 * nothing else. Unlike `POST /copilot/chats/:chatId/summary`, which files the
 * summary as an internal note, this tool is **read-only** (assumption 7): the
 * copilot route's write path is untouched, no `events` row is added, and no
 * `skill_run` is recorded. That is why the catalogue gates it behind the same
 * read scope as `list_chats` (`chats--*:ro`), not the write scope the copilot
 * summary route requires.
 *
 * Two boundaries this executor does enforce itself, because the query underneath
 * cannot:
 *
 *   - Visibility → 404. `conversationTurns` reads events by `chatId` and would
 *     return an empty list — a bland 200 "nothing to summarise" — for a chat the
 *     caller may not see or that is in another licence. So the visibility gate
 *     runs first, exactly as the chat routes do (`access.ts`): an absent chat, a
 *     chat behind a team the caller's `chats--access` token was never given, or
 *     another licence's chat (RLS makes it invisible) is a 404, never a 403 —
 *     short ids must not become an enumeration oracle (NFR-S5).
 *
 *   - PII on the way out. Card masking happens at write time (`cc-mask.ts`), so
 *     a PAN typed into a conversation is already masked in `events.text`. But a
 *     tool that dumps transcript-derived text to an LLM client is a place a raw
 *     PAN would be unrecoverable if it ever reached the database by some other
 *     path, so the summary is passed through `maskCardNumbers` before it leaves
 *     — defence in depth, the boundary the KK ("PII/CC-mask sınırı") pins.
 *
 * The tenant boundary itself is not this executor's to set: `ctx.tx` already
 * carries the caller's tenant context (RLS), the same as every other MCP tool.
 */
import { summariseConversation } from '@nexa/ai-mock';
import { ApiError } from '../../../lib/api-error.js';
import { maskCardNumbers } from '../../../lib/cc-mask.js';
import { CopilotService } from '../../ai/copilot-service.js';
import { chatVisibilityFilter, resolveVisibility } from '../../chat/access.js';
import type { SummarizeChatArgs } from '../tool-catalog.js';
import type { McpToolExecutor } from '../tool-dispatch.js';

const copilot = new CopilotService();

export const runSummarizeChat: McpToolExecutor = async (ctx, args) => {
  // The tool-call surface validated `args` against the catalogue's
  // `summarizeChatInputSchema` before dispatching, so this shape is guaranteed.
  const { chat_id } = args as SummarizeChatArgs;

  // Gate on visibility the same way the chat routes do, on the caller's already
  // open transaction (`ChatService.get` would open a second, non-nestable one).
  // A chat the caller cannot see — absent, out of their teams, or another
  // licence's — is reported as not found, never forbidden.
  const visibility = await resolveVisibility(ctx.tx, ctx.principal, 'read');
  const chat = await ctx.tx.chat.findFirst({
    where: { id: chat_id, ...chatVisibilityFilter(visibility) },
    select: { id: true },
  });
  if (!chat) throw ApiError.notFound('Chat not found.');

  // Read-only: `conversationTurns` reads events; the summary is not written back.
  const turns = await copilot.conversationTurns(ctx.tx, chat_id);
  const summary = summariseConversation(turns);

  // Re-mask on the read path — a raw PAN must never leave through a tool result.
  return { summary: maskCardNumbers(summary) };
};
