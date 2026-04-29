import { diffLines } from "diff";
import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";

export const readFileSchema = {
  name: "read_file",
  description:
    "Read a file's content for the given agent. If since_version is provided, " +
    "returns a JSON line-diff against that prior version instead of the full content. " +
    "If since_version has been pruned (only 10 versions retained), the full content " +
    "is returned with version_too_old: true.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      path: { type: "string", description: "The file path." },
      since_version: {
        type: "integer",
        description:
          "Optional. If provided, return a diff from this version to the current version.",
      },
    },
    required: ["agent_id", "path"],
  },
} as const;

interface ReadFileArgs {
  agent_id: string;
  path: string;
  since_version?: number;
}

type DiffChunk = { op: "add" | "remove" | "equal"; lines: string[] };

/** Convert the `diff` package's output to our JSON chunk format. */
function toChunks(oldContent: string, newContent: string): DiffChunk[] {
  const parts = diffLines(oldContent, newContent);
  return parts.map((part) => {
    // diffLines preserves trailing newlines on each chunk; split and drop
    // the final empty string that results from a trailing \n.
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    let op: DiffChunk["op"] = "equal";
    if (part.added) op = "add";
    else if (part.removed) op = "remove";
    return { op, lines };
  });
}

export function handleReadFile(args: ReadFileArgs):
  | {
      path: string;
      current_version: number;
      content: string;
      version_too_old?: boolean;
    }
  | {
      path: string;
      current_version: number;
      since_version: number;
      version_too_old: false;
      diff: DiffChunk[];
    } {
  validateAgentId(args.agent_id);
  validatePath(args.path);

  const db = getDb();

  const file = db
    .prepare("SELECT id, cur_version FROM files WHERE agent_id = ? AND path = ?")
    .get(args.agent_id, args.path) as
    | { id: number; cur_version: number }
    | undefined;

  if (!file) {
    throw new Error(`File not found: ${args.path}`);
  }

  const currentRow = db
    .prepare("SELECT content FROM file_versions WHERE file_id = ? AND version = ?")
    .get(file.id, file.cur_version) as { content: string } | undefined;

  if (!currentRow) {
    // Shouldn't happen in practice — defensive.
    throw new Error(`Internal error: current version content missing for ${args.path}.`);
  }

  // Full read path.
  if (args.since_version === undefined) {
    recordOperation(args.agent_id);
    return {
      path: args.path,
      current_version: file.cur_version,
      content: currentRow.content,
    };
  }

  if (!Number.isInteger(args.since_version) || args.since_version < 1) {
    throw new Error("Invalid since_version: must be a positive integer.");
  }
  if (args.since_version >= file.cur_version) {
    throw new Error(
      `Invalid since_version: ${args.since_version} is not older than current version ${file.cur_version}.`
    );
  }

  // Diff path: fetch the old version's content, if it still exists.
  const oldRow = db
    .prepare("SELECT content FROM file_versions WHERE file_id = ? AND version = ?")
    .get(file.id, args.since_version) as { content: string } | undefined;

  if (!oldRow) {
    // Pruned — fall back to full content.
    recordOperation(args.agent_id);
    return {
      path: args.path,
      current_version: file.cur_version,
      content: currentRow.content,
      version_too_old: true,
    };
  }

  recordOperation(args.agent_id);
  return {
    path: args.path,
    current_version: file.cur_version,
    since_version: args.since_version,
    version_too_old: false,
    diff: toChunks(oldRow.content, currentRow.content),
  };
}
