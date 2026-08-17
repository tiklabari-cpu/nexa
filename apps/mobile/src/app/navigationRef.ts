/**
 * A way to steer the navigator from outside React's tree.
 *
 * Screens navigate with the `navigation` prop and never need this. A tapped
 * notification is the case that does: it is delivered by a native module to a
 * module-level callback that has no component, no hooks and no context, and
 * frequently arrives before any of the three exist (a cold start, where the
 * response is what launched the process). `13.7-s` is the first caller.
 *
 * Kept beside `linking.ts` rather than inside the notification module because
 * it belongs to the shell: `RootNavigator` is what attaches it, and it is the
 * one place a second `NavigationContainer` — if this app ever grew one — would
 * have to be reconciled with.
 *
 * Typed over `LinkableParamList` — both trees — rather than over the tab tree
 * alone. Not a widening for its own sake: the ref and `linking` are handed to
 * the *same* `NavigationContainer`, so they fix the same type parameter, and
 * naming only the signed-in half here would make the signed-out linking map
 * (which names `SignIn`) unassignable. What actually navigates through this ref
 * is still only the tab tree — a tap that arrives while signed out is held, not
 * routed (`notifications/routing.ts`).
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { LinkableParamList } from './linking';

export const navigationRef = createNavigationContainerRef<LinkableParamList>();
