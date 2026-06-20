# ---- Stage 1: build the React/Vite frontend ----
# Vite's outDir is ../backend/dist (see frontend/vite.config.ts), so the build
# emits into /app/backend/dist, which the Express server serves statically.
FROM oven/bun:1-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/bun.lock* ./frontend/
RUN cd frontend && bun install
COPY frontend/ ./frontend/
COPY types/ ./types/
# Use vite build directly (not `bun run build`, which gates on `tsc -b`):
# esbuild transpiles + elides type-only imports of the shared ../types, so backend-only
# type deps (ws, @anthropic-ai/sdk) never need resolving in the frontend image.
RUN cd frontend && bunx vite build

# ---- Stage 2: backend runtime (serves API + built frontend) ----
FROM oven/bun:1-alpine
WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/bun.lock* ./backend/
RUN cd backend && bun install

# Copy backend code and shared types
COPY backend/ ./backend/
COPY types/ ./types/

# Bring in the compiled frontend from the build stage
COPY --from=frontend /app/backend/dist ./backend/dist

EXPOSE 3000
CMD ["bun", "backend/index.ts"]
