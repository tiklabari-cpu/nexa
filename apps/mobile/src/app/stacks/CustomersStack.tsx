import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { CustomersStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { CustomerListScreen } from '../../features/customers/CustomerListScreen';
import { CustomerDetailScreen } from '../../features/customers/CustomerDetailScreen';
import { CustomersProvider } from '../../features/customers/CustomersProvider';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export function CustomersStack() {
  const { colors } = useTheme();
  return (
    <CustomersProvider>
      <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
        <Stack.Screen
          name="CustomersHome"
          component={CustomersHomeScreen}
          options={{ title: 'Customers' }}
        />
        <Stack.Screen
          name="CustomerDetail"
          component={CustomerDetailScreenRoute}
          options={({ route }) => ({ title: route.params.title })}
        />
      </Stack.Navigator>
    </CustomersProvider>
  );
}

function CustomersHomeScreen({
  navigation,
}: NativeStackScreenProps<CustomersStackParamList, 'CustomersHome'>) {
  return (
    <CustomerListScreen
      onOpenCustomer={(customer) => navigation.navigate('CustomerDetail', customer)}
    />
  );
}

function CustomerDetailScreenRoute({
  route,
}: NativeStackScreenProps<CustomersStackParamList, 'CustomerDetail'>) {
  return <CustomerDetailScreen customerId={route.params.customerId} />;
}
