#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP="${ROOT}/src-tauri/target/release/bundle/macos/Pulse.app"
ENTITLEMENTS="${ROOT}/src-tauri/entitlements.plist"

# Derived rather than hard-coded: a release must not ship a DMG named after the
# previous version. Tauri names bundles with the Rust target arch, which is not
# what uname reports - macOS says arm64, the triple says aarch64.
VERSION="$(node -p "require('${ROOT}/src-tauri/tauri.conf.json').version")"
if [ -z "${VERSION}" ]; then
  printf 'Could not read the version from tauri.conf.json\n' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="aarch64" ;;
  *) ARCH="$(uname -m)" ;;
esac

DMG="${ROOT}/src-tauri/target/release/bundle/dmg/Pulse_${VERSION}_${ARCH}.dmg"
STAGE="$(mktemp -d)"

cleanup() {
  rm -rf "${STAGE}"
}
trap cleanup EXIT

# The dispatcher invokes this as `build-macos.sh build ...`, so drop its marker
# and forward anything else (a release passes --config to turn on updater
# artifacts, which the repo config deliberately leaves off).
if [ "${1:-}" = "build" ]; then
  shift
fi

# Build only the desktop app. The native widget source remains in the repo but
# is intentionally not embedded in this local GitHub DMG.
pnpm exec tauri build --bundles app "$@"

codesign --force --sign - --entitlements "${ENTITLEMENTS}" "${APP}"
codesign --verify --deep --strict "${APP}"

cp -R "${APP}" "${STAGE}/Pulse.app"
ln -s /Applications "${STAGE}/Applications"
mkdir -p "$(dirname "${DMG}")"
hdiutil create -volname Pulse -srcfolder "${STAGE}" -ov -format UDZO "${DMG}"

printf 'Built signed local app: %s\n' "${APP}"
printf 'Built DMG: %s\n' "${DMG}"
