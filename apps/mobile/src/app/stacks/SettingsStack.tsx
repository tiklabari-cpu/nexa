import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SettingsStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { NotificationsScreen } from '../../features/notifications/NotificationsScreen';
import { NotificationsProvider } from '../../features/notifications/NotificationsProvider';
import { TeamListScreen } from '../../features/team/TeamListScreen';
import { TeamMemberScreen } from '../../features/team/TeamMemberScreen';
import { GroupListScreen } from '../../features/team/GroupListScreen';
import { TeamProvider } from '../../features/team/TeamProvider';
import { SkillListScreen } from '../../features/playbook/SkillListScreen';
import { SkillDetailScreen } from '../../features/playbook/SkillDetailScreen';
import { KnowledgeSourceListScreen } from '../../features/playbook/KnowledgeSourceListScreen';
import { PlaybookProvider } from '../../features/playbook/PlaybookProvider';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/**
 * `TeamProvider` and `PlaybookProvider` sit above the navigator, alongside
 * `NotificationsProvider` — the Team roster (13.7-m) and the Playbook/AI
 * administration parity module (13.7-n) are both reached from this tab's
 * header rather than a root tab of their own, the same "SettingsStack altına
 * bağlamak" choice `13.7-m` made to keep the four-tab shell `13.7-e` decided.
 */
export function SettingsStack() {
  const { colors } = useTheme();
  return (
    <NotificationsProvider>
      <TeamProvider>
        <PlaybookProvider>
          <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
            <Stack.Screen
              name="SettingsHome"
              component={NotificationsScreen}
              options={({ navigation }) => ({
                title: 'Settings',
                headerRight: () => (
                  <HeaderLinks>
                    <HeaderLink
                      testID="settings-open-team"
                      label="Team"
                      onPress={() => navigation.navigate('TeamList')}
                    />
                    <HeaderLink
                      testID="settings-open-playbook"
                      label="Playbook"
                      onPress={() => navigation.navigate('SkillList')}
                    />
                  </HeaderLinks>
                ),
              })}
            />
            <Stack.Screen
              name="TeamList"
              component={TeamListScreenRoute}
              options={({ navigation }) => ({
                title: 'Team',
                headerRight: () => (
                  <HeaderLink
                    testID="team-open-groups"
                    label="Groups"
                    onPress={() => navigation.navigate('TeamGroups')}
                  />
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
            <Stack.Screen
              name="SkillList"
              component={SkillListScreenRoute}
              options={({ navigation }) => ({
                title: 'Playbook',
                headerRight: () => (
                  <HeaderLink
                    testID="skills-open-knowledge"
                    label="Knowledge"
                    onPress={() => navigation.navigate('KnowledgeSources')}
                  />
                ),
              })}
            />
            <Stack.Screen
              name="SkillDetail"
              component={SkillDetailScreenRoute}
              options={({ route }) => ({ title: route.params.title })}
            />
            <Stack.Screen
              name="KnowledgeSources"
              component={KnowledgeSourceListScreen}
              options={{ title: 'Knowledge' }}
            />
          </Stack.Navigator>
        </PlaybookProvider>
      </TeamProvider>
    </NotificationsProvider>
  );
}

/** The row a header carries more than one link in — `SettingsHome` is the
 * only screen that needs it (Team + Playbook); every other header here has
 * exactly one. */
function HeaderLinks({ children }: PropsWithChildren) {
  return <View style={{ flexDirection: 'row', alignItems: 'center' }}>{children}</View>;
}

function HeaderLink({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={{ paddingHorizontal: SPACING[2] }}
    >
      <Text style={{ color: colors.brandText, fontSize: FONT_SIZE.sm.size, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
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

function SkillListScreenRoute({
  navigation,
}: NativeStackScreenProps<SettingsStackParamList, 'SkillList'>) {
  return <SkillListScreen onOpenSkill={(skill) => navigation.navigate('SkillDetail', skill)} />;
}

function SkillDetailScreenRoute({
  route,
}: NativeStackScreenProps<SettingsStackParamList, 'SkillDetail'>) {
  return <SkillDetailScreen skillId={route.params.skillId} />;
}
