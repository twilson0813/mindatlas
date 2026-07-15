# ==============================================================================
# Stage 1: Build
# ==============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

# Copy package files and install all dependencies (including devDependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build configs
COPY tsconfig.json tsconfig.server.json ./
COPY src/ src/
COPY docs/ docs/
COPY migrations/ migrations/

# Build the server
RUN npm run build

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:20-alpine AS runtime

WORKDIR /app

# Install runtime dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++ curl && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    apk del python3 make g++ && \
    npm cache clean --force

# Copy compiled server output from build stage (includes shared types)
COPY --from=build /app/dist/server ./dist/server

# Copy documentation and migrations (needed at runtime)
COPY --from=build /app/docs ./docs
COPY --from=build /app/migrations ./migrations

# Set ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Expose the HTTP port
EXPOSE 3000

# Environment variable configuration
ENV NODE_ENV=production
ENV PORT=3000

# Health check: verify /health returns 200 within 30 seconds of start
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "dist/server/index.js"]
