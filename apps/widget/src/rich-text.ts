/**
 * The agent's formatting, as the visitor reads it (FR-MOD-11.4, tm 235).
 *
 * The console's composer has offered `**bold**` / `*italic*` / `- ` since
 * tm 189.5 and its own transcript has rendered them since — but the widget
 * printed the same text with `textContent`, so everything an agent emphasised
 * reached the customer wearing its asterisks. This closes that half.
 *
 * Two rules, both inherited rather than re-decided:
 *
 *   - **No `innerHTML`.** The subset is built out of `createElement` and text
 *     nodes, so nothing here can parse markup out of a message however it is
 *     shaped (NFR-S6, and the eslint config bans the property outright).
 *   - **The subset is parsed in one place.** `@nexa/types#parseRichText` is
 *     shared with the console; two copies would drift and the visitor would
 *     then be shown something other than what the agent was shown.
 */
import { parseRichText } from '@nexa/types';

/**
 * Appends `text` to `target` as the subset's nodes.
 *
 * The caller decides *whether* to parse: a customer's own words are appended
 * with `textContent` instead, so their literal asterisks read back exactly as
 * they typed them. That gate is a product decision, not a safety one — this
 * function is equally safe on any input, since a segment's content only ever
 * becomes characters.
 */
export function appendRichText(doc: Document, target: Node, text: string): void {
  for (const segment of parseRichText(text)) {
    if (segment.type === 'text') {
      target.appendChild(doc.createTextNode(segment.content));
      continue;
    }
    const element = doc.createElement(segment.type === 'bold' ? 'strong' : 'em');
    element.textContent = segment.content;
    target.appendChild(element);
  }
}
