# Dual-stage Dockerfile for Node-based compilation and deployment
FROM node:24-slim AS builder

WORKDIR /app

# Pre-packaged deps install
COPY package*.json ./
RUN npm ci

# Source copying and assets bundling
COPY . .
RUN npm run build

# Stage 2: Runtime Container
FROM node:24-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled deliverables from state 1
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server

# Install esbuild/tsx globally or use pre-installed dependency bundles
RUN npm install -g esbuild tsx

EXPOSE 3000

# Run in production mode using tsx server compiler
CMD ["tsx", "server.ts"]
