FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies (cache layer)
COPY package.json bun.lock ./
COPY packages/lexicons/package.json packages/lexicons/
COPY packages/common/package.json packages/common/
COPY packages/atproto/package.json packages/atproto/
COPY packages/protocol/package.json packages/protocol/
COPY packages/client-common/package.json packages/client-common/
COPY packages/server-sdk/package.json packages/server-sdk/
COPY apps/realms-server/package.json apps/realms-server/
COPY apps/cli-client/package.json apps/cli-client/
COPY apps/web-client/package.json apps/web-client/

RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY packages/ packages/
COPY apps/web-client/ apps/web-client/

# Build static assets
RUN cd apps/web-client && bun run build

# Serve with lightweight static server
FROM oven/bun:1-slim
WORKDIR /app

RUN groupadd --system appgroup && useradd --system --gid appgroup --no-create-home appuser

COPY --from=build --chown=appuser:appgroup /app/apps/web-client/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/apps/web-client/serve.ts ./serve.ts

ENV PORT=8080
ENV API_URL=http://realms-server:3000

EXPOSE 8080

USER appuser

CMD ["bun", "run", "serve.ts"]
