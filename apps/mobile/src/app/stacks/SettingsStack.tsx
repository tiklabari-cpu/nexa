import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { SettingsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { NotificationsScreen } from '../../features/notifications/NotificationsScreen';
import { NotificationsProvider } from '../../features/notifications/NotificationsProvider';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  const { colors } = useTheme();
  return (
    <NotificationsProvider>
      <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
        <Stack.Screen
          name="SettingsHome"
          component={NotificationsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NotificationsProvider>
  );
}
