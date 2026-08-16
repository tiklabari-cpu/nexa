import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { InboxStackParamList } from '../navigation';
import { buildStackScreenOptions } from '../navigationTheme';
import { ChatListScreen } from '../../features/inbox/ChatListScreen';
import { ChatScreen } from '../../features/inbox/ChatScreen';
import { InboxProvider } from '../../features/inbox/InboxProvider';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<InboxStackParamList>();

/**
 * The provider sits above the navigator, not inside a screen: the list and the
 * conversation are two views of one state, and a socket that reconnected every
 * time somebody tapped back would re-sync the whole inbox for nothing.
 */
export function InboxStack() {
  const { colors } = useTheme();
  return (
    <InboxProvider>
      <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
        <Stack.Screen name="InboxHome" component={InboxHomeScreen} options={{ title: 'Inbox' }} />
        <Stack.Screen
          name="ChatDetail"
          component={ChatDetailScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
      </Stack.Navigator>
    </InboxProvider>
  );
}

function InboxHomeScreen({ navigation }: NativeStackScreenProps<InboxStackParamList, 'InboxHome'>) {
  return <ChatListScreen onOpenChat={(chat) => navigation.navigate('ChatDetail', chat)} />;
}

function ChatDetailScreen({ route }: NativeStackScreenProps<InboxStackParamList, 'ChatDetail'>) {
  return <ChatScreen chatId={route.params.chatId} />;
}
