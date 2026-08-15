# ============================================================
# SYNX TOURNAMENTS BOT - Railway Deployment
# This Dockerfile OVERRIDES Next.js and runs Discord Bot
# ============================================================

# Use Bun runtime (includes Node.js)
FROM oven/bun:1-slim

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy bot package files first (better layer caching)
COPY mini-services/synx-tournaments-bot/package.json \
     mini-services/synx-tournaments-bot/bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Copy bot source code
COPY mini-services/synx-tournaments-bot/src ./src
COPY mini-services/synx-tournaments-bot/tsconfig.json ./
COPY mini-services/synx-tournaments-bot/database ./database

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botuser

# Switch to non-root user
USER botuser

# Expose port (Railway requirement)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --version || exit 1

# Start the Discord Bot (NOT Next.js!)
CMD ["bun", "run", "src/index.ts"]
