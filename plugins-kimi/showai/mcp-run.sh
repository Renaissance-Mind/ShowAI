#!/usr/bin/env sh
# Resolve Node through PATH. Kimi's Electron host rewrites a manifest command
# named "node" into its own native subcommand, which cannot launch this module.
set -eu
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$PLUGIN_DIR/mcp/launch.mjs"
