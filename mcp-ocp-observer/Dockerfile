# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first to leverage Docker layer cache
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for esbuild compilation)
RUN npm install

# Copy source and compile TypeScript → JavaScript via esbuild.
# esbuild uses ~10x less memory than tsc — avoids OOM in resource-constrained build environments.
# All imports are marked external so node_modules are not bundled (kept as require() at runtime).
COPY src/ ./src/
RUN node_modules/.bin/esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/index.js \
  --packages=external \
  --format=esm

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Create a dedicated non-root user.
# Numeric UID 1001 is compatible with OpenShift restricted-v2 SCC.
RUN addgroup -S mcp && adduser -S -u 1001 -G mcp mcp

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Make all files readable/executable by the root group (GID 0).
# OpenShift assigns a random UID but always uses GID 0 — this pattern
# ensures the process can read its own files regardless of UID assignment.
RUN chown -R 1001:0 /app && chmod -R g=u /app

# Switch to non-root user — satisfies runAsNonRoot: true in the Deployment
USER 1001

# MCP HTTP server listens on 8080 (matches PORT env var default)
EXPOSE 8080

# Use exec form (not shell form) — required for correct signal handling in containers
CMD ["node", "dist/index.js"]
