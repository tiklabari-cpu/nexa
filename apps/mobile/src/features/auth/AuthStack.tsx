/**
 * The way in, as its own stack.
 *
 * Mounted by `RootNavigator` in place of the tab bar while the session is
 * signed out (the React Navigation "authentication flow" shape): the two trees
 * never coexist, so there is no back gesture from the inbox to a login form and
 * no route in the tab navigator that a signed-out person can reach.
 *
 * It owns one piece of state, and owning it is the point. The email and
 * password that `/auth/login` accepted have to survive the hop from the form to
 * the picker, and a route param is the wrong place for them — navigation state
 * is serialised, persisted and — since `13.7-q` — addressable as a URL.
 * Component state is none of those things, and it dies with the flow.
 */
import { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SignInScreen } from './SignInScreen';
import { WorkspacePickerScreen } from './WorkspacePickerScreen';
import type { PendingSignIn } from './types';
import type { AuthStackParamList } from '../../app/navigation';
import { buildStackScreenOptions } from '../../app/navigationTheme';
import { useServices } from '../../app/services';
import { useTheme } from '../../theme/theme';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  const { colors } = useTheme();
  const { session } = useServices();
  const [pending, setPending] = useState<PendingSignIn | null>(null);

  return (
    <Stack.Navigator screenOptions={buildStackScreenOptions(colors)}>
      <Stack.Screen name="SignIn" options={{ headerShown: false }}>
        {({ navigation, route }) => (
          <SignInScreen
            session={session}
            // Set by `app/linking.ts` when a `nexa://auth/callback` landed here
            // with no sign-in left to finish. A boolean is the whole param —
            // the code that came with the URL is dropped, not stored.
            returned={route.params?.returned === true}
            onChooseWorkspace={(next) => {
              setPending(next);
              navigation.navigate('WorkspacePicker');
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="WorkspacePicker" options={{ title: 'Choose a workspace' }}>
        {({ navigation }) => (
          <WorkspacePickerScreen
            session={session}
            pending={pending}
            onStartOver={() => {
              setPending(null);
              navigation.navigate('SignIn');
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
