FROM node:20-alpine

WORKDIR /app

# Copy frontend and install deps
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy backend and install deps
COPY backend/package*.json ./backend/
RUN cd backend && npm ci

# Copy all source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend
RUN cd frontend && npm run build

# Expose the port Railway will assign
EXPOSE ${PORT:-3001}

# Start the backend (which serves the built frontend)
CMD ["node", "backend/src/index.js"]
