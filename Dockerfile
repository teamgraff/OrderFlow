# ---- Stage 1: Build frontend ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install frontend deps (including devDeps like vite)
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --include=dev

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ---- Stage 2: Production image ----
FROM node:20-alpine

WORKDIR /app

# Create persistent data directory (Railway volume mounts here)
RUN mkdir -p /data

# Install backend deps (production only)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from builder stage
COPY --from=builder /app/frontend/dist ./frontend/dist

# Default port (Railway overrides via $PORT env var)
EXPOSE ${PORT:-3001}

# Start the backend (which serves the built frontend)
CMD ["node", "backend/src/index.js"]
