/**
 * Campaign targeting in the browser (EN-03 · tm 352.2 · NFR-P3).
 *
 * The server decides where the visitor is and who they are; the two facts only
 * the browser has — how long they have been on the page and whether they are
 * about to leave it — arrive here as the card's `show_when`. This module holds
 * a waiting card until those rules hold, drops it when the visitor moves to a
 * page it does not apply to, reports it shown once it is drawn, and tells the
 * server the page the visitor moved to (a single-page site) and the variables
 * the site set.
 *
 * It is a chunk of its own, fetched only for a workspace with a campaign
 * running (`campaign_tracking` on the mint) — the way the Help tab is
 * (`lazy-chunks.ts`) — so every other page pays nothing for it. It imports
 * nothing but types: a value from the shared barrel would become a chunk both
 * halves load.
 */
import type { CampaignRule, CampaignShowWhen } from '@siyahtus/types';

/** Variables the server accepts: at most 20 keys of at most 100 characters. */
const MAX_VARIABLES = 20;
const MAX_LENGTH = 100;
/** The customer token allows 60 requests a minute and the chat shares them. */
const MIN_GAP_MS = 2_000;

/** The campaign card the widget keeps for the one proactive-card slot. */
export interface CampaignCard {
  id: string;
  message: string;
  /** The browser-side rules it waits for; null for a card shown at once. */
  when: CampaignShowWhen | null;
  /** The rules hold (always, with no `when`): the card may be drawn. */
  ready: boolean;
  /** It has been drawn and the server told. */
  shown: boolean;
}

export interface TargetingHost {
  /** The page the visitor is on when the widget loads, and when they got there. */
  url: string;
  since: number;
  /** The widget's state: the one campaign slot. */
  slot: { campaign: CampaignCard | null };
  /** Writes with the visitor's token; a failure is not the visitor's problem. */
  api: { post(path: string, body?: unknown): Promise<void> };
  /** The visitor already waved this campaign away. */
  dismissed(id: string): boolean;
  /** Redraw the proactive card. */
  render(): void;
  /** Poll again (the server re-offers a waiting card that still applies). */
  refresh(): void;
}

export interface Targeting {
  /** The workspace has a campaign running: report page changes and variables. */
  track(): void;
  page(url: string): void;
  exit(): void;
  /** The site's variables (merged by the caller); keeps what the server takes. */
  variables(raw: Record<string, unknown>): void;
  /** What a poll offers: a card with `show_when` is held, a waiting one that is not offered goes. */
  offer(
    campaign: { id: string; message: string; show_when?: CampaignShowWhen | null } | null,
  ): void;
  /** A card that waited is on screen now: the send counts as displayed. */
  shown(): void;
  stop(): void;
}

/** Whether a browser-side rule holds. A rule it cannot read never does. */
function ruleHolds(rule: CampaignRule, seconds: number, exited: boolean): boolean {
  if (rule.field === 'exit_intent') return exited;
  if (rule.field !== 'time_on_page' || typeof rule.value !== 'number') return false;
  return rule.op === 'gt' ? seconds > rule.value : seconds >= rule.value;
}

export function showWhenHolds(when: CampaignShowWhen, seconds: number, exited: boolean): boolean {
  if (when.rules.length === 0) return false;
  const holds = (rule: CampaignRule): boolean => ruleHolds(rule, seconds, exited);
  return when.match === 'any' ? when.rules.some(holds) : when.rules.every(holds);
}

export function createTargeting(host: TargetingHost, win: Window): Targeting {
  const { slot } = host;
  let tracking = false;
  let url = host.url;
  let pageSince = host.since;
  let variables: Record<string, string | number | boolean> | undefined;
  let exited = false;
  let evaluateTimer: number | undefined;
  let sendTimer: number | undefined;
  let lastSent = 0;
  let stopped = false;

  /** The card that still waits for the browser, if any. */
  const waiting = (): CampaignCard | null =>
    slot.campaign?.when && !slot.campaign.ready ? slot.campaign : null;

  function evaluate(): void {
    win.clearTimeout(evaluateTimer);
    const card = waiting();
    if (!card?.when || stopped) return;
    const elapsed = Date.now() - pageSince;
    if (showWhenHolds(card.when, elapsed / 1000, exited)) {
      card.ready = true;
      host.render();
      return;
    }
    // The next moment a time rule can start to hold: its seconds, and a hair
    // more for `gt`.
    const next = card.when.rules
      .filter((rule) => rule.field === 'time_on_page' && typeof rule.value === 'number')
      .map((rule) => (rule.value as number) * 1000 + (rule.op === 'gt' ? 1 : 0))
      .filter((due) => due > elapsed);
    if (next.length > 0) evaluateTimer = win.setTimeout(evaluate, Math.min(...next) - elapsed);
  }

  /** Forget a waiting card (the visitor moved on, or the server stopped offering it). */
  function drop(): void {
    win.clearTimeout(evaluateTimer);
    exited = false;
    if (!waiting()) return;
    slot.campaign = null;
    host.render();
  }

  function send(): void {
    if (sendTimer !== undefined || !tracking || stopped) return;
    sendTimer = win.setTimeout(
      () => {
        sendTimer = undefined;
        lastSent = Date.now();
        const report = host.api.post('/customer/visit', { url, ...(variables && { variables }) });
        void report.catch(() => undefined).then(() => host.refresh());
      },
      Math.max(0, lastSent + MIN_GAP_MS - Date.now()),
    );
  }

  return {
    track() {
      tracking = true;
      if (variables) send();
    },
    page(next) {
      if (next === url) return;
      url = next;
      pageSince = Date.now();
      drop();
      send();
    },
    exit() {
      // Only an exit made while a card waits counts.
      if (!waiting()) return;
      exited = true;
      evaluate();
    },
    variables(raw) {
      const kept: Record<string, string | number | boolean> = {};
      for (const [name, value] of Object.entries(raw)) {
        const key = name.trim().slice(0, MAX_LENGTH);
        if (!key || Object.keys(kept).length >= MAX_VARIABLES) continue;
        if (typeof value === 'string') kept[key] = value.slice(0, MAX_LENGTH);
        else if (typeof value === 'boolean' || (typeof value === 'number' && isFinite(value))) {
          kept[key] = value;
        }
      }
      if (Object.keys(kept).length === 0) return;
      variables = kept;
      send();
    },
    offer(campaign) {
      const card = waiting();
      // A waiting card the server no longer offers (the visitor is on a page it
      // does not apply to) goes; the one offered again keeps its progress.
      if (card && card.id !== campaign?.id) drop();
      const when = campaign?.show_when;
      if (!campaign || !when || slot.campaign || host.dismissed(campaign.id)) return;
      exited = false;
      slot.campaign = {
        id: campaign.id,
        message: campaign.message,
        when,
        ready: false,
        shown: false,
      };
      evaluate();
    },
    shown() {
      const card = slot.campaign;
      if (!card?.when || card.shown) return;
      card.shown = true;
      const id = encodeURIComponent(card.id);
      void host.api.post(`/customer/campaigns/${id}/shown`).catch(() => undefined);
    },
    stop() {
      stopped = true;
      win.clearTimeout(evaluateTimer);
      win.clearTimeout(sendTimer);
    },
  };
}
