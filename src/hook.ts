import {
  findMyCodeSync,
  findCodeBySessionIdSync,
  peekMessagesSync,
  filterUnpresentedSync,
  markPresentedSync,
} from "./store.js";

// Read stdin: Claude Code passes hook input as JSON containing session_id and
// tool_name (among others). We parse it once and use both fields.
let input = "";
try {
  input = await Bun.stdin.text();
} catch {}

let stdinSessionId: string | null = null;
if (input) {
  try {
    const data = JSON.parse(input);
    // Skip if this hook fires on an intercom tool call itself (avoids dup)
    if (
      typeof data.tool_name === "string" &&
      data.tool_name.startsWith("mcp__intercom__")
    ) {
      process.exit(0);
    }
    if (typeof data.session_id === "string") stdinSessionId = data.session_id;
  } catch {}
}

// Prefer the session id from stdin (reliable). Only fall back to env/PID when
// stdin didn't carry one — and even then, never silently return another
// session's code.
let code: string | null = null;
if (stdinSessionId) {
  code = findCodeBySessionIdSync(stdinSessionId);
} else {
  code = findMyCodeSync();
}
if (!code) process.exit(0);

// Check inbox (skip messages already shown within the cooldown window)
const all = peekMessagesSync(code);
const messages = filterUnpresentedSync(code, all);
if (messages.length === 0) process.exit(0);

// Output messages — this gets injected into the agent's context
const lines = messages.map(
  (m) => `  [${m.id}] ${m.from}${m.reply_to ? " (reply)" : ""}: ${m.message}`,
);

console.log(
  `\n📬 INTERCOM [${code}] — ${messages.length} message(s) en attente:\n${lines.join("\n")}\n→ Utilise reply(message_id, message) pour répondre ou ack(message_id) pour accuser réception.\n`,
);

markPresentedSync(code, messages.map((m) => m.id));
process.exit(0);
