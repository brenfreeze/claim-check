import { Text } from 'react-native';
import { color, font, type } from '../tokens';
import { Button, goHome, Screen, ScreenHeader } from './primitives';

/** Unknown check or claim id (e.g. after a reload: history is in memory only). */
export function NotFound() {
  return (
    <Screen>
      <ScreenHeader title="Check not found" />
      <Text style={[type.body, { color: color.inkSecondary, fontFamily: font.body }]}>
        This check is no longer available. Checks are kept only while the app is open.
      </Text>
      <Button label="Back to Home" variant="primary" onPress={goHome} />
    </Screen>
  );
}
