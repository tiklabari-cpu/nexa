import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { accounts } from './accounts.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { shell } from './shell.js';
import { support } from './support.js';
import { usage } from './usage.js';
import { workspaces } from './workspaces.js';

export const enNamespaces: Record<Namespace, Messages> = {
  accounts,
  auth,
  billing,
  common,
  dashboard,
  shell,
  support,
  usage,
  workspaces,
};

export const en: Messages = mergeNamespaces('en', enNamespaces);
