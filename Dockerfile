# ---------- BASE IMAGE (Debian) ----------
# Use Debian-based Node image so the final layer is glibc-based (required for CUDA libs)
FROM node:20-bookworm AS base

# ---------- FFMPEG BUILD STAGE (NVENC) ----------
FROM nvidia/cuda:12.5.0-devel-ubuntu22.04 AS ffmpeg-builder

# Build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config git curl ca-certificates \
    yasm nasm ninja-build meson \
    libdrm-dev libssl-dev libfreetype6-dev libass-dev \
    libx264-dev libx265-dev libvpx-dev libopus-dev libfdk-aac-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/FFmpeg/FFmpeg.git ffmpeg
WORKDIR /src/ffmpeg

# Configure & compile FFmpeg with NVENC support
RUN ./configure \
      --prefix=/opt/ffmpeg \
      --pkg-config-flags="--static" \
      --extra-cflags="-I/usr/local/cuda/include" \
      --extra-ldflags="-L/usr/local/cuda/lib64" \
      --enable-cuda-nvcc --enable-cuvid --enable-nvenc --enable-libdrm \
      --enable-libx264 --enable-libx265 --enable-libvpx \
      --enable-libfdk-aac --enable-libopus --enable-libass --enable-libfreetype \
      --enable-gpl --enable-nonfree --enable-version3 && \
    make -j$(nproc) && make install && \
    strip /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe

# Build stage - install and build in one stage
FROM base AS builder
WORKDIR /app

# Install system dependencies and enable corepack (Debian)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
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

# Install system dependencies and GPU utilities (Debian)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl openssl nginx pciutils udev python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    # Copy NVENC-enabled FFmpeg from build stage
    true

# Copy NVENC-enabled ffmpeg and ffprobe
COPY --from=ffmpeg-builder /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-builder /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe

# Make sure they're executable
RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
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