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

# Install system dependencies and GPU utilities (Alpine compatible)
RUN apk add --no-cache \
    curl \
    openssl \
    nginx \
    wget \
    # GPU detection and hardware utilities
    pciutils \
    udev \
    # Video libraries available in Alpine
    mesa-dri-gallium \
    mesa-va-gallium \
    # Build tools for potential native modules
    build-base \
    python3 && \
    # Install enhanced ffmpeg with hardware acceleration support
    wget -O /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" && \
    cd /tmp && \
    tar xf ffmpeg.tar.xz && \
    cp ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    cp ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
    # Verify ffmpeg installation and show capabilities
    /usr/local/bin/ffmpeg -version && \
    # Clean up
    rm -rf /tmp/ffmpeg* && \
    # Create user and groups following Plex/Unraid best practices (abc user pattern)
    # Check if users group exists, create if not
    (getent group users || addgroup --system --gid 100 users) && \
    adduser --system --uid 99 --ingroup users --shell /bin/sh abc && \
    # Create video group (GID 44 like Ubuntu/Plex) and render group (GID 104-109 common range)
    addgroup --system --gid 44 video || true && \
    addgroup --system --gid 104 render || true && \
    # Add abc user to video and render groups for GPU access (following Plex abc user pattern)
    addgroup abc video && \
    addgroup abc render && \
    # Create necessary directories with proper permissions
    mkdir -p /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx && \
    mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /var/lib/nginx/tmp/fastcgi /var/lib/nginx/tmp/uwsgi /var/lib/nginx/tmp/scgi && \
    # Set proper ownership (following Plex pattern with abc user)
    chown -R abc:users /app/database /app/static /var/log/nginx /var/lib/nginx /run/nginx && \
    # Ensure GPU device access permissions (will be handled at runtime by NVIDIA/DRI)
    mkdir -p /dev/dri && \
    corepack enable

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

# Copy nginx configuration
COPY --chown=abc:users nginx.conf /etc/nginx/nginx.conf

# Copy and make start script executable
COPY --chown=abc:users start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create GPU device permission script (mimics Plex init-plex-gid-video)
RUN echo '#!/bin/sh' > /app/init-gpu-permissions.sh && \
    echo '# GPU Device Permission Handler (following Plex init-plex-gid-video pattern)' >> /app/init-gpu-permissions.sh && \
    echo 'echo "🔧 Setting up GPU device permissions..."' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo '# Handle DRI devices (Intel/AMD GPUs)' >> /app/init-gpu-permissions.sh && \
    echo 'if [ -d "/dev/dri" ]; then' >> /app/init-gpu-permissions.sh && \
    echo '    echo "📹 Found /dev/dri - setting up Intel/AMD GPU permissions"' >> /app/init-gpu-permissions.sh && \
    echo '    for device in /dev/dri/*; do' >> /app/init-gpu-permissions.sh && \
    echo '        if [ -c "$device" ]; then' >> /app/init-gpu-permissions.sh && \
    echo '            # Get current group of the device' >> /app/init-gpu-permissions.sh && \
    echo '            DEVICE_GROUP=$(stat -c "%g" "$device")' >> /app/init-gpu-permissions.sh && \
    echo '            DEVICE_NAME=$(basename "$device")' >> /app/init-gpu-permissions.sh && \
    echo '            echo "  Device: $DEVICE_NAME (group: $DEVICE_GROUP)"' >> /app/init-gpu-permissions.sh && \
    echo '            ' >> /app/init-gpu-permissions.sh && \
    echo '            # Create group if it does not exist and add abc user' >> /app/init-gpu-permissions.sh && \
    echo '            if ! getent group "$DEVICE_GROUP" >/dev/null 2>&1; then' >> /app/init-gpu-permissions.sh && \
    echo '                addgroup --gid "$DEVICE_GROUP" "device_${DEVICE_GROUP}" || true' >> /app/init-gpu-permissions.sh && \
    echo '                echo "  Created group device_${DEVICE_GROUP} (GID: $DEVICE_GROUP)"' >> /app/init-gpu-permissions.sh && \
    echo '            fi' >> /app/init-gpu-permissions.sh && \
    echo '            ' >> /app/init-gpu-permissions.sh && \
    echo '            # Add abc user to the device group' >> /app/init-gpu-permissions.sh && \
    echo '            GROUP_NAME=$(getent group "$DEVICE_GROUP" | cut -d: -f1)' >> /app/init-gpu-permissions.sh && \
    echo '            addgroup abc "$GROUP_NAME" 2>/dev/null || true' >> /app/init-gpu-permissions.sh && \
    echo '            echo "  Added abc user to group: $GROUP_NAME"' >> /app/init-gpu-permissions.sh && \
    echo '        fi' >> /app/init-gpu-permissions.sh && \
    echo '    done' >> /app/init-gpu-permissions.sh && \
    echo 'else' >> /app/init-gpu-permissions.sh && \
    echo '    echo "ℹ️  No /dev/dri found - Intel/AMD GPU acceleration not available"' >> /app/init-gpu-permissions.sh && \
    echo 'fi' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo '# Handle NVIDIA devices' >> /app/init-gpu-permissions.sh && \
    echo 'if [ -d "/dev" ] && ls /dev/nvidia* >/dev/null 2>&1; then' >> /app/init-gpu-permissions.sh && \
    echo '    echo "🎮 Found NVIDIA devices - setting up NVIDIA GPU permissions"' >> /app/init-gpu-permissions.sh && \
    echo '    for device in /dev/nvidia*; do' >> /app/init-gpu-permissions.sh && \
    echo '        if [ -c "$device" ]; then' >> /app/init-gpu-permissions.sh && \
    echo '            DEVICE_GROUP=$(stat -c "%g" "$device")' >> /app/init-gpu-permissions.sh && \
    echo '            DEVICE_NAME=$(basename "$device")' >> /app/init-gpu-permissions.sh && \
    echo '            echo "  Device: $DEVICE_NAME (group: $DEVICE_GROUP)"' >> /app/init-gpu-permissions.sh && \
    echo '            ' >> /app/init-gpu-permissions.sh && \
    echo '            # NVIDIA devices are usually accessible by default via runtime' >> /app/init-gpu-permissions.sh && \
    echo '            # but we ensure abc user has access if needed' >> /app/init-gpu-permissions.sh && \
    echo '            if ! getent group "$DEVICE_GROUP" >/dev/null 2>&1; then' >> /app/init-gpu-permissions.sh && \
    echo '                addgroup --gid "$DEVICE_GROUP" "nvidia_${DEVICE_GROUP}" || true' >> /app/init-gpu-permissions.sh && \
    echo '            fi' >> /app/init-gpu-permissions.sh && \
    echo '            GROUP_NAME=$(getent group "$DEVICE_GROUP" | cut -d: -f1)' >> /app/init-gpu-permissions.sh && \
    echo '            addgroup abc "$GROUP_NAME" 2>/dev/null || true' >> /app/init-gpu-permissions.sh && \
    echo '        fi' >> /app/init-gpu-permissions.sh && \
    echo '    done' >> /app/init-gpu-permissions.sh && \
    echo 'else' >> /app/init-gpu-permissions.sh && \
    echo '    echo "ℹ️  No NVIDIA devices found - NVIDIA GPU acceleration not available"' >> /app/init-gpu-permissions.sh && \
    echo 'fi' >> /app/init-gpu-permissions.sh && \
    echo '' >> /app/init-gpu-permissions.sh && \
    echo 'echo "✅ GPU device permissions setup complete"' >> /app/init-gpu-permissions.sh && \
    chmod +x /app/init-gpu-permissions.sh

# Ensure abc user owns all app directories (following Plex pattern)
RUN chown -R abc:users /app

# Set hardware acceleration environment variables (following Plex defaults)
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
ENV HARDWARE_ACCEL_DEVICE=/dev/dri/renderD128
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe
# Set PUID/PGID like Plex for Unraid compatibility
ENV PUID=99
ENV PGID=100

USER abc

# Expose ports (following Plex pattern - main port + additional if needed)
EXPOSE 80 3000 3001

# Health check with better error handling
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || curl -f http://localhost:3000/ || exit 1

# Start with better error handling and GPU initialization
CMD ["/bin/sh", "-c", "echo 'Starting TwentyFourSeven with Hardware Acceleration...' && /app/init-gpu-permissions.sh && /app/start.sh"] 