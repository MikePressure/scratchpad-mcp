import { getDb, recordOperation } from "../db.js";
import { validateAgentId } from "../validate.js";

export const listFilesSchema = {
  name: "list_files",
  description:
    "List files stored for the given agent. Optionally filter by path prefix. " +
    "Returns metadata only (path, current version, size, timestamps) — not content. " +
    "Does not include logs (use a future list_logs tool for those).",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      prefix: {
        type: "string",
        description:
          "Optional. Only return files whose path starts with this prefix.",
      },
    },
    required: ["agent_id"],
  },
} as const;

interface ListFilesArgs {
  agent_id: string;
  prefix?: string;
}

interface FileRow {
  path: string;
  cur_version: number;
  bytes: number;
  created_at: number;
  updated_at: number;
}

export function handleListFiles(args: ListFilesArgs): {
  files: {
    path: string;
    current_version: number;
    bytes: number;
    created_at: number;
    updated_at: number;
  }[];
  count: number;
} {
  validateAgentId(args.agent_id);

  // Validate prefix lightly — we allow it to be empty/missing, but if present
  // it must follow the same character rules so it can't be used to inject SQL
  // wildcards or path traversal.
  const prefix = args.prefix ?? "";
  if (prefix.length > 0) {
    if (prefix.length > 255) {
      throw new Error("Invalid prefix: exceeds max length of 255 characters.");
    }
    if (!/^[a-zA-Z0-9/_.-]*$/.test(prefix)) {
      throw new Error(
        "Invalid prefix: only [a-zA-Z0-9/_.-] characters are allowed."
      );
    }
  }

  const db = getDb();

  // Use SUBSTR equality instead of LIKE: LIKE has wildcards (`%` and `_`) and
  // is case-insensitive for ASCII by default in SQLite, neither of which we
  // want for a prefix filter. SUBSTR(path, 1, LENGTH(prefix)) = prefix is
  // pure binary equality on the leading bytes — no wildcards, fully case
  // sensitive, no escaping needed.
  const rows = db
    .prepare(
      `SELECT
         f.path        AS path,
         f.cur_version AS cur_version,
         LENGTH(v.content) AS bytes,
         f.created_at  AS created_at,
         f.updated_at  AS updated_at
       FROM files f
       JOIN file_versions v ON v.file_id = f.id AND v.version = f.cur_version
       WHERE f.agent_id = ?
         AND SUBSTR(f.path, 1, LENGTH(?)) = ?
       ORDER BY f.path ASC`
    )
    .all(args.agent_id, prefix, prefix) as FileRow[];

  recordOperation(args.agent_id);

  return {
    files: rows.map((r) => ({
      path: r.path,
      current_version: r.cur_version,
      bytes: r.bytes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    count: rows.length,
  };
}
