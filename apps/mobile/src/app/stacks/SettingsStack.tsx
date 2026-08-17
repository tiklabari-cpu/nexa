import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';

import type { SettingsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { NotificationsScreen } from '../../features/notifications/NotificationsScreen';
import { NotificationsProvider } from '../../features/notifications/NotificationsProvider';
import { TeamListScreen } from '../../features/team/TeamListScreen';
import { TeamMemberScreen } from '../../features/team/TeamMemberScreen';
import { GroupListScreen } from '../../features/team/GroupListScreen';
import { TeamProvider } from '../../features/team/TeamProvider';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/**
 * `TeamProvider` sits above the navigator, alongside `NotificationsProvider` —
 * the Team roster (13.7-m) is reached from this tab's header rather than a
 * root tab of its own, the same "SettingsStack altına bağlamak" choice the
 * subtask left open, made to keep the four-tab shell `13.7-e` decided.
 */
export function SettingsStack() {
  const { colors } = useTheme();
  return (
    <NotificationsProvider>
      <TeamProvider>
        <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
          <Stack.Screen
            name="SettingsHome"
            component={NotificationsScreen}
            options={({ navigation }) => ({
              title: 'Settings',
              headerRight: () => (
                <Pressable
                  accessibilityRole="button"
                  testID="settings-open-team"
                  onPress={() => navigation.navigate('TeamList')}
                  style={{ paddingHorizontal: SPACING[2] }}
                >
                  <Text
                    style={{
                      color: colors.brandText,
                      fontSize: FONT_SIZE.sm.size,
                      fontWeight: '600',
                    }}
                  >
                    Team
                  </Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="TeamList"
            component={TeamListScreenRoute}
            options={({ navigation }) => ({
              title: 'Team',
              headerRight: () => (
                <Pressable
                  accessibilityRole="button"
                  testID="team-open-groups"
                  onPress={() => navigation.navigate('TeamGroups')}
                  style={{ paddingHorizontal: SPACING[2] }}
                >
                  <Text
                    style={{
                      color: colors.brandText,
                      fontSize: FONT_SIZE.sm.size,
                      fontWeight: '600',
                    }}
                  >
                    Groups
                  </Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="TeamMember"
            component={TeamMemberScreenRoute}
            options={({ route }) => ({ title: route.params.title })}
          />
          <Stack.Screen
            name="TeamGroups"
            component={GroupListScreen}
            options={{ title: 'Groups' }}
          />
        </Stack.Navigator>
      </TeamProvider>
    </NotificationsProvider>
  );
}

function TeamListScreenRoute({
  navigation,
}: NativeStackScreenProps<SettingsStackParamList, 'TeamList'>) {
  return (
    <TeamListScreen
      onOpenAgent={(agent) => navigation.navigate('TeamMember', { agent, title: agent.name })}
    />
  );
}

function TeamMemberScreenRoute({
  route,
}: NativeStackScreenProps<SettingsStackParamList, 'TeamMember'>) {
  return <TeamMemberScreen agent={route.params.agent} />;
}
