/**
 * Shared input-size limits enforced across tools.
 *
 * These are intentionally generous for typical agent use (a 1 MB file is
 * already a very large piece of context) but tight enough to prevent abuse.
 * If you raise these, also raise the Anthropic input limit considerations
 * for summarize_file.
 */

export const MAX_FILE_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB per file write
export const MAX_LOG_ENTRY_BYTES = 64 * 1024;          // 64 KB per log entry

export function assertContentSize(content: string, label = "content"): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_CONTENT_BYTES) {
    throw new Error(
      `${label} exceeds max size of ${MAX_FILE_CONTENT_BYTES} bytes ` +
        `(received ${bytes} bytes).`
    );
  }
}

export function assertLogEntrySize(entry: string): void {
  const bytes = Buffer.byteLength(entry, "utf8");
  if (bytes > MAX_LOG_ENTRY_BYTES) {
    throw new Error(
      `entry exceeds max size of ${MAX_LOG_ENTRY_BYTES} bytes ` +
        `(received ${bytes} bytes). Consider splitting across multiple entries.`
    );
  }
}
