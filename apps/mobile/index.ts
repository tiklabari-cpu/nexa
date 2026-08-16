/**
 * Native entry point. `registerRootComponent` is Expo's `AppRegistry` wrapper —
 * it also sets up the development client, so the same entry works under
 * `expo start` and inside an exported bundle.
 */
import { registerRootComponent } from 'expo';

import App from './src/App';

registerRootComponent(App);
