#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "./db.js";
import { writeFileSchema, handleWriteFile } from "./tools/write_file.js";
import { readFileSchema, handleReadFile } from "./tools/read_file.js";
import { appendLogSchema, handleAppendLog } from "./tools/append_log.js";
import { readLogSchema, handleReadLog } from "./tools/read_log.js";
import { listFilesSchema, handleListFiles } from "./tools/list_files.js";
import { deleteFileSchema, handleDeleteFile } from "./tools/delete_file.js";
import { summarizeFileSchema, handleSummarizeFile } from "./tools/summarize_file.js";
import { getUsageStatsSchema, handleGetUsageStats } from "./tools/get_usage_stats.js";

getDb();

const server = new Server(
  {
    name: "scratchpad-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools = [
  writeFileSchema,
  readFileSchema,
  appendLogSchema,
  readLogSchema,
  listFilesSchema,
  deleteFileSchema,
  summarizeFileSchema,
  getUsageStatsSchema,
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case "write_file":
        result = handleWriteFile(args as unknown as Parameters<typeof handleWriteFile>[0]);
        break;
      case "read_file":
        result = handleReadFile(args as unknown as Parameters<typeof handleReadFile>[0]);
        break;
      case "append_log":
        result = handleAppendLog(args as unknown as Parameters<typeof handleAppendLog>[0]);
        break;
      case "read_log":
        result = handleReadLog(args as unknown as Parameters<typeof handleReadLog>[0]);
        break;
      case "list_files":
        result = handleListFiles(args as unknown as Parameters<typeof handleListFiles>[0]);
        break;
      case "delete_file":
        result = handleDeleteFile(args as unknown as Parameters<typeof handleDeleteFile>[0]);
        break;
      case "summarize_file":
        result = await handleSummarizeFile(
          args as unknown as Parameters<typeof handleSummarizeFile>[0]
        );
        break;
      case "get_usage_stats":
        result = handleGetUsageStats(
          args as unknown as Parameters<typeof handleGetUsageStats>[0]
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
