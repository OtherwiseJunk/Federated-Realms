FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json bun.lock ./
COPY packages/lexicons/package.json packages/lexicons/
COPY packages/common/package.json packages/common/
COPY packages/atproto/package.json packages/atproto/
COPY packages/protocol/package.json packages/protocol/
COPY packages/client-common/package.json packages/client-common/
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

COPY --from=base --chown=appuser:appgroup /app /app

ENV PORT=3000
ENV HOST=0.0.0.0
ENV SERVER_NAME="Federated Realms"
ENV DATA_PATH=/app/apps/realms-server/data

EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/realms-server/src/index.ts"]
