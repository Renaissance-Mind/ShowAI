#!/usr/bin/env sh
# Compatibility entry for previously configured local shell launchers.
# New installations invoke mcp/launch.mjs directly from the plugin directory.
set -eu
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$PLUGIN_DIR/mcp/launch.mjs"
