import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { auth } from './auth.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { shell } from './shell.js';
import { support } from './support.js';
import { workspaces } from './workspaces.js';

export const trNamespaces: Record<Namespace, Messages> = {
  auth,
  common,
  dashboard,
  shell,
  support,
  workspaces,
};

export const tr: Messages = mergeNamespaces('tr', trNamespaces);
