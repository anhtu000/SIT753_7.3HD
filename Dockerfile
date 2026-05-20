FROM node:20-bookworm-slim

WORKDIR /app

# Install build tools needed for sqlite3 native module
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Safer install: do not run package lifecycle scripts automatically
RUN npm ci --omit=dev --ignore-scripts

# Explicitly rebuild only the dependency that needs native build support
RUN npm rebuild sqlite3 --build-from-source

COPY . .

RUN node createDB.js

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]