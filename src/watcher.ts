import { watch } from "node:fs";
import { join } from "node:path";
import {
  findMyCodeSync,
  findCodeBySessionIdSync,
  peekMessagesSync,
  filterUnpresentedSync,
  markPresentedSync,
} from "./store.js";

const HOME = process.env.HOME ?? "~";
const MESSAGES_DIR = join(HOME, ".claude", "mcp-intercom", "store", "messages");

// Claude Code passes hook input as JSON on stdin: { session_id, transcript_path,
// cwd, hook_event_name, ... }. session_id from stdin is the ONLY reliable way
// to identify *this* session — env vars are not propagated to hooks and PID
// ancestry collides under VS Code's shared Extension Host.
let stdinSessionId: string | null = null;
try {
  const input = await Bun.stdin.text();
  if (input) {
    const data = JSON.parse(input);
    if (typeof data.session_id === "string") stdinSessionId = data.session_id;
  }
} catch {}

let code: string | null = null;
if (stdinSessionId) {
  // Trust stdin: only look up THIS session's code. Do NOT fall back to
  // PID-ancestry — under shared parents that would return another session's
  // code and we'd flood the wrong inbox.
  for (let attempt = 0; attempt < 5; attempt++) {
    code = findCodeBySessionIdSync(stdinSessionId);
    if (code) break;
    await Bun.sleep(500);
  }
} else {
  // No stdin session id (older Claude Code or unusual invocation) — fall back
  // to the env / PID-ancestry path.
  for (let attempt = 0; attempt < 5; attempt++) {
    code = findMyCodeSync();
    if (code) break;
    await Bun.sleep(500);
  }
}
if (!code) process.exit(0);

const inbox = join(MESSAGES_DIR, code);

function checkAndNotify(): boolean {
  const all = peekMessagesSync(code!);
  const messages = filterUnpresentedSync(code!, all);
  if (messages.length === 0) return false;
  const lines = messages.map(
    (m) => `  [${m.id}] ${m.from}${m.reply_to ? " (reply)" : ""}: ${m.message}`,
  );
  console.log(
    `\n📬 INTERCOM [${code}] — ${messages.length} message(s):\n${lines.join("\n")}\n→ Utilise mcp__intercom__reply(message_id, message) pour répondre ou mcp__intercom__ack(message_id) pour accuser réception.\n`,
  );
  markPresentedSync(code!, messages.map((m) => m.id));
  return true;
}

// Check immediately in case messages already exist
if (checkAndNotify()) process.exit(2);

// Watch inbox directory for new files — instant detection
try {
  const watcher = watch(inbox, (_event, filename) => {
    if (filename?.endsWith(".json")) {
      if (checkAndNotify()) {
        watcher.close();
        process.exit(2);
      }
    }
  });

  // Safety timeout: 30 minutes max
  setTimeout(() => {
    watcher.close();
    process.exit(0);
  }, 1_800_000);
} catch {
  // Inbox dir doesn't exist yet — fall back to polling
  for (let i = 0; i < 150; i++) {
    if (checkAndNotify()) process.exit(2);
    await Bun.sleep(2000);
  }
  process.exit(0);
}
