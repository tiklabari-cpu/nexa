import { mergeNamespaces, type Messages, type Namespace } from '../merge.js';
import { apps } from './apps.js';
import { auth } from './auth.js';
import { billing } from './billing.js';
import { common } from './common.js';
import { customers } from './customers.js';
import { home } from './home.js';
import { inbox } from './inbox.js';
import { playbook } from './playbook.js';
import { reports } from './reports.js';
import { settings } from './settings.js';
import { shell } from './shell.js';
import { team } from './team.js';

/** The English catalogue, one entry per namespace file. */
export const enNamespaces: Record<Namespace, Messages> = {
  apps,
  auth,
  billing,
  common,
  customers,
  home,
  inbox,
  playbook,
  reports,
  settings,
  shell,
  team,
};

/** The flat lookup table `t()` reads. Throws at import on a duplicate key. */
export const en: Messages = mergeNamespaces('en', enNamespaces);
