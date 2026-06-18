# Dual-stage Dockerfile for Node-based compilation and deployment
FROM node:24-slim AS builder

WORKDIR /app

# Puppeteer: skip bundled Chrome download (slim image lacks extraction tools);
# the runtime stage provides a system Chromium instead.
ENV PUPPETEER_SKIP_DOWNLOAD=true

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

# System Chromium for puppeteer (skips bundled download which fails on slim image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled deliverables from state 1
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/tools.json ./tools.json
COPY --from=builder /app/backend ./backend

# Install esbuild/tsx globally or use pre-installed dependency bundles
RUN npm install -g esbuild tsx

# Run as non-root (Faz 9A hardening, semgrep missing-user). Global installs above
# ran as root; here we create nodeapp and own /app + the data dir. The app uses
# os.homedir() for MISSION_CONTROL_DATA_DIR, so it follows the user's home.
RUN useradd -m -u 1001 nodeapp \
 && mkdir -p /home/nodeapp/.llm-mission-control \
 && chown -R nodeapp:nodeapp /app /home/nodeapp
USER nodeapp

EXPOSE 3000

# Health: Node global fetch (no curl needed in the slim image). Lets
# `docker compose up --wait` block until the app actually serves /api/health.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run in production mode using tsx server compiler
CMD ["tsx", "server.ts"]
