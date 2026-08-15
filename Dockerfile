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

# Copy ENTIRE bot folder first (ensures all files are included)
COPY mini-services/synx-tournaments-bot/ ./bot-files/

# Move required files to working directory
RUN mv bot-files/package.json . && \
    mv bot-files/bun.lock . 2>/dev/null || true && \
    mkdir -p src database && \
    cp -r bot-files/src/* src/ 2>/dev/null || true && \
    cp bot-files/tsconfig.json . 2>/dev/null || true && \
    cp -r bot-files/database/* database/ 2>/dev/null || true && \
    rm -rf bot-files

# Install dependencies
RUN bun install --production=false

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
