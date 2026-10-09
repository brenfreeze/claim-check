#!/usr/bin/env bash
# Phase 0: run the on-device protocol once per thread count, each in a fresh app process, and collect results.
#   scripts/run-device-protocol.sh [threads...]      (default: 1 2 4)
# Needs: the dev-client APK installed on a running emulator/phone (adb), and the model server:
#   python3 -m http.server 8765 --bind 127.0.0.1 --directory models/decima-small/onnx/int8
set -euo pipefail
cd "$(dirname "$0")/.."
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
PKG=com.claimcheck.app
OUT=results/device
mkdir -p "$OUT"
THREADS=("$@")
[ $# -eq 0 ] && THREADS=(1 2 4)

"$ADB" reverse tcp:8081 tcp:8081 >/dev/null
"$ADB" reverse tcp:8765 tcp:8765 >/dev/null

for t in "${THREADS[@]}"; do
  echo "== $t thread(s)"
  lsof -t -iTCP:8081 -sTCP:LISTEN | xargs kill 2>/dev/null || true  # Metro only: adb also holds 8081 sockets (adb reverse)
  EXPO_PUBLIC_AUTORUN=1 EXPO_PUBLIC_THREADS="$t" CI=1 npx expo start --dev-client --port 8081 --clear >"$OUT/metro-$t.log" 2>&1 &
  until curl -s localhost:8081/status | grep -q running; do sleep 1; done

  "$ADB" shell am force-stop "$PKG"
  "$ADB" logcat -c
  "$ADB" shell am start -a android.intent.action.VIEW \
    -d "exp+claim-check://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" "$PKG" >/dev/null

  # benchmark runs right after load: sample PSS from outside too (PRD SP-08 method), until autorun completes
  : >"$OUT/meminfo-$t.log"
  until "$ADB" logcat -d -s ReactNativeJS | grep -q "PHASE0_RESULT autorun"; do
    "$ADB" shell dumpsys meminfo "$PKG" 2>/dev/null | grep -E "TOTAL PSS|TOTAL RSS|TOTAL:" | head -2 >>"$OUT/meminfo-$t.log" || true
    sleep 2
  done
  "$ADB" logcat -d -s ReactNativeJS | grep "PHASE0_RESULT" | sed 's/.*PHASE0_RESULT //' >"$OUT/run-$t.log"
  echo "   $(grep -c . "$OUT/run-$t.log") result lines → $OUT/run-$t.log"
done
lsof -t -iTCP:8081 -sTCP:LISTEN | xargs kill 2>/dev/null || true  # Metro only: adb also holds 8081 sockets (adb reverse)
