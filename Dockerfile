# syntax=docker/dockerfile:1.7
# Multi-stage build for production
FROM node:20-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /app

# Dependencies stage - install deps separately for better caching
FROM base AS deps
WORKDIR /app

# Install system dependencies and enable corepack
RUN apk add --no-cache libc6-compat && \
    corepack enable

# Copy package files (monorepo-aware to maximize Docker cache hits)
COPY package*.json ./
COPY turbo.json ./
# App manifests
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/

# Install dependencies including devDependencies (needed for turbo build)
# Using npm ci with optimizations for faster installs
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache \
    npm ci --prefer-offline --no-audit --progress=false --no-fund --parallel=4

# Build stage - separate from deps for faster rebuilds
FROM base AS builder
WORKDIR /app

# Copy installed node_modules from deps stage (Turbo monorepo uses root node_modules)
COPY --from=deps /app/node_modules ./node_modules

# Enable corepack in builder stage too
RUN corepack enable

# Copy package files for build context
COPY package*.json ./
COPY turbo.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/

# Copy source code
COPY . .

# Generate Prisma client for the target platform (Linux)
WORKDIR /app/apps/server
RUN npx prisma generate --schema ./prisma/schema
WORKDIR /app

# Set production environment and build optimizations
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SHARP=1
ENV DISABLE_FONT_OPTIMIZATION=1

# Build applications
RUN npm run build

# Production stage - use NVIDIA-enabled FFmpeg base (following TwentyFourSeven pattern)
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install system dependencies, Nginx, and Debian ffmpeg with VAAPI like ESPG
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    nginx \
    ca-certificates \
    ffmpeg \
    vainfo \
    libva2 \
    libva-drm2 \
    intel-media-va-driver \
    mesa-va-drivers \
    pciutils usbutils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Create user and groups following Plex/Unraid best practices (abc user pattern)
    && groupadd --gid 100 users || true \
    && useradd --uid 99 --gid users --shell /bin/bash --create-home abc \
    # Add abc user to video and render groups for GPU access
    && usermod -a -G video abc \
    && usermod -a -G render abc || true \
    # Create necessary directories
    && mkdir -p /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx \
    && mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /var/lib/nginx/tmp/fastcgi /var/lib/nginx/tmp/uwsgi /var/lib/nginx/tmp/scgi \
    # Set proper ownership
    && chown -R abc:users /app/database /app/static \
    # Ensure GPU device access permissions
    && mkdir -p /dev/dri

# ffmpeg is installed via Debian package and available at /usr/bin/ffmpeg and /usr/bin/ffprobe

# Copy package files for production install (monorepo-aware for cache)
COPY package*.json ./
COPY turbo.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/

# Install only production dependencies (use BuildKit cache for npm)
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache \
    npm ci --prefer-offline --no-audit --progress=false --no-fund --omit=dev --parallel=4 && \
    npm cache clean --force

# Copy built applications with proper ownership (abc user like Plex)
COPY --from=builder --chown=abc:users /app/apps/web/out ./apps/web/out
COPY --from=builder --chown=abc:users /app/apps/server/.next ./apps/server/.next
COPY --from=builder --chown=abc:users /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=abc:users /app/apps/server/package.json ./apps/server/package.json

# Copy prisma files
COPY --from=builder --chown=abc:users /app/apps/server/prisma ./apps/server/prisma

# Copy server.js (required for running the server)
COPY --from=builder --chown=abc:users /app/apps/server/server.js ./apps/server/server.js

# Verify ffmpeg is installed and check for common hardware accel encoders
RUN echo "🔍 Checking ffmpeg installation..." \
    && /usr/bin/ffmpeg -version || (echo "⚠️  ffmpeg not found" && exit 1) \
    && echo "🔍 Listing encoders (looking for vaapi/qsv/videotoolbox if available)..." \
    && /usr/bin/ffmpeg -encoders 2>/dev/null | grep -E "vaapi|qsv|videotoolbox" || /usr/bin/ffmpeg -encoders 2>/dev/null | head -20

# Copy nginx configuration
COPY --chown=abc:users nginx.conf /etc/nginx/nginx.conf

# Copy and make start script executable
COPY --chown=abc:users start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create GPU device permission script (simplified for NVIDIA base image)
RUN echo '#!/bin/bash' > /app/init-gpu-permissions.sh && \
    echo '# GPU Device Permission Handler (TwentyFourSeven-style simplified approach)' >> /app/init-gpu-permissions.sh && \
    echo 'echo "🔧 Setting up GPU device permissions..."' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo '# Handle NVIDIA devices (should be available via NVIDIA runtime)' >> /app/init-gpu-permissions.sh && \
    echo 'if [ -d "/dev" ] && ls /dev/nvidia* >/dev/null 2>&1; then' >> /app/init-gpu-permissions.sh && \
    echo '    echo "🎮 NVIDIA devices found - runtime should handle permissions"' >> /app/init-gpu-permissions.sh && \
    echo '    ls -la /dev/nvidia* 2>/dev/null || true' >> /app/init-gpu-permissions.sh && \
    echo 'else' >> /app/init-gpu-permissions.sh && \
    echo '    echo "⚠️  No NVIDIA devices found - check --runtime=nvidia configuration"' >> /app/init-gpu-permissions.sh && \
    echo 'fi' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo '# Handle DRI devices (Intel/AMD GPUs)' >> /app/init-gpu-permissions.sh && \
    echo 'if [ -d "/dev/dri" ]; then' >> /app/init-gpu-permissions.sh && \
    echo '    echo "📹 DRI devices found"' >> /app/init-gpu-permissions.sh && \
    echo '    ls -la /dev/dri/ 2>/dev/null || true' >> /app/init-gpu-permissions.sh && \
    echo '    # Add abc user to render group for DRI access' >> /app/init-gpu-permissions.sh && \
    echo '    for device in /dev/dri/*; do' >> /app/init-gpu-permissions.sh && \
    echo '        if [ -c "$device" ]; then' >> /app/init-gpu-permissions.sh && \
    echo '            DEVICE_GROUP=$(stat -c "%g" "$device")' >> /app/init-gpu-permissions.sh && \
    echo '            if getent group "$DEVICE_GROUP" >/dev/null 2>&1; then' >> /app/init-gpu-permissions.sh && \
    echo '                GROUP_NAME=$(getent group "$DEVICE_GROUP" | cut -d: -f1)' >> /app/init-gpu-permissions.sh && \
    echo '                usermod -a -G "$GROUP_NAME" abc 2>/dev/null || true' >> /app/init-gpu-permissions.sh && \
    echo '            fi' >> /app/init-gpu-permissions.sh && \
    echo '        fi' >> /app/init-gpu-permissions.sh && \
    echo '    done' >> /app/init-gpu-permissions.sh && \
    echo 'else' >> /app/init-gpu-permissions.sh && \
    echo '    echo "ℹ️  No DRI devices found"' >> /app/init-gpu-permissions.sh && \
    echo 'fi' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo 'echo "✅ GPU device permissions setup complete"' >> /app/init-gpu-permissions.sh && \
    chmod +x /app/init-gpu-permissions.sh

# Set hardware acceleration environment variables (TwentyFourSeven pattern)
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV HARDWARE_ACCEL_DEVICE=/dev/dri/renderD128
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
# Set PUID/PGID like Plex for Unraid compatibility
ENV PUID=99
ENV PGID=100

# Run as root to allow nginx to bind to port 80 and write PID files
# Individual applications will drop privileges as needed
# USER abc

# Unraid Docker tab metadata (icon URL must be publicly reachable after you push icon.png to GitHub)
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/drew4/twentyfourseven/main/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT:80]/"
LABEL net.unraid.docker.support="https://github.com/drew4/twentyfourseven"

# Expose ports
EXPOSE 80 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Override the NVIDIA FFmpeg base image entrypoint and set our own command
ENTRYPOINT []
CMD ["/app/start.sh"] 