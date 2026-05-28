# claude-intercom (VS Code multi-session fork)

> **A fork of [sanztheo/claude-intercom](https://github.com/sanztheo/claude-intercom)** — all architecture and design credit goes to the original author. This fork adds three patches needed to make it work cleanly when multiple Claude Code sessions live under the same VS Code window. If you use Claude Code in the terminal only, prefer the original.

Real-time messaging between Claude Code instances. When one agent sends a message, the others get it instantly — no polling, no manual checks. MCP server + filesystem watcher that wakes idle agents automatically via `asyncRewake`.

---

## Why this fork

The upstream works perfectly when each Claude Code session is its own terminal process. In VS Code, **every Claude tab is a child of the same Extension Host process** (`Visual Studio Code Helper (Plugin)`), which breaks three assumptions in the upstream:

1. **Session identity collides.** Upstream maps "which agent code belongs to this session?" via the parent-PID chain. Under VS Code, all sessions share parents, so `sessions/{pid}.code` files overwrite each other and the hook for session A reads session B's code.
2. **The agent code is random and unstable.** Upstream uses `randomBytes(4)`, so every time the MCP server reloads mid-session (which happens more than you'd think in VS Code), the visible 4-char code changes. We observed chains like `g5vy → rzht → fp47 → vnvq` for a single session in one Claude run.
3. **Push wakeups time out after 5 minutes.** The watcher's safety timeout is hardcoded at `300_000`, which is too short for sessions that sit idle for tens of minutes between messages.

This fork fixes all three, while keeping the upstream API and tool surface unchanged.

---

## What changed

### 1. Session linking by `CLAUDE_CODE_SESSION_ID`, not PID ancestry (`src/store.ts`)
Replaced the PID-based `sessions/{pid}.code` map with `sessions/sid-{CLAUDE_CODE_SESSION_ID}.code`. The session id is a stable per-session UUID that the MCP server and its hooks share — so they can find each other reliably, even under shared parents. Falls back to the upstream PID-ancestry logic when `CLAUDE_CODE_SESSION_ID` is unavailable (older terminal setups).

### 2. Deterministic agent code (`src/store.ts` → `generateCode`)
`generateCode = sha256(CLAUDE_CODE_SESSION_ID)[:4]`. Same session → same 4-char code, every time, across MCP server reloads. Falls back to `randomBytes` when no session id is set.

### 3. Watcher timeout raised to 30 min (`src/watcher.ts`)
`setTimeout(..., 1_800_000)` instead of `300_000`. A Bun process running idle for 30 min is cheap; the trade-off is the right call.

### 4. New: `wrapper.sh`
Claude Code does NOT pass `CLAUDE_CODE_SESSION_ID` into the env of MCP servers, and does NOT expand `${VAR}` in the MCP `env` config. To get the session id into the server's env, we use a small wrapper that recovers it from the parent claude process's command line (where it appears as `--resume <uuid>`) and exports it before `exec bun src/server.ts`. This is the only way to make fix #1 actually work without modifying Claude Code itself.

---

## Installation

You need [Bun](https://bun.sh) (`brew install oven-sh/bun/bun` on macOS).

```bash
# Clone (adjust the path if you want — the wrapper uses a path relative to itself)
git clone https://github.com/yaliaro/claude-intercom-vscode.git ~/.claude/mcp-intercom
cd ~/.claude/mcp-intercom
bun install
```

Register the MCP server in `~/.claude.json` under `mcpServers`. Note that `command` is `bash` + the wrapper — NOT `bun` directly:

```json
"intercom": {
  "type": "stdio",
  "command": "bash",
  "args": ["/absolute/path/to/.claude/mcp-intercom/wrapper.sh"]
}
```

Register the hooks in `~/.claude/settings.json` under `hooks`:

```json
{
  "PreToolUse": [{
    "hooks": [{
      "type": "command",
      "command": "bun /absolute/path/to/.claude/mcp-intercom/src/hook.ts",
      "timeout": 3000
    }]
  }],
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "bun /absolute/path/to/.claude/mcp-intercom/src/watcher.ts",
      "asyncRewake": true,
      "timeout": 1800000
    }]
  }],
  "SessionStart": [{
    "hooks": [{
      "type": "command",
      "command": "bun /absolute/path/to/.claude/mcp-intercom/src/watcher.ts",
      "asyncRewake": true,
      "timeout": 1800000
    }]
  }]
}
```

Restart **all** Claude Code sessions. MCP servers and hooks load only at startup.

---

## Usage

Same tools as upstream — talk to Claude naturally inside any session:

| You say (any phrasing) | Tool that runs |
|---|---|
| "Who else is connected?" | `who` |
| "Send to q0xm: ..." / "Broadcast to all: ..." | `send` |
| "Any messages?" | `peek` |
| "Reply: ..." | `reply` |
| "Mark read" | `ack` / `ack_all` |

Push messages appear inside the conversation as `📬 INTERCOM [your-code] — N message(s): ...` — no polling needed.

---

## Verifying it works

```bash
# Confirm MCP servers got a session id (the entire point of this fork)
for pid in $(pgrep -f 'mcp-intercom/src/server.ts'); do
  uuid=$(ps eww -p "$pid" 2>/dev/null | grep -oE 'CLAUDE_CODE_SESSION_ID=[0-9a-f-]+' | sed 's/.*=//')
  echo "server pid=$pid -> ${uuid:-NO_UUID}"
done

# What 4-char code SHOULD this session have?
bun -e '
  const { generateCode } = await import("./src/store.ts");
  console.log(generateCode());
'
```

If the first command shows `NO_UUID` for some servers, those are transient processes that exited on their own; the ones that matter will have a UUID. If the second command prints a different code than what `who` shows you in your session, something is wrong — open an issue.

---

## Diffs at a glance

- `src/store.ts` — `generateCode` (now deterministic), `registerSessionSync` / `findMyCodeSync` / `unregisterSessionSync` (session-id-keyed with PID fallback).
- `src/watcher.ts` — one constant: `300_000` → `1_800_000`.
- `wrapper.sh` — new file.
- `README.md` — this file.
- Everything else (`src/server.ts`, `src/hook.ts`, `skill/`, the MCP tool surface) is unchanged from upstream.

---

## Credit & relationship to upstream

- **Original author:** [@sanztheo](https://github.com/sanztheo)
- **Original repo:** https://github.com/sanztheo/claude-intercom
- **License:** MIT (inherited unchanged)

A pull request with these three fixes is opened against upstream. If it gets merged, this fork becomes obsolete and you should switch back to the original.

---

## License

MIT (same as upstream).
