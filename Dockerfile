# Multi-stage build for production
FROM node:20-alpine AS base

# Build stage - install and build in one stage
FROM base AS builder
WORKDIR /app

# Install system dependencies and enable corepack
RUN apk add --no-cache libc6-compat && \
    corepack enable

# Copy package files
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY turbo.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit --progress=false

# Copy source code
COPY . .

# Set production environment and build optimizations
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SHARP=1
ENV DISABLE_FONT_OPTIMIZATION=1

# Build applications
RUN npm run build

# Production stage - clean install
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install system dependencies and ffmpeg with NVIDIA support
RUN apk add --no-cache curl openssl nginx pciutils wget && \
    # Install ffmpeg with NVIDIA support from static build
    wget -O /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" && \
    cd /tmp && \
    tar xf ffmpeg.tar.xz && \
    cp ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    cp ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg* && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx && \
    mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /var/lib/nginx/tmp/fastcgi /var/lib/nginx/tmp/uwsgi /var/lib/nginx/tmp/scgi && \
    chown -R nextjs:nodejs /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx && \
    corepack enable

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

# Copy prisma files
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/prisma.config.ts ./apps/server/

# Copy nginx configuration
COPY --chown=nextjs:nodejs nginx.conf /etc/nginx/nginx.conf

# Copy and make start script executable
COPY --chown=nextjs:nodejs start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Ensure nextjs user owns all app directories
RUN chown -R nextjs:nodejs /app

USER nextjs

# Expose ports
EXPOSE 80 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Start with better error handling
CMD ["/bin/sh", "-c", "echo 'Starting TwentyFourSeven...' && /app/start.sh"] 