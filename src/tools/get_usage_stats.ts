import { getDb, recordOperation } from "../db.js";
import { validateAgentId } from "../validate.js";

export const getUsageStatsSchema = {
  name: "get_usage_stats",
  description:
    "Return usage statistics for the given agent: total bytes stored, file count, " +
    "log entry count, and total operations performed. Useful for self-monitoring " +
    "and (later) per-call billing.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
    },
    required: ["agent_id"],
  },
} as const;

interface GetUsageStatsArgs {
  agent_id: string;
}

export function handleGetUsageStats(args: GetUsageStatsArgs): {
  agent_id: string;
  total_bytes: number;
  file_count: number;
  log_count: number;
  total_operations: number;
} {
  validateAgentId(args.agent_id);

  const db = getDb();

  // total_bytes: sum the byte length of every retained file_version + every log entry.
  // We use LENGTH() in SQL — for TEXT columns this returns the byte length when the
  // SQLite encoding is UTF-8 (which it is, by default).
  const fileBytesRow = db
    .prepare(
      `SELECT COALESCE(SUM(LENGTH(v.content)), 0) AS bytes
       FROM file_versions v
       JOIN files f ON f.id = v.file_id
       WHERE f.agent_id = ?`
    )
    .get(args.agent_id) as { bytes: number };

  const logBytesRow = db
    .prepare(
      `SELECT COALESCE(SUM(LENGTH(entry)), 0) AS bytes
       FROM log_entries
       WHERE agent_id = ?`
    )
    .get(args.agent_id) as { bytes: number };

  const fileCountRow = db
    .prepare("SELECT COUNT(*) AS n FROM files WHERE agent_id = ?")
    .get(args.agent_id) as { n: number };

  const logCountRow = db
    .prepare("SELECT COUNT(*) AS n FROM log_entries WHERE agent_id = ?")
    .get(args.agent_id) as { n: number };

  const opsRow = db
    .prepare("SELECT total_operations FROM agent_usage WHERE agent_id = ?")
    .get(args.agent_id) as { total_operations: number } | undefined;

  // We bump the counter for *this* call too, so the returned number reflects
  // it. Read first, then increment, then add 1 to the response — that way an
  // agent that polls get_usage_stats sees a monotonically rising count.
  const priorOps = opsRow?.total_operations ?? 0;
  recordOperation(args.agent_id);

  return {
    agent_id: args.agent_id,
    total_bytes: fileBytesRow.bytes + logBytesRow.bytes,
    file_count: fileCountRow.n,
    log_count: logCountRow.n,
    total_operations: priorOps + 1,
  };
}
