import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { accounts } from './accounts.js';
import { admins } from './operator-alerts.js';
import { ai } from './ai.js';
import { auth } from './auth.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { settings } from './settings.js';
import { operations } from './operations.js';
import { security } from './security.js';
import { shell } from './shell.js';
import { support } from './support.js';
import { workspaces } from './workspaces.js';

export const trNamespaces: Record<Namespace, Messages> = {
  accounts,
  admins,
  ai,
  auth,
  common,
  dashboard,
  settings,
  operations,
  security,
  shell,
  support,
  workspaces,
};

export const tr: Messages = mergeNamespaces('tr', trNamespaces);
