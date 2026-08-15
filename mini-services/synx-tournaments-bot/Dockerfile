# Synx Tournaments Bot - Dockerfile for Railway Deployment
# Multi-stage build for optimized image size

# Stage 1: Build stage
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build TypeScript (if needed, or we can run directly with bun)
# Bun can run TS directly, so no build step needed!

# Stage 2: Production stage
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bunuser

# Copy built files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/database ./database

# Change to non-root user
USER bunuser

# Expose port (Railway uses this)
EXPOSE 3000

# Health check endpoint (optional - Railway has its own)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --version || exit 1

# Start command - run the bot
CMD ["bun", "run", "src/index.ts"]
