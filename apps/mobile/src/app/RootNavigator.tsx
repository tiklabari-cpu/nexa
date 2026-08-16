/**
 * The app shell: one bottom-tab navigator over the four FR-MOD-13.7 surfaces
 * (Inbox / Customers / Reports / Settings), each tab its own stack so `13.7-f`
 * onward can push detail screens without touching this file.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import type { RootTabParamList } from './navigation';
import { buildNavigationTheme, buildTabScreenOptions } from './navigationTheme';
import { CustomersStack } from './stacks/CustomersStack';
import { InboxStack } from './stacks/InboxStack';
import { ReportsStack } from './stacks/ReportsStack';
import { SettingsStack } from './stacks/SettingsStack';
import { useTheme } from '../theme/theme';

const Tab = createBottomTabNavigator<RootTabParamList>();

export function RootNavigator() {
  const { theme, colors } = useTheme();

  return (
    <NavigationContainer theme={buildNavigationTheme(theme, colors)}>
      <Tab.Navigator screenOptions={buildTabScreenOptions(colors)}>
        <Tab.Screen name="Inbox" component={InboxStack} />
        <Tab.Screen name="Customers" component={CustomersStack} />
        <Tab.Screen name="Reports" component={ReportsStack} />
        <Tab.Screen name="Settings" component={SettingsStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
