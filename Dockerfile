# Multi-stage build for production
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY turbo.json ./

# Install dependencies with npm ci for faster, reproducible builds
RUN npm ci --prefer-offline --no-audit --progress=false

# Build stage
FROM base AS builder
WORKDIR /app

# Copy source code
COPY . .

# Copy only node_modules (no separate copy step needed)
COPY --from=deps /app/node_modules ./node_modules

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build applications
RUN npm run build

# Production stage - single dependency installation
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install system dependencies in one layer
RUN apk add --no-cache curl openssl nginx pciutils && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx && \
    mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /var/lib/nginx/tmp/fastcgi /var/lib/nginx/tmp/uwsgi /var/lib/nginx/tmp/scgi && \
    chown -R nextjs:nodejs /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx

# Copy package files for production install
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY turbo.json ./

# Install only production dependencies
RUN npm ci --only=production --prefer-offline --no-audit --progress=false && \
    npm cache clean --force

# Copy built applications with proper ownership
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/.next ./apps/server/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/package.json ./apps/server/package.json

# Copy prisma files (multi-file schema setup)
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma/schema ./apps/server/prisma/schema
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma/generated ./apps/server/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma.config.ts ./apps/server/

# Copy nginx configuration
COPY --chown=nextjs:nodejs nginx.conf /etc/nginx/nginx.conf

USER nextjs

# Expose ports
EXPOSE 80 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Start script
COPY --chown=nextjs:nodejs start.sh /app/start.sh

CMD ["/bin/sh", "/app/start.sh"] 