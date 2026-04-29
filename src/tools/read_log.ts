import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";

const PAGE_SIZE = 100;

export const readLogSchema = {
  name: "read_log",
  description:
    "Read entries from a log, paginated by id. Returns up to 100 entries per call. " +
    "If has_more is true, call again with since_entry set to the returned last_entry_id " +
    "to fetch the next page.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      path: { type: "string", description: "The log path." },
      since_entry: {
        type: "integer",
        description:
          "Optional. Return only entries with id > since_entry. Omit to read from the start.",
      },
    },
    required: ["agent_id", "path"],
  },
} as const;

interface ReadLogArgs {
  agent_id: string;
  path: string;
  since_entry?: number;
}

interface LogEntryRow {
  id: number;
  entry: string;
  created_at: number;
}

export function handleReadLog(args: ReadLogArgs): {
  entries: { entry: string; created_at: number }[];
  total: number;
  last_entry_id: number;
  has_more: boolean;
} {
  validateAgentId(args.agent_id);
  validatePath(args.path);

  const sinceEntry = args.since_entry ?? 0;
  if (!Number.isInteger(sinceEntry) || sinceEntry < 0) {
    throw new Error("Invalid since_entry: must be a non-negative integer.");
  }

  const db = getDb();

  // Fetch one extra row beyond the page size; if it comes back, we know
  // there's at least one more page.
  const rows = db
    .prepare(
      `SELECT id, entry, created_at FROM log_entries
       WHERE agent_id = ? AND path = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(args.agent_id, args.path, sinceEntry, PAGE_SIZE + 1) as LogEntryRow[];

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // total = total entries in this log matching the cursor (not just on this page).
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM log_entries
       WHERE agent_id = ? AND path = ? AND id > ?`
    )
    .get(args.agent_id, args.path, sinceEntry) as { n: number };

  recordOperation(args.agent_id);

  return {
    entries: page.map((r) => ({ entry: r.entry, created_at: r.created_at })),
    total: totalRow.n,
    last_entry_id: page.length > 0 ? page[page.length - 1].id : sinceEntry,
    has_more: hasMore,
  };
}
