import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { auth } from './auth.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { shell } from './shell.js';

export const enNamespaces: Record<Namespace, Messages> = { auth, common, dashboard, shell };

export const en: Messages = mergeNamespaces('en', enNamespaces);
