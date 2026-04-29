#!/bin/sh
# Apify Actor entrypoint.
#
# Apify writes the user's run-time input to /apify_input/INPUT.json. We read
# the anthropicApiKey field out of it and set ANTHROPIC_API_KEY in the env
# before launching the MCP server. This makes summarize_file work on the
# *caller's* key, not the Actor publisher's.
#
# If no input file exists or no key was supplied, we just launch with whatever
# env was already there. The other 7 tools work fine without a key.

set -e

INPUT_FILE="/apify_input/INPUT.json"

if [ -f "$INPUT_FILE" ]; then
  KEY=$(node -e "
    try {
      const i = JSON.parse(require('fs').readFileSync('$INPUT_FILE','utf8'));
      if (i && typeof i.anthropicApiKey === 'string' && i.anthropicApiKey.length > 0) {
        process.stdout.write(i.anthropicApiKey);
      }
    } catch (e) { /* ignore */ }
  ")
  if [ -n "$KEY" ]; then
    export ANTHROPIC_API_KEY="$KEY"
  fi
fi

exec node dist/index.js
