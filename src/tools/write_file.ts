import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";
import { assertContentSize } from "../limits.js";

const MAX_VERSIONS_PER_FILE = 10;

export const writeFileSchema = {
  name: "write_file",
  description:
    "Store content at a path for the given agent. Auto-versions on every write. " +
    "Only the 10 most recent versions per file are retained.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: {
        type: "string",
        description: "The agent's namespace identifier.",
      },
      path: {
        type: "string",
        description:
          "The file path. Allowed chars: [a-zA-Z0-9/_.-]. No leading '/' or '..' sequences.",
      },
      content: {
        type: "string",
        description: "The full content to store at this path.",
      },
    },
    required: ["agent_id", "path", "content"],
  },
} as const;

interface WriteFileArgs {
  agent_id: string;
  path: string;
  content: string;
}

export function handleWriteFile(args: WriteFileArgs): {
  path: string;
  version: number;
  bytes_written: number;
} {
  validateAgentId(args.agent_id);
  validatePath(args.path);
  if (typeof args.content !== "string") {
    throw new Error("Invalid content: must be a string.");
  }
  assertContentSize(args.content);

  const db = getDb();
  const now = Date.now();

  // Run the whole write-and-prune as a single transaction so partial
  // failures can't leave the file table out of sync with file_versions.
  const result = db.transaction(() => {
    // Upsert the files row and get its id + new version number.
    const existing = db
      .prepare(
        "SELECT id, cur_version FROM files WHERE agent_id = ? AND path = ?"
      )
      .get(args.agent_id, args.path) as
      | { id: number; cur_version: number }
      | undefined;

    let fileId: number;
    let newVersion: number;

    if (existing) {
      fileId = existing.id;
      newVersion = existing.cur_version + 1;
      db.prepare(
        "UPDATE files SET cur_version = ?, updated_at = ? WHERE id = ?"
      ).run(newVersion, now, fileId);
    } else {
      newVersion = 1;
      const insert = db
        .prepare(
          `INSERT INTO files (agent_id, path, cur_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(args.agent_id, args.path, newVersion, now, now);
      fileId = Number(insert.lastInsertRowid);
    }

    db.prepare(
      `INSERT INTO file_versions (file_id, version, content, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(fileId, newVersion, args.content, now);

    // Prune: keep only versions where version > (newVersion - MAX_VERSIONS_PER_FILE).
    db.prepare(
      "DELETE FROM file_versions WHERE file_id = ? AND version <= ?"
    ).run(fileId, newVersion - MAX_VERSIONS_PER_FILE);

    return { version: newVersion };
  })();

  recordOperation(args.agent_id);

  return {
    path: args.path,
    version: result.version,
    bytes_written: Buffer.byteLength(args.content, "utf8"),
  };
}
