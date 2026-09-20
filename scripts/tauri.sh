#!/bin/sh
set -eu

if [ "${1:-}" = "build" ] && [ "$(uname -s)" = "Darwin" ]; then
  exec sh "$(dirname "$0")/build-macos.sh" "$@"
fi

exec pnpm exec tauri "$@"
