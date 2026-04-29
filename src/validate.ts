const PATH_REGEX = /^[a-zA-Z0-9/_.-]+$/;
const MAX_PATH_LENGTH = 255;

/**
 * Validates a user-supplied path. Throws an Error with a clear message
 * naming the violated rule. Returns nothing on success.
 */
export function validatePath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("Invalid path: must be a non-empty string.");
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new Error(
      `Invalid path: exceeds max length of ${MAX_PATH_LENGTH} characters.`
    );
  }
  if (path.startsWith("/")) {
    throw new Error("Invalid path: leading '/' is not allowed.");
  }
  if (path.includes("..")) {
    throw new Error("Invalid path: '..' sequences are not allowed.");
  }
  if (!PATH_REGEX.test(path)) {
    throw new Error(
      "Invalid path: only [a-zA-Z0-9/_.-] characters are allowed."
    );
  }
}

/** Validates an agent_id. Same character rules, no path-specific checks. */
export function validateAgentId(agentId: string): void {
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error("Invalid agent_id: must be a non-empty string.");
  }
  if (agentId.length > 128) {
    throw new Error("Invalid agent_id: exceeds max length of 128 characters.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error(
      "Invalid agent_id: only [a-zA-Z0-9_-] characters are allowed."
    );
  }
}
