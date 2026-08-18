/**
 * Route names and param lists for the app shell.
 *
 * Each tab owns a stack, and every route below is mounted and reached by a real
 * screen — `13.7-f`…`-j` filled the four surfaces in, `13.7-m`…`-o` hung the
 * parity modules off Settings, and `13.7-p`…`-r` added the tree in front of all
 * of them. Nothing here is speculative infrastructure: `parity.test.ts` fails a
 * route that is typed and never handed to a `Stack.Screen`, which is what keeps
 * this file a description of the app rather than an intention about it.
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

import type { Agent } from '../features/team/types';

export const ROOT_TABS = ['Inbox', 'Customers', 'Reports', 'Settings'] as const;
export type RootTabName = (typeof ROOT_TABS)[number];

/**
 * The signed-out tree (13.7-p). Mounted instead of the tabs, never beside them.
 *
 * `WorkspacePicker` takes no params, and that absence is deliberate rather than
 * incidental: the step needs the credentials `/auth/login` just accepted, and
 * navigation state is serialised, persisted across restarts and — since
 * `13.7-q` added `linking` — reachable as a URL. `AuthStack` carries them in
 * component state and hands them down as a prop, so no credential is ever named
 * in this file.
 *
 * `SignIn`'s one param obeys the same rule from the other direction. It is what
 * an SSO callback that arrived too late leaves behind (`app/linking.ts`): a
 * boolean saying "you came back from the browser", never the code that came
 * with it.
 */
export type AuthStackParamList = {
  SignIn: { returned?: boolean } | undefined;
  WorkspacePicker: undefined;
};

/**
 * `Inbox` names its nested stack rather than `undefined`, which is what makes
 * the conversation inside it addressable — both by `nexa://chats/<id>`
 * (13.7-q) and by a `navigate('Inbox', { screen: 'ChatDetail', … })` from
 * outside the tab. The other three tabs have nothing to reach into yet.
 */
export type RootTabParamList = {
  Inbox: NavigatorScreenParams<InboxStackParamList> | undefined;
  Customers: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type InboxStackParamList = {
  InboxHome: undefined;
  /**
   * One conversation. `title` is carried so the header is right on push — and
   * is optional because a deep link cannot carry one (13.7-q): arriving that
   * way, the header starts generic and the screen replaces it once the list has
   * said who this is.
   */
  ChatDetail: { chatId: string; title?: string };
  /** The Copilot assist for one conversation (13.7-i), pushed from its header. */
  ChatCopilot: { chatId: string; title: string };
};
export type CustomersStackParamList = {
  CustomersHome: undefined;
  /** One contact. `title` is carried so the header is right on push. */
  CustomerDetail: { customerId: string; title: string };
};
export type ReportsStackParamList = { ReportsHome: undefined };
export type SettingsStackParamList = {
  SettingsHome: undefined;
  /** The roster (13.7-m). No `GET /agents/{agentId}` exists, so the row this
   * was opened from is carried rather than re-fetched. */
  TeamList: undefined;
  TeamMember: { agent: Agent; title: string };
  TeamGroups: undefined;
  /** The Playbook/AI administration parity module (13.7-n). Unlike the
   * roster, `GET /skills/{skillId}` exists, so only the id and the title for
   * the header are carried — the detail screen re-fetches its own copy. */
  SkillList: undefined;
  SkillDetail: { skillId: string; title: string };
  KnowledgeSources: undefined;
  /** The Billing parity module (13.7-o) — one screen, no per-record push:
   * plan, usage, entitlements and invoices all load together. */
  Billing: undefined;
  /** Who is signed in, on which workspace, and the door out (13.7-r). */
  Account: undefined;
  /**
   * `AuthStack` in `'switch'` mode, pushed while still signed in. Not a
   * `NavigatorScreenParams<AuthStackParamList>` the way `Inbox` nests
   * `InboxStackParamList` — `AccountScreen` never names a screen inside it,
   * it only opens the door, so there is nothing here for a route param to
   * carry.
   */
  SwitchAccount: undefined;
};
