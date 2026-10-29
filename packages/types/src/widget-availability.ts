/**
 * When a visitor may start a chat (WG-09 · tm 341).
 *
 * Before this the widget decided on its own, from two facts that were never a
 * setting: whether any *person* was accepting chats, and whether the workspace
 * had built an offline form. An AI that answers around the clock did not count,
 * so at night a workspace with an offline form sent its players to "leave a
 * message" while the AI sat idle. The choice is now the workspace's, per brand
 * (`widget_settings.availability_mode`), and the server works out what it means
 * on each poll of `GET /customer/chat`:
 *
 *   AI would answer             → a chat, answered by the AI. Nobody to hand it
 *                                  to is the AI's after-hours path (AI-12).
 *   no AI, someone accepting    → a chat, answered by a person.
 *   no AI, nobody, `always`     → a chat that waits unassigned.
 *   no AI, nobody, `agents_only`→ the offline form (name, e-mail, message),
 *                                  with or without the workspace's own questions.
 */

export const WIDGET_AVAILABILITY_MODES = ['always', 'agents_only'] as const;
export type WidgetAvailabilityMode = (typeof WIDGET_AVAILABILITY_MODES)[number];

/** Closest to how the widget behaved for a workspace without an offline form. */
export const DEFAULT_WIDGET_AVAILABILITY_MODE: WidgetAvailabilityMode = 'always';

export function isWidgetAvailabilityMode(value: unknown): value is WidgetAvailabilityMode {
  return (WIDGET_AVAILABILITY_MODES as readonly unknown[]).includes(value);
}

/** Who answers the visitor now, as `CustomerChatState.answered_by` reports it. */
export const WIDGET_ANSWERERS = ['human', 'ai', 'none'] as const;
export type WidgetAnsweredBy = (typeof WIDGET_ANSWERERS)[number];

export interface WidgetAvailability {
  can_start_chat: boolean;
  answered_by: WidgetAnsweredBy;
}

/**
 * The decision table above, for a visitor with no open conversation. `aiAvailable`
 * is "an AI would answer a chat opened now" — an active agent with something to
 * run whose allowances (the workspace's day, the visitor's share) are not spent.
 */
export function widgetAvailability(input: {
  mode: WidgetAvailabilityMode;
  aiAvailable: boolean;
  humansOnline: boolean;
}): WidgetAvailability {
  if (input.aiAvailable) return { can_start_chat: true, answered_by: 'ai' };
  if (input.humansOnline) return { can_start_chat: true, answered_by: 'human' };
  return { can_start_chat: input.mode === 'always', answered_by: 'none' };
}
