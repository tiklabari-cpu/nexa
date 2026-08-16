import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { InboxStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<InboxStackParamList>();

export function InboxStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
      <Stack.Screen name="InboxHome" component={InboxHomeScreen} options={{ title: 'Inbox' }} />
    </Stack.Navigator>
  );
}

function InboxHomeScreen() {
  return (
    <PlaceholderScreen
      title="Inbox"
      description="Sohbet listesi, transkript ve composer 13.7-f'te gelir."
    />
  );
}
