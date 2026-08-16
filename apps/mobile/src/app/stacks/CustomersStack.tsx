import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { CustomersStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export function CustomersStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
      <Stack.Screen
        name="CustomersHome"
        component={CustomersHomeScreen}
        options={{ title: 'Customers' }}
      />
    </Stack.Navigator>
  );
}

function CustomersHomeScreen() {
  return (
    <PlaceholderScreen title="Customers" description="Liste ve kişi detayı 13.7-g'de gelir." />
  );
}
