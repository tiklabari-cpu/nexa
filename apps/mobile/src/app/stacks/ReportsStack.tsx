import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { ReportsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { ReportsScreen } from '../../features/reports/ReportsScreen';
import { ReportsProvider } from '../../features/reports/ReportsProvider';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<ReportsStackParamList>();

export function ReportsStack() {
  const { colors } = useTheme();
  return (
    <ReportsProvider>
      <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
        <Stack.Screen name="ReportsHome" component={ReportsScreen} options={{ title: 'Reports' }} />
      </Stack.Navigator>
    </ReportsProvider>
  );
}
