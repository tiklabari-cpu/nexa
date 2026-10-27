import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { accounts } from './accounts.js';
import { admins } from './operator-alerts.js';
import { ai } from './ai.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { settings } from './settings.js';
import { operations } from './operations.js';
import { security } from './security.js';
import { shell } from './shell.js';
import { support } from './support.js';
import { usage } from './usage.js';
import { workspaces } from './workspaces.js';

export const trNamespaces: Record<Namespace, Messages> = {
  accounts,
  admins,
  ai,
  auth,
  billing,
  common,
  dashboard,
  settings,
  operations,
  security,
  shell,
  support,
  usage,
  workspaces,
};

export const tr: Messages = mergeNamespaces('tr', trNamespaces);
