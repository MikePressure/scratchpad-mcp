import Anthropic from "@anthropic-ai/sdk";
import { getDb, recordOperation } from "../db.js";
import { validatePath, validateAgentId } from "../validate.js";

const SUMMARIZE_THRESHOLD_CHARS = 8000; // ~2000 tokens at 4 chars/token.
const SUMMARY_MODEL = "claude-haiku-4-5";
const SUMMARY_MAX_TOKENS = 1024;

export const summarizeFileSchema = {
  name: "summarize_file",
  description:
    "Return an LLM-generated summary of a long file (>2000 estimated tokens). " +
    "Files at or below the threshold are not summarized — use read_file instead. " +
    "Summaries are cached per file version, so repeat calls on an unchanged file " +
    "are free.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's namespace identifier." },
      path: { type: "string", description: "The file path to summarize." },
    },
    required: ["agent_id", "path"],
  },
} as const;

interface SummarizeFileArgs {
  agent_id: string;
  path: string;
}

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to the MCP server's env config."
    );
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

export async function handleSummarizeFile(args: SummarizeFileArgs): Promise<{
  path: string;
  current_version: number;
  summary: string;
  cached: boolean;
  estimated_tokens: number;
}> {
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

  const contentRow = db
    .prepare("SELECT content FROM file_versions WHERE file_id = ? AND version = ?")
    .get(file.id, file.cur_version) as { content: string } | undefined;

  if (!contentRow) {
    throw new Error(`Internal error: current version content missing for ${args.path}.`);
  }

  const chars = contentRow.content.length;
  const estimatedTokens = Math.ceil(chars / 4);

  if (chars <= SUMMARIZE_THRESHOLD_CHARS) {
    throw new Error(
      `File is only ~${estimatedTokens} estimated tokens (threshold: 2000). ` +
        `Use read_file instead of summarize_file.`
    );
  }

  // Cache hit?
  const cached = db
    .prepare("SELECT summary, summarized_at_v FROM summaries WHERE file_id = ?")
    .get(file.id) as { summary: string; summarized_at_v: number } | undefined;

  if (cached && cached.summarized_at_v === file.cur_version) {
    recordOperation(args.agent_id);
    return {
      path: args.path,
      current_version: file.cur_version,
      summary: cached.summary,
      cached: true,
      estimated_tokens: estimatedTokens,
    };
  }

  // Cache miss — call the API.
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content:
          "Summarize the following file concisely so an AI agent can understand " +
          "its purpose and key contents without reading the full text. Focus on " +
          "structure, intent, and any specific identifiers (function names, IDs, " +
          "filenames) the agent might need. Return only the summary — no preamble.\n\n" +
          "---\n" +
          contentRow.content,
      },
    ],
  });

  // The SDK returns content as an array of blocks; concat all text blocks.
  const summary = response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!summary) {
    throw new Error("Anthropic API returned an empty summary.");
  }

  // Upsert into the summaries cache.
  const now = Date.now();
  db.prepare(
    `INSERT INTO summaries (file_id, summarized_at_v, summary, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(file_id) DO UPDATE SET
       summarized_at_v = excluded.summarized_at_v,
       summary         = excluded.summary,
       created_at      = excluded.created_at`
  ).run(file.id, file.cur_version, summary, now);

  recordOperation(args.agent_id);

  return {
    path: args.path,
    current_version: file.cur_version,
    summary,
    cached: false,
    estimated_tokens: estimatedTokens,
  };
}
