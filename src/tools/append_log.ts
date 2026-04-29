import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";
import { assertLogEntrySize, MAX_LOG_ENTRIES_PER_AGENT } from "../limits.js";

export const appendLogSchema = {
  name: "append_log",
  description:
    "Append a single entry to a log at the given path. Logs are append-only — " +
    "entries can never be modified or deleted individually. Efficient for " +
    "agent action histories, event streams, and audit trails.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      path: { type: "string", description: "The log path." },
      entry: { type: "string", description: "The text to append as one entry." },
    },
    required: ["agent_id", "path", "entry"],
  },
} as const;

interface AppendLogArgs {
  agent_id: string;
  path: string;
  entry: string;
}

export function handleAppendLog(args: AppendLogArgs): {
  path: string;
  entry_id: number;
  bytes_written: number;
} {
  validateAgentId(args.agent_id);
  validatePath(args.path);
  if (typeof args.entry !== "string") {
    throw new Error("Invalid entry: must be a string.");
  }
  assertLogEntrySize(args.entry);

  const db = getDb();
  const now = Date.now();

  // Multi-tenant quota: cap total log entries per agent.
  const existingCount = (
    db
      .prepare("SELECT COUNT(*) AS n FROM log_entries WHERE agent_id = ?")
      .get(args.agent_id) as { n: number }
  ).n;
  if (existingCount >= MAX_LOG_ENTRIES_PER_AGENT) {
    throw new Error(
      `Quota: agent has ${existingCount} log entries ` +
        `(max ${MAX_LOG_ENTRIES_PER_AGENT}).`
    );
  }

  const result = db
    .prepare(
      `INSERT INTO log_entries (agent_id, path, entry, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(args.agent_id, args.path, args.entry, now);

  recordOperation(args.agent_id);

  return {
    path: args.path,
    entry_id: Number(result.lastInsertRowid),
    bytes_written: Buffer.byteLength(args.entry, "utf8"),
  };
}
