FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first (cache layer)
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
COPY apps/realms-server/ apps/realms-server/

# Runtime
FROM oven/bun:1-slim
WORKDIR /app

RUN groupadd --system appgroup && useradd --system --gid appgroup --no-create-home appuser
RUN mkdir -p /data && chown appuser:appgroup /data

COPY --from=base --chown=appuser:appgroup /app /app
COPY docker/realms-server-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV PORT=3000
ENV HOST=0.0.0.0
ENV SERVER_NAME="Federated Realms"
ENV DATA_PATH=/app/apps/realms-server/data
ENV DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/realms-server/src/index.ts"]
