import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { SettingsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
      <Stack.Screen
        name="SettingsHome"
        component={SettingsHomeScreen}
        options={{ title: 'Settings' }}
      />
    </Stack.Navigator>
  );
}

function SettingsHomeScreen() {
  return (
    <PlaceholderScreen
      title="Settings"
      description="Bildirim tercihleri + cihaz kaydı 13.7-j'de gelir."
    />
  );
}
