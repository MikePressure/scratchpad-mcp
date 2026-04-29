#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// Initialize the database once at process start. Both transports share it.
getDb();

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

/**
 * Build and return a fully-configured MCP Server with all tool handlers
 * registered. Called once for stdio mode, and once per request for HTTP mode
 * (so concurrent callers can't observe each other's in-flight state).
 */
function createServer(): Server {
  const server = new Server(
    { name: "scratchpad-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

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

  return server;
}

// --- Transport selection ---------------------------------------------------

const transportMode = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

if (transportMode === "stdio") {
  // Default mode: speak MCP over stdin/stdout. This is how Claude Desktop,
  // Smithery local installs, and any direct stdio MCP client use the server.
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else if (transportMode === "http") {
  // Hosted mode: HTTP server using MCP's Streamable HTTP transport.
  // Used by Apify standby mode, Smithery hosted, and any other deploy that
  // exposes the server as a remote URL. Stateless — one server+transport
  // pair per incoming POST so concurrent callers don't share state in
  // memory (persistent state lives in SQLite).
  const port = Number(process.env.PORT) || 4321;

  const httpServer = createHttpServer(async (req, res) => {
    // Health endpoint for Apify / load balancer probes.
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("scratchpad-mcp running. POST JSON-RPC to /mcp.\n");
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found. MCP endpoint is /mcp.\n");
      return;
    }

    if (req.method === "POST") {
      // Read the body, then hand the request to a fresh stateless transport.
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        let parsed: unknown = undefined;
        if (body.length > 0) {
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
        }
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
          });
          const server = createServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, parsed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          }
        }
      });
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed.\n");
  });

  httpServer.listen(port, () => {
    // stderr so it doesn't pollute any stdout pipe a wrapper might be reading.
    console.error(`scratchpad-mcp HTTP listening on :${port}`);
  });
} else {
  console.error(
    `Unknown MCP_TRANSPORT="${transportMode}". Use "stdio" (default) or "http".`
  );
  process.exit(1);
}
