/**
 * The app shell, and the gate in front of it.
 *
 * Three states, one for each thing the session can be saying at this moment
 * (`13.7-p`). While `restore()` is still deciding, neither a password box nor
 * an inbox is true, so it shows neither. Signed out, the tab bar is not
 * rendered at all — this is React Navigation's own authentication-flow shape,
 * and it is what makes "signed out" unreachable-from rather than merely
 * hidden: there is no route in the other tree to go back to.
 *
 * Signed in it is what it always was: one bottom-tab navigator over the four
 * FR-MOD-13.7 surfaces (Inbox / Customers / Reports / Settings), each tab its
 * own stack so a detail screen can be pushed without touching this file.
 *
 * Before this, all four tabs mounted whatever the session said. A cold launch
 * with an empty store therefore opened the inbox, asked for `/chats` without a
 * token, and left the person reading a 401 with no way forward — the whole of
 * §D111's finding, in one missing branch.
 *
 * The container is also where `nexa://` URLs enter (13.7-q). Which map it is
 * given depends on the same three states, because a path only means something
 * against the tree that is mounted — see `app/linking.ts`.
 *
 * A tapped notification enters here too (13.7-s), but not through the same
 * door: it is held until this component is showing the tab tree and the
 * container says it is ready, then pushed through `navigationRef` — see
 * `notifications/routing.ts` for why a URL could not have waited.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useState } from 'react';

import { linkingFor } from './linking';
import type { RootTabParamList } from './navigation';
import { navigationRef } from './navigationRef';
import { buildNavigationTheme, buildTabScreenOptions } from './navigationTheme';
import { useSessionState } from './services';
import { CustomersStack } from './stacks/CustomersStack';
import { InboxStack } from './stacks/InboxStack';
import { ReportsStack } from './stacks/ReportsStack';
import { SettingsStack } from './stacks/SettingsStack';
import { AuthStack } from '../features/auth/AuthStack';
import { LoadingScreen } from '../features/auth/LoadingScreen';
import { useNotificationRouting } from '../notifications/routing';
import { useTheme } from '../theme/theme';

const Tab = createBottomTabNavigator<RootTabParamList>();

export function RootNavigator() {
  const { theme, colors } = useTheme();
  const { status } = useSessionState();
  const [navigatorReady, setNavigatorReady] = useState(false);

  // Above the `unknown` branch on purpose: a notification that launched the app
  // is delivered while the session is still being restored, and a hook mounted
  // only on the far side of that would be listening after the moment it exists
  // for. It holds what it hears until there is somewhere to put it.
  useNotificationRouting(status, navigatorReady);

  // Outside the container rather than inside it: there is no navigator to be
  // the child yet, and mounting one only to replace it a moment later would
  // make the first real navigator remount with it.
  if (status === 'unknown') return <LoadingScreen />;

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setNavigatorReady(true)}
      theme={buildNavigationTheme(theme, colors)}
      linking={linkingFor(status)}
      // Resolving the launch URL is a round trip through the platform, and the
      // container renders nothing until it settles. Without this the app blinks
      // to a blank screen between "restoring" and "restored" on every cold
      // start — the one window `LoadingScreen` exists to fill.
      fallback={<LoadingScreen />}
    >
      {status === 'signed-out' ? (
        <AuthStack />
      ) : (
        <Tab.Navigator screenOptions={buildTabScreenOptions(colors)}>
          <Tab.Screen name="Inbox" component={InboxStack} />
          <Tab.Screen name="Customers" component={CustomersStack} />
          <Tab.Screen name="Reports" component={ReportsStack} />
          <Tab.Screen name="Settings" component={SettingsStack} />
        </Tab.Navigator>
      )}
    </NavigationContainer>
  );
}
