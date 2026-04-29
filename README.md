# scratchpad-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)

Persistent, token-efficient storage for AI agents. An MCP server that stops your
agents from re-reading the same files and re-loading the same context every turn.

```text
agent: "what changed in this file since I last read it?"
server: { diff: [...], current_version: 14 }   ← not the whole file
```

## Why

Agents waste tokens. They re-read files they've already seen, re-summarize
documents they've already processed, and re-discover state they've already
computed. This server gives them a place to put that work and pick it up later
in a way the model can reason about cheaply.

Concretely:

- **Versioned writes** so an agent can store a working document and ask "what
  changed since I last saw this?" — the server returns a structured diff
  instead of the full content.
- **Append-only logs** with cursor-based pagination, so an agent can record
  its own action history and replay it efficiently.
- **On-demand summaries** for long files (>2000 estimated tokens), generated
  by Claude Haiku and cached per file version, so repeat summary calls are
  free.
- **Per-agent namespacing** so one server instance can serve many agents
  without leaking state between them.

## Tools

All tools take `agent_id` as their first argument. Operations are scoped to
that agent — agents cannot read each other's files or logs.

| Tool | What it does |
|---|---|
| `write_file(agent_id, path, content)` | Store content at a path. Auto-versions on every write. Keeps the 10 most recent versions. |
| `read_file(agent_id, path, since_version?)` | Read full content, or a JSON line-diff against a prior version. If `since_version` has been pruned, returns full content with `version_too_old: true`. |
| `append_log(agent_id, path, entry)` | Append one entry to an append-only log. Returns the new entry ID. |
| `read_log(agent_id, path, since_entry?)` | Read log entries with cursor pagination. 100 entries per page, `has_more` flag plus `last_entry_id` cursor. |
| `list_files(agent_id, prefix?)` | List files (metadata only) optionally filtered by path prefix. |
| `delete_file(agent_id, path)` | Delete a file and all its versions and any cached summary. |
| `summarize_file(agent_id, path)` | LLM-summarize a long file (>8000 chars). Cached per version, so repeat calls on an unchanged file cost nothing. |
| `get_usage_stats(agent_id)` | Return total bytes, file count, log count, and total operations for an agent. |

### Diff format

`read_file` with `since_version` returns a JSON array of chunks:

```json
{
  "diff": [
    { "op": "equal",  "lines": ["line that didn't change"] },
    { "op": "remove", "lines": ["line that was deleted"] },
    { "op": "add",    "lines": ["line that was added"] }
  ]
}
```

Line-level diffing is intentional — it's the format agents handle most
reliably, and it lets the agent reason about *what changed* rather than
re-processing the whole file.

### Path rules

Paths must match `[a-zA-Z0-9/_.-]+`, max 255 chars, no leading `/`, no `..`
sequences. Errors name the violated rule.

### Limits

- 1 MB per file write
- 64 KB per log entry
- 10 retained versions per file (older ones pruned automatically)
- 100 log entries per `read_log` page

## Install

Requires Node 20+ and an Anthropic API key (only for `summarize_file`).

```powershell
git clone <this repo>
cd scratchpad-mcp
npm install
npm run build
```

That produces `dist/index.js`, the runnable server.

## Configure with Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "scratchpad": {
      "command": "node",
      "args": ["C:\\path\\to\\scratchpad-mcp\\dist\\index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

`ANTHROPIC_API_KEY` is only required if you intend to call `summarize_file`.
The other seven tools work without it.

Optional: set `SCRATCHPAD_DB_PATH` to override the SQLite location. Defaults
to `scratchpad.db` in the project root.

Restart Claude Desktop. The server should appear in the MCP servers list with
8 tools.

## How storage works

A single SQLite file holds everything:

- `files` — one row per `(agent_id, path)`, tracks the current version.
- `file_versions` — full content per version, capped at 10 most recent per
  file. Pruning happens on every `write_file`.
- `log_entries` — append-only entries, never modified.
- `summaries` — per-file summary cache, invalidated by version mismatch.
- `agent_usage` — per-agent operation counter for `get_usage_stats`.

Versioning stores full content per version (not deltas) because writes need to
be fast and reads need to be unambiguous. Diffs are computed on read by
running the two versions through line-level diffing — the cost is paid by the
caller asking for the diff, not by every writer.

## Roadmap

- [ ] Apify packaging for pay-per-call billing.
- [ ] Derive `agent_id` from API key instead of taking it as a parameter.
- [ ] Postgres backend (the SQLite schema is portable; this is a connection
      swap, not a rewrite).
- [ ] Per-agent rate limiting.
- [ ] Structured logging for ops visibility.

## License

MIT — see [LICENSE](./LICENSE).
