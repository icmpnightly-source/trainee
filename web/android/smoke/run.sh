#!/usr/bin/env bash
# Smoke test of the Android app on a running emulator (used by CI):
# installs the APK, starts the NormativAI server on this machine (the emulator
# reaches it as 10.0.2.2) and drives the app with smoke.mjs.
#   bash web/android/smoke/run.sh path/to/app.apk out-dir
set -euo pipefail
APK="$1"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG=uz.normativai.app

(cd "$ROOT/server" && DATA_DIR="$OUT/server-data" nohup node --no-warnings=ExperimentalWarning src/index.mjs > "$OUT/server.log" 2>&1 &)
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8080/api/health > /dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8080/api/health

adb install -r "$APK"
for p in CAMERA ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$p" || true
done
adb shell dumpsys package "$PKG" | grep -E "versionName|granted=true" | head -20
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT=$!

status=0
OUT="$OUT" node "$ROOT/web/android/smoke/smoke.mjs" || status=$?
kill "$LOGCAT" || true
grep -E "Capacitor|chromium|AndroidRuntime|FATAL" "$OUT/logcat.txt" | grep -vE "Capacitor/Console" | tail -40 || true
exit $status
