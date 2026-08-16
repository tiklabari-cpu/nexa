/**
 * Route names and param lists for the app shell.
 *
 * Each tab owns a stack, and today every stack has exactly one screen — its
 * placeholder root. `13.7-f`…`-j` extend these param lists as they add real
 * screens (a chat detail push, a customer detail push, …); nothing here is
 * speculative infrastructure for routes that do not exist yet, it is the
 * minimum shape a stack navigator requires to type-check at all.
 */

export const ROOT_TABS = ['Inbox', 'Customers', 'Reports', 'Settings'] as const;
export type RootTabName = (typeof ROOT_TABS)[number];

export type RootTabParamList = {
  Inbox: undefined;
  Customers: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type InboxStackParamList = {
  InboxHome: undefined;
  /** One conversation. `title` is carried so the header is right on push. */
  ChatDetail: { chatId: string; title: string };
  /** The Copilot assist for one conversation (13.7-i), pushed from its header. */
  ChatCopilot: { chatId: string; title: string };
};
export type CustomersStackParamList = {
  CustomersHome: undefined;
  /** One contact. `title` is carried so the header is right on push. */
  CustomerDetail: { customerId: string; title: string };
};
export type ReportsStackParamList = { ReportsHome: undefined };
export type SettingsStackParamList = { SettingsHome: undefined };
