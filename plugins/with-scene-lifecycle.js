// iOS 27 terminates apps built with its SDK unless they adopt the UIScene life cycle
// (UIKit traps in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption at launch).
// Expo SDK 57 ships the scene delegate (expo/ios/AppDelegates/ExpoAppSceneDelegate.swift) but its
// bare template doesn't use it yet. This plugin wires it in on every prebuild:
//   - Info.plist: a scene manifest whose delegate is EXExpoAppSceneDelegate
//   - AppDelegate.swift: conform to ExpoReactNativeFactoryProvider and let the scene delegate
//     create the window and start React Native
// Remove once the Expo template adopts scenes itself.
const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const WINDOW_START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n {4}factory\.startReactNative\(\n[\s\S]*?\n#endif\n/;

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return cfg;
  });

  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') throw new Error('with-scene-lifecycle: expected a Swift AppDelegate');
    let src = cfg.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg; // already applied
    if (!src.includes('class AppDelegate: ExpoAppDelegate {') || !WINDOW_START.test(src)) {
      throw new Error('with-scene-lifecycle: AppDelegate.swift does not match the expected Expo SDK 57 template');
    }
    src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    src = src.replace(WINDOW_START, '\n    // The window and React Native start in EXExpoAppSceneDelegate (scene life cycle, iOS 27).\n');
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = withSceneLifecycle;
