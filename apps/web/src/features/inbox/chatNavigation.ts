/**
 * Alt+↑ / Alt+↓ through the chat list (IN-08).
 *
 * The list the agent sees is the list that is walked — whatever filter, tab or
 * channel is in force — and it stops at either end rather than wrapping: a
 * wrap would silently jump from the oldest chat to the newest, and the agent
 * who held the key down would not know they had left the list.
 */

/**
 * The chat a step from `currentId` lands on. `null` when there is nothing to
 * move to (empty list). A step past either end stays on the current chat; with
 * no chat open (or one the filter hides) a step lands on the first row going
 * down and the last going up.
 */
export function adjacentChatId(
  ids: readonly string[],
  currentId: string | null,
  step: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index === -1) return step === 1 ? ids[0]! : ids[ids.length - 1]!;
  const next = index + step;
  if (next < 0 || next >= ids.length) return ids[index]!;
  return ids[next]!;
}
