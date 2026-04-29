# Build stage — compile TypeScript.
FROM node:20-alpine AS build
WORKDIR /app

# Native compile deps for better-sqlite3 (only needed in build stage).
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Runtime stage — only what's needed to run the server.
FROM node:20-alpine AS runtime
WORKDIR /app

# Production deps only. Copy package files first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Bring in the compiled output and built native modules.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# Persist the SQLite file outside /app so Apify's volumes can mount it.
ENV SCRATCHPAD_DB_PATH=/data/scratchpad.db
RUN mkdir -p /data

# Hosted deploys (Apify, etc.) use HTTP transport. Local Docker users can
# override by passing `-e MCP_TRANSPORT=stdio` and `-i` if they want stdio.
ENV MCP_TRANSPORT=http
EXPOSE 4321

# Launcher that maps Apify's per-run input to ANTHROPIC_API_KEY before
# starting the server. Falls back to plain `node dist/index.js` if no
# input file exists, so non-Apify Docker users see identical behavior.
COPY .actor/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
