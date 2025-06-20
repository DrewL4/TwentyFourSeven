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

# Production stage - use NVIDIA-enabled FFmpeg base (following TwentyFourSeven pattern)
FROM jrottenberg/ffmpeg:4.4-nvidia2004 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Node.js and other dependencies on the NVIDIA FFmpeg base
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    nginx \
    # Node.js 20.x
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    # GPU utilities
    && apt-get install -y pciutils usbutils \
    # Clean up
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

# Link ffmpeg to standard location (TwentyFourSeven pattern)
RUN ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg \
    && ln -sf /usr/local/bin/ffprobe /usr/bin/ffprobe

# Copy package files for production install
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY turbo.json ./

# Install only production dependencies
RUN npm ci --only=production --prefer-offline --no-audit --progress=false && \
    npm cache clean --force

# Copy built applications with proper ownership (abc user like Plex)
COPY --from=builder --chown=abc:users /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=abc:users /app/apps/server/.next ./apps/server/.next
COPY --from=builder --chown=abc:users /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=abc:users /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=abc:users /app/apps/server/package.json ./apps/server/package.json

# Copy prisma files
COPY --from=builder --chown=abc:users /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder --chown=abc:users /app/apps/server/prisma.config.ts ./apps/server/

# Verify NVENC support is available (should be built into the NVIDIA base image)
RUN echo "🔍 Checking NVENC support in NVIDIA FFmpeg base image..." \
    && /usr/local/bin/ffmpeg -encoders 2>/dev/null | grep nvenc || \
    (echo "⚠️  NVENC encoders not found - this may indicate NVIDIA runtime issues" && \
     /usr/local/bin/ffmpeg -encoders 2>/dev/null | head -20)

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

# Ensure abc user owns all app directories
RUN chown -R abc:users /app

# Set hardware acceleration environment variables (TwentyFourSeven pattern)
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV HARDWARE_ACCEL_DEVICE=/dev/nvidia0
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe
# Set PUID/PGID like Plex for Unraid compatibility
ENV PUID=99
ENV PGID=100

# Run as root to allow nginx to bind to port 80 and write PID files
# Individual applications will drop privileges as needed
# USER abc

# Expose ports
EXPOSE 80 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Override the NVIDIA FFmpeg base image entrypoint and set our own command
ENTRYPOINT []
CMD ["/app/start.sh"] 