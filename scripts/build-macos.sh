#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP="${ROOT}/src-tauri/target/release/bundle/macos/Pulse.app"
ENTITLEMENTS="${ROOT}/src-tauri/entitlements.plist"
DMG="${ROOT}/src-tauri/target/release/bundle/dmg/Pulse_0.1.0_aarch64.dmg"
STAGE="$(mktemp -d)"

cleanup() {
  rm -rf "${STAGE}"
}
trap cleanup EXIT

# Build only the desktop app. The native widget source remains in the repo but
# is intentionally not embedded in this local GitHub DMG.
pnpm exec tauri build --bundles app

codesign --force --sign - --entitlements "${ENTITLEMENTS}" "${APP}"
codesign --verify --deep --strict "${APP}"

cp -R "${APP}" "${STAGE}/Pulse.app"
ln -s /Applications "${STAGE}/Applications"
mkdir -p "$(dirname "${DMG}")"
hdiutil create -volname Pulse -srcfolder "${STAGE}" -ov -format UDZO "${DMG}"

printf 'Built signed local app: %s\n' "${APP}"
printf 'Built DMG: %s\n' "${DMG}"
