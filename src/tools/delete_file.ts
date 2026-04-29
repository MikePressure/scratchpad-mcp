import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";

export const deleteFileSchema = {
  name: "delete_file",
  description:
    "Delete a file and all of its retained versions and any cached summary. " +
    "Does not delete log entries at the same path.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      path: { type: "string", description: "The file path to delete." },
    },
    required: ["agent_id", "path"],
  },
} as const;

interface DeleteFileArgs {
  agent_id: string;
  path: string;
}

export function handleDeleteFile(args: DeleteFileArgs): {
  path: string;
  deleted: boolean;
  versions_removed: number;
} {
  validateAgentId(args.agent_id);
  validatePath(args.path);

  const db = getDb();

  // Look up the file id first so we can count versions before CASCADE wipes them.
  const file = db
    .prepare("SELECT id FROM files WHERE agent_id = ? AND path = ?")
    .get(args.agent_id, args.path) as { id: number } | undefined;

  if (!file) {
    return { path: args.path, deleted: false, versions_removed: 0 };
  }

  const countRow = db
    .prepare("SELECT COUNT(*) AS n FROM file_versions WHERE file_id = ?")
    .get(file.id) as { n: number };

  // CASCADE on the foreign key removes file_versions and summaries automatically.
  db.prepare("DELETE FROM files WHERE id = ?").run(file.id);

  recordOperation(args.agent_id);

  return {
    path: args.path,
    deleted: true,
    versions_removed: countRow.n,
  };
}
