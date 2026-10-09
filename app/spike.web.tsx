// The spike loads ONNX Runtime and native modules, which don't exist on web.
import { Text } from 'react-native';
import { Screen, ScreenHeader } from '../src/ui/components/primitives';
import { type } from '../src/ui/tokens';

export default function SpikeWeb() {
  return (
    <Screen>
      <ScreenHeader title="Phase 0 spike" />
      <Text style={type.body}>The on-device spike needs the iOS or Android dev build; it can't run in a browser.</Text>
    </Screen>
  );
}
