#!/usr/bin/env bash
# Wrapper for the intercom MCP server.
# Extracts CLAUDE_CODE_SESSION_ID from the parent claude process's command line
# (`--resume <uuid>`), since Claude Code does not expose it to MCP servers via
# env and does not expand ${VAR} in the MCP `env` config.
# $PPID here is the claude process that spawned this wrapper.

SID=$(ps -o command= -p "$PPID" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -n "$SID" ]; then
  export CLAUDE_CODE_SESSION_ID="$SID"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bun "$SCRIPT_DIR/src/server.ts"
