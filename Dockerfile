# Stage 1: Install dependencies and build frontend
FROM node:20.18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Separate production dependencies
RUN rm -rf node_modules && npm ci --omit=dev

# Stage 2: Production image
FROM node:20.18-alpine
WORKDIR /app

# Install tsx for running TypeScript directly (ESM + path aliases)
RUN npm install -g tsx

# Copy production node_modules
COPY --from=builder /app/node_modules ./node_modules

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server source (runs via tsx)
COPY --from=builder /app/api ./api
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["tsx", "api/server.ts"]
