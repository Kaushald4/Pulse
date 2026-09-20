#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
DERIVED="${ROOT}/native/macos/.build"
APP="${1:-${ROOT}/src-tauri/target/release/bundle/macos/Pulse.app}"

xcodebuild \
  -project "${ROOT}/native/macos/PulseWidget.xcodeproj" \
  -scheme PulseWidgetExtension \
  -sdk macosx \
  -derivedDataPath "${DERIVED}" \
  build CODE_SIGNING_ALLOWED=NO

mkdir -p "${APP}/Contents/PlugIns"
ditto \
  "${DERIVED}/Build/Products/Debug/PulseWidgetExtension.appex" \
  "${APP}/Contents/PlugIns/PulseWidgetExtension.appex"

codesign --force --deep --sign - --entitlements "${ROOT}/native/macos/PulseWidget/PulseWidget.entitlements" \
  "${APP}/Contents/PlugIns/PulseWidgetExtension.appex"
codesign --force --sign - --entitlements "${ROOT}/src-tauri/entitlements.plist" "${APP}"
codesign --verify --deep --strict "${APP}"

printf 'Embedded PulseWidgetExtension.appex in %s\n' "${APP}"
printf 'Sign the host app and extension together before distribution.\n'
