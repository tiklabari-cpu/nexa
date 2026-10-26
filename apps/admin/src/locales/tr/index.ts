import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { accounts } from './accounts.js';
import { auth } from './auth.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { settings } from './settings.js';
import { shell } from './shell.js';
import { support } from './support.js';
import { workspaces } from './workspaces.js';

export const trNamespaces: Record<Namespace, Messages> = {
  accounts,
  auth,
  common,
  dashboard,
  settings,
  shell,
  support,
  workspaces,
};

export const tr: Messages = mergeNamespaces('tr', trNamespaces);
