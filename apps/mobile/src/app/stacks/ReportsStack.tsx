import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { ReportsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<ReportsStackParamList>();

export function ReportsStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
      <Stack.Screen
        name="ReportsHome"
        component={ReportsHomeScreen}
        options={{ title: 'Reports' }}
      />
    </Stack.Navigator>
  );
}

function ReportsHomeScreen() {
  return (
    <PlaceholderScreen title="Reports" description="Salt-okunur KPI kartları 13.7-h'de gelir." />
  );
}
