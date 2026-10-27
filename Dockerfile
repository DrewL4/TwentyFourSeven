# syntax=docker/dockerfile:1.7
# Multi-stage build for production
FROM node:22-alpine AS base

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

# npm workspaces sometimes nest packages under each app. Keep the directories
# present so the builder can copy them even when a later install hoists everything.
RUN mkdir -p apps/web/node_modules apps/server/node_modules

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

# Direct workspace dependencies that npm did not hoist (for example @orpc/client).
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules

# Generate Prisma client for the target platform (Linux)
WORKDIR /app/apps/server
RUN apk add --no-cache ca-certificates \
    && i=1 \
    && until npx prisma generate --schema ./prisma/schema; do \
         i=$((i + 1)); \
         if [ "$i" -gt 6 ]; then exit 1; fi; \
         echo "prisma generate failed, retry $i/6"; \
         sleep 5; \
       done
WORKDIR /app

# Set production environment and build optimizations
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SHARP=1
ENV DISABLE_FONT_OPTIMIZATION=1

# Build applications. Next's build cache lives in a BuildKit cache mount (faster
# rebuilds, never shipped), and the unused standalone bundle is dropped: the server
# runs through the custom server.js with `next()`, not .next/standalone.
RUN --mount=type=cache,target=/app/apps/server/.next/cache \
    --mount=type=cache,target=/app/apps/web/.next/cache \
    npm run build \
    && rm -rf /app/apps/server/.next/standalone

# Production stage - use NVIDIA-enabled FFmpeg base (following TwentyFourSeven pattern)
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# DEPS_REFRESH: CI passes the ISO week so apt picks up security fixes weekly; empty locally.
ARG DEPS_REFRESH=
# Install system dependencies, Nginx, and Debian ffmpeg with VAAPI like ESPG
RUN echo "deps refresh: ${DEPS_REFRESH:-none}" && apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y \
    curl \
    wget \
    nginx \
    ca-certificates \
    ffmpeg \
    vainfo \
    libva2 \
    libva-drm2 \
    mesa-va-drivers \
    pciutils usbutils \
    && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
         apt-get install -y intel-media-va-driver; \
       fi \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && test -x /usr/bin/ffmpeg \
    && test -x /usr/sbin/nginx \
    && test -x /usr/bin/curl \
    # Create user and groups following Plex/Unraid best practices (abc user pattern)
    && { groupadd --gid 100 users || true; } \
    && useradd --uid 99 --gid users --shell /bin/bash --create-home abc \
    # Add abc user to video and render groups for GPU access
    && usermod -a -G video abc \
    && { usermod -a -G render abc || true; } \
    # Create necessary directories
    && mkdir -p /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx \
    && mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /var/lib/nginx/tmp/fastcgi /var/lib/nginx/tmp/uwsgi /var/lib/nginx/tmp/scgi \
    # Set proper ownership
    && chown -R abc:users /app/database /app/static \
    # Ensure GPU device access permissions
    && mkdir -p /dev/dri

# ffmpeg is installed via Debian package and available at /usr/bin/ffmpeg and /usr/bin/ffprobe

# yt-dlp (standalone build, no Python needed) for Settings > YouTube channels.
# A failed download only disables that feature; it never fails the image build.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    || echo "WARNING: yt-dlp not installed; YouTube channels will report it as missing"

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

# Verify ffmpeg is installed and check for common hardware accel encoders
RUN echo "🔍 Checking ffmpeg installation..." \
    && /usr/bin/ffmpeg -version \
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

# App build output last: these are the only layers a normal code update changes.
# Copy built applications with proper ownership (abc user like Plex)
COPY --from=builder --chown=abc:users /app/apps/web/out ./apps/web/out
COPY --from=builder --chown=abc:users /app/apps/server/.next ./apps/server/.next
COPY --from=builder --chown=abc:users /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=abc:users /app/apps/server/package.json ./apps/server/package.json

# Copy prisma files
COPY --from=builder --chown=abc:users /app/apps/server/prisma ./apps/server/prisma

# Copy server.js (required for running the server)
COPY --from=builder --chown=abc:users /app/apps/server/server.js ./apps/server/server.js
COPY --from=builder --chown=abc:users /app/apps/server/socket-auth.js ./apps/server/socket-auth.js

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
# Build info from CI, declared last so it never invalidates cached layers above.
# Unset locally -> the app shows "dev".
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=
# Written into the image, not ENV: Unraid's update copies the old container's
# environment onto the new one, so an env-stamped version would go stale.
RUN printf '{"version":"%s","revision":"%s","build_date":"%s"}\n' "${APP_VERSION}" "${GIT_SHA}" "${BUILD_DATE}" > /app/build-info.json
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENTRYPOINT []
CMD ["/app/start.sh"] 