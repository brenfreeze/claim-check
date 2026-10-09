Pod::Spec.new do |s|
  s.name           = 'AppleLlm'
  s.version        = '0.1.0'
  s.summary        = "Apple's on-device Foundation Model for the claim-check decision engine"
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # FoundationModels exists from iOS 26; weak-link so the app still launches on older iOS (availability() says no)
  s.weak_frameworks = 'FoundationModels'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
