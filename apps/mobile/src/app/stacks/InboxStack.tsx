import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';

import type { InboxStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { ChatListScreen } from '../../features/inbox/ChatListScreen';
import { ChatScreen } from '../../features/inbox/ChatScreen';
import { InboxProvider } from '../../features/inbox/InboxProvider';
import { CopilotProvider } from '../../features/copilot/CopilotProvider';
import { CopilotScreen } from '../../features/copilot/CopilotScreen';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<InboxStackParamList>();

/**
 * The providers sit above the navigator, not inside a screen: the list and the
 * conversation are two views of one state, and a socket that reconnected every
 * time somebody tapped back would re-sync the whole inbox for nothing.
 * `CopilotProvider` is mounted alongside `InboxProvider` for the same reason —
 * Copilot (13.7-i) is only reachable from a chat already open here.
 */
export function InboxStack() {
  const { colors } = useTheme();
  return (
    <InboxProvider>
      <CopilotProvider>
        <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
          <Stack.Screen name="InboxHome" component={InboxHomeScreen} options={{ title: 'Inbox' }} />
          <Stack.Screen
            name="ChatDetail"
            component={ChatDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.title,
              headerRight: () => (
                <Pressable
                  accessibilityRole="button"
                  testID="chat-open-copilot"
                  onPress={() =>
                    navigation.navigate('ChatCopilot', {
                      chatId: route.params.chatId,
                      title: 'Copilot',
                    })
                  }
                  style={{ paddingHorizontal: SPACING[2] }}
                >
                  <Text
                    style={{
                      color: colors.brandText,
                      fontSize: FONT_SIZE.sm.size,
                      fontWeight: '600',
                    }}
                  >
                    Copilot
                  </Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="ChatCopilot"
            component={ChatCopilotScreen}
            options={({ route }) => ({ title: route.params.title })}
          />
        </Stack.Navigator>
      </CopilotProvider>
    </InboxProvider>
  );
}

function InboxHomeScreen({ navigation }: NativeStackScreenProps<InboxStackParamList, 'InboxHome'>) {
  return <ChatListScreen onOpenChat={(chat) => navigation.navigate('ChatDetail', chat)} />;
}

function ChatDetailScreen({ route }: NativeStackScreenProps<InboxStackParamList, 'ChatDetail'>) {
  return <ChatScreen chatId={route.params.chatId} />;
}

function ChatCopilotScreen({
  navigation,
  route,
}: NativeStackScreenProps<InboxStackParamList, 'ChatCopilot'>) {
  return <CopilotScreen chatId={route.params.chatId} onInserted={() => navigation.goBack()} />;
}
