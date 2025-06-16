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

# Install ALL dependencies (including devDependencies for building)
RUN npm ci && npm cache clean --force

# Build stage
FROM base AS builder
WORKDIR /app

# Copy source code
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build applications
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install curl for health checks, openssl for secret generation, nginx, and pciutils for GPU detection
RUN apk add --no-cache curl openssl nginx pciutils

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built applications
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/.next ./apps/server/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/turbo.json ./

# Copy prisma files (multi-file schema setup)
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma/schema ./apps/server/prisma/schema
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma/generated ./apps/server/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma.config.ts ./apps/server/

# Install only production dependencies for runtime
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY turbo.json ./
RUN npm ci --only=production && npm cache clean --force

# Fix permissions for node_modules so nextjs user can write to it
RUN chown -R nextjs:nodejs /app/node_modules

# Copy nginx configuration
COPY --chown=nextjs:nodejs nginx.conf /etc/nginx/nginx.conf

# Create directories for database and static files
RUN mkdir -p /app/database && chown nextjs:nodejs /app/database
RUN mkdir -p /app/static && chown nextjs:nodejs /app/static
RUN mkdir -p /var/log/nginx && chown nextjs:nodejs /var/log/nginx
RUN mkdir -p /var/lib/nginx && chown nextjs:nodejs /var/lib/nginx
RUN mkdir -p /run/nginx && chown nextjs:nodejs /run/nginx

# Create nginx temporary directories and fix permissions
RUN mkdir -p /var/lib/nginx/tmp/client_body \
    /var/lib/nginx/tmp/proxy \
    /var/lib/nginx/tmp/fastcgi \
    /var/lib/nginx/tmp/uwsgi \
    /var/lib/nginx/tmp/scgi && \
    chown -R nextjs:nodejs /var/lib/nginx

USER nextjs

# Expose ports
EXPOSE 80 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Start script
COPY --chown=nextjs:nodejs start.sh /app/start.sh

CMD ["/bin/sh", "/app/start.sh"] 