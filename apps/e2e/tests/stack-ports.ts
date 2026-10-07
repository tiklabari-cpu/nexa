/**
 * Where the e2e stack's servers listen (tm 260.1), shared by
 * `playwright.config.ts`, which starts them, and every helper or spec that
 * calls one of them from Node.
 *
 * Unset `SIYAHTUS_E2E_SHARD`, this is the usual stack: api 4000, rtm 4001,
 * web 5173, widget 5174, mail 4625/4626, IdP 4599 — what a developer's own dev
 * servers hold, and what the suite adopts locally (`reuseExistingServer`).
 *
 * Set to a shard number `i` (0–5), the stack is a private one, started by this
 * run alone, on the usual ports + 1000 × (i + 1): shard 0 is api 5000, rtm
 * 5001, web 6173, widget 6174, mail 5625/5626, IdP 5599. None of them meets
 * the usual ports, the pilot stack's (41xx/52xx/47xx) or the session stack's
 * (42xx/53xx/48xx), and shards never meet each other.
 *
 * Only Node needs these numbers. The browser keeps seeing the usual origins —
 * Chromium's resolver maps them onto the private ports (`playwright.config.ts`),
 * so the page still runs on `http://localhost:5173`, the one OAuth redirect
 * every workspace registers. The IdP is the exception that needs no mapping:
 * its metadata names its own address, and the browser goes there directly.
 */

export interface StackPorts {
  api: number;
  rtm: number;
  web: number;
  widget: number;
  smtp: number;
  mailbox: number;
  idp: number;
}

export const USUAL_PORTS: StackPorts = {
  api: 4000,
  rtm: 4001,
  web: 5173,
  widget: 5174,
  smtp: 4625,
  mailbox: 4626,
  idp: 4599,
};

/** Shards a machine may run at once; ports above this would start to meet other services. */
export const MAX_E2E_SHARDS = 6;

/** This process's shard, or `undefined` on the usual stack. */
export const E2E_SHARD: number | undefined = parseShard(process.env['SIYAHTUS_E2E_SHARD']);

function parseShard(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const shard = Number(raw);
  if (!Number.isInteger(shard) || shard < 0 || shard >= MAX_E2E_SHARDS) {
    throw new Error(
      `SIYAHTUS_E2E_SHARD must be a whole number from 0 to ${MAX_E2E_SHARDS - 1}, not "${raw}".`,
    );
  }
  return shard;
}

/** The ports of shard `shard`'s private stack. */
export function shardPorts(shard: number): StackPorts {
  const offset = 1000 * (shard + 1);
  return Object.fromEntries(
    Object.entries(USUAL_PORTS).map(([name, port]) => [name, port + offset]),
  ) as unknown as StackPorts;
}

/** This process's stack. */
export const PORTS: StackPorts = E2E_SHARD === undefined ? USUAL_PORTS : shardPorts(E2E_SHARD);

/** For calls made from Node, which Chromium's resolver rule does not cover. */
export const STACK_API = `http://localhost:${PORTS.api}`;
export const STACK_RTM = `http://localhost:${PORTS.rtm}`;
export const STACK_RTM_WS = `ws://localhost:${PORTS.rtm}`;
export const STACK_MAILBOX = `http://127.0.0.1:${PORTS.mailbox}`;
export const STACK_IDP = `http://127.0.0.1:${PORTS.idp}`;

/**
 * A browser-facing address (`http://localhost:4000/…`), as Node must dial it.
 * For a spec that asserts on the address the page sees — a canonical link, a
 * sitemap entry — and then fetches the same address from Node.
 */
export function fromNode(url: string): string {
  if (E2E_SHARD === undefined) return url;
  const parsed = new URL(url);
  const name = (Object.keys(USUAL_PORTS) as Array<keyof StackPorts>).find(
    (key) => String(USUAL_PORTS[key]) === parsed.port,
  );
  if (name) parsed.port = String(PORTS[name]);
  return parsed.toString();
}
