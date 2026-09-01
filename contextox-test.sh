#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node_is_supported() {
  "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' >/dev/null 2>&1
}

if [[ -n "${CONTEXT_OX_NODE:-}" ]]; then
  CONTEXT_OX_NODE_BIN="$CONTEXT_OX_NODE"
elif command -v node >/dev/null 2>&1 && node_is_supported node; then
  CONTEXT_OX_NODE_BIN="$(command -v node)"
else
  CONTEXT_OX_NODE_BIN=""
  MACHINE_ARCH="$(uname -m)"
  if [[ -n "${HOME:-}" ]]; then
    for candidate in "$HOME"/.local/share/node-v*-darwin-"$MACHINE_ARCH"/bin/node; do
      if [[ -x "$candidate" ]] && node_is_supported "$candidate"; then
        CONTEXT_OX_NODE_BIN="$candidate"
      fi
    done
  fi
fi

if [[ -z "$CONTEXT_OX_NODE_BIN" ]] || ! node_is_supported "$CONTEXT_OX_NODE_BIN"; then
  echo "ContextOx requires a working Node.js >=22.19 executable. Set CONTEXT_OX_NODE to its path." >&2
  exit 1
fi

exec env \
  PI_APP_NAME=ContextOx \
  PI_APP_TITLE=ContextOx \
  PI_SKIP_VERSION_CHECK=1 \
  "$CONTEXT_OX_NODE_BIN" \
  "$SCRIPT_DIR/node_modules/tsx/dist/cli.mjs" \
  --tsconfig "$SCRIPT_DIR/tsconfig.json" \
  "$SCRIPT_DIR/packages/contextox/src/cli.ts" \
  "$@"
