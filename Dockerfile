# ============================================================
# SYNX TOURNAMENTS BOT - Railway Deployment
# Root-level Dockerfile (NO subfolder issues!)
# ============================================================

FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy bot package files (ROOT LEVEL - no subfolder issues!)
COPY bot-package.json ./package.json
COPY bot-bun.lock ./bun.lock

# Install all dependencies (Bun doesn't support --production=false)
RUN bun install

# Copy source code (ROOT LEVEL)
COPY bot-src/ ./src/
COPY bot-tsconfig.json ./tsconfig.json
COPY bot-database/ ./database/

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botuser

USER botuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --version || exit 1

# Start Discord Bot!
CMD ["bun", "run", "src/index.ts"]
