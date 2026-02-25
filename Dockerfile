FROM oven/bun:1-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/bun.lock* ./backend/
RUN cd backend && bun install

# Copy backend code and shared types
COPY backend/ ./backend/
COPY types/ ./types/

# Expose the port the Express server listens on
EXPOSE 3000

CMD ["bun", "backend/index.ts"]
