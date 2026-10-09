// onnxruntime-react-native ships a legacy unimodule.json and no react-native.config.js, so Expo autolinking sees an
// Expo-module/RN-module conflict and links neither on Android (NativeModules.Onnxruntime is null at runtime).
// Declaring its Android platform here makes it an explicit React Native dependency. iOS is left to the config
// plugin's Podfile entry.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': { platforms: { android: {} } },
  },
};
