#!/bin/bash

# Print commands but don't exit on errors during GPU/FFMPEG detection
set -x

echo "=== Starting TwentyFourSeven Production Deployment ==="
echo "Current user: $(whoami)"
echo "Working directory: $(pwd)"
echo "Environment: NODE_ENV=$NODE_ENV"
echo "PUID: ${PUID:-99}, PGID: ${PGID:-100}"

# Run GPU permissions setup (TwentyFourSeven-style simplified)
echo "=== Setting up GPU permissions ==="
/app/init-gpu-permissions.sh

# Hardware Acceleration and GPU Detection (TwentyFourSeven-style simplified)
echo "=== Hardware Acceleration & GPU Detection ==="

# Set default values
export HARDWARE_ACCELERATION_AVAILABLE="false"
export GPU_VENDOR="none"
export GPU_DEVICE_COUNT=0
export FFMPEG_HWACCEL_METHOD="cpu"

if [ "$GPU_DETECTION_ENABLED" != "false" ]; then
    echo "🔍 Starting GPU detection (TwentyFourSeven-style)..."
    
    # NVIDIA GPU Detection (TwentyFourSeven pattern - simplified)
    echo "--- NVIDIA GPU Detection ---"
    echo "🔍 NVIDIA_VISIBLE_DEVICES: '$NVIDIA_VISIBLE_DEVICES'"
    echo "🔍 NVIDIA_DRIVER_CAPABILITIES: '$NVIDIA_DRIVER_CAPABILITIES'"
    
    # Check if NVIDIA runtime is working by looking for nvidia-smi
    if command -v nvidia-smi >/dev/null 2>&1; then
        echo "✅ nvidia-smi found - NVIDIA runtime is working"
        
        # Get GPU information
        echo "📋 GPU Information:"
        nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || echo "   nvidia-smi query failed"
        
        # Check for NVIDIA devices
        if ls /dev/nvidia* >/dev/null 2>&1; then
            NVIDIA_DEVICE_COUNT=$(ls /dev/nvidia* 2>/dev/null | wc -l)
            echo "🎮 NVIDIA devices found: $NVIDIA_DEVICE_COUNT"
            ls -la /dev/nvidia* 2>/dev/null || true
            
            export HARDWARE_ACCELERATION_AVAILABLE="true"
            export GPU_VENDOR="nvidia"
            export GPU_DEVICE_COUNT="$NVIDIA_DEVICE_COUNT"
            export HARDWARE_ACCEL_DEVICE="/dev/nvidia0"
            echo "✅ NVIDIA GPU detection successful"
        else
            echo "⚠️  nvidia-smi available but no /dev/nvidia* devices found"
        fi
    else
        echo "⚠️  nvidia-smi not available - NVIDIA runtime not working"
        echo "💡 Ensure container is started with --runtime=nvidia"
    fi
    
    # Intel/AMD GPU Detection (only if NVIDIA failed)
    if [ "$GPU_VENDOR" != "nvidia" ] && [ -d "/dev/dri" ]; then
        echo "--- Intel/AMD GPU Detection ---"
        RENDER_NODES=$(ls /dev/dri/render* 2>/dev/null | wc -l || echo "0")
        
        if [ "$RENDER_NODES" -gt 0 ]; then
            echo "🎮 Intel/AMD GPU devices found: $RENDER_NODES render nodes"
            ls -la /dev/dri/ 2>/dev/null || true
            
            export HARDWARE_ACCELERATION_AVAILABLE="true"
            export GPU_VENDOR="intel_amd"
            export GPU_DEVICE_COUNT="$RENDER_NODES"
            export HARDWARE_ACCEL_DEVICE="/dev/dri/renderD128"
            echo "✅ Intel/AMD GPU detection successful"
        else
            echo "❌ No Intel/AMD GPU render nodes found"
        fi
    fi
    
else
    echo "🔇 GPU detection disabled (GPU_DETECTION_ENABLED=false)"
fi

echo "🔍 Final GPU detection results:"
echo "   GPU_VENDOR: ${GPU_VENDOR}"
echo "   HARDWARE_ACCELERATION_AVAILABLE: ${HARDWARE_ACCELERATION_AVAILABLE}"
echo "   GPU_DEVICE_COUNT: ${GPU_DEVICE_COUNT}"
echo "   HARDWARE_ACCEL_DEVICE: ${HARDWARE_ACCEL_DEVICE}"

# FFMPEG Configuration and Testing (TwentyFourSeven-style simplified)
echo "=== FFMPEG Configuration ==="

# Set FFMPEG paths
export FFMPEG_PATH="${FFMPEG_PATH:-/usr/local/bin/ffmpeg}"
export FFPROBE_PATH="${FFPROBE_PATH:-/usr/local/bin/ffprobe}"

echo "📹 FFMPEG path: $FFMPEG_PATH"
echo "🔍 FFPROBE path: $FFPROBE_PATH"

if [ -x "$FFMPEG_PATH" ]; then
    echo "✅ FFMPEG executable found"
    
    # Show FFMPEG version
    echo "📋 FFMPEG version:"
    $FFMPEG_PATH -version 2>/dev/null | head -1 || echo "Could not get FFMPEG version"
    
    # Test hardware acceleration based on detected GPU
    if [ "$GPU_VENDOR" = "nvidia" ]; then
        echo "🧪 Testing NVIDIA NVENC support..."
        if $FFMPEG_PATH -encoders 2>/dev/null | grep -q nvenc; then
            echo "✅ NVENC encoders available"
            export FFMPEG_HWACCEL_METHOD="nvenc"
        else
            echo "⚠️  NVENC encoders not available"
            export FFMPEG_HWACCEL_METHOD="cpu"
        fi
    elif [ "$GPU_VENDOR" = "intel_amd" ]; then
        echo "🧪 Testing VAAPI support..."
        if $FFMPEG_PATH -encoders 2>/dev/null | grep -q vaapi; then
            echo "✅ VAAPI encoders available"
            export FFMPEG_HWACCEL_METHOD="vaapi"
        else
            echo "⚠️  VAAPI encoders not available"
            export FFMPEG_HWACCEL_METHOD="cpu"
        fi
    else
        export FFMPEG_HWACCEL_METHOD="cpu"
    fi
else
    echo "❌ FFMPEG not found at $FFMPEG_PATH"
    export HARDWARE_ACCELERATION_AVAILABLE="false"
    export FFMPEG_HWACCEL_METHOD="none"
fi

# Summary
echo "=== Hardware Acceleration Summary ==="
echo "🎯 Hardware acceleration available: ${HARDWARE_ACCELERATION_AVAILABLE}"
echo "🎮 GPU vendor: ${GPU_VENDOR}"
echo "🔢 GPU device count: ${GPU_DEVICE_COUNT}"
echo "🛠️  FFMPEG method: ${FFMPEG_HWACCEL_METHOD:-none}"

# Re-enable strict error handling for the rest of the script
set -e

# Set default environment variables if not provided
export PORT=${PORT:-3000}
export DATABASE_URL=${DATABASE_URL:-"file:/app/database/production.db"}
export BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-"$(openssl rand -hex 32)"}

# Handle external domain configuration (for Nginx Proxy Manager and reverse proxies)
if [ -n "$EXTERNAL_DOMAIN" ]; then
    # External domain provided (e.g., 247.midweststreams.us)
    EXTERNAL_PROTOCOL=${EXTERNAL_PROTOCOL:-"https"}
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"${EXTERNAL_PROTOCOL}://${EXTERNAL_DOMAIN}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"${EXTERNAL_PROTOCOL}://${EXTERNAL_DOMAIN}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"${EXTERNAL_PROTOCOL}://${EXTERNAL_DOMAIN}"}
    
    if [ -z "$TRUSTED_ORIGINS" ]; then
        export TRUSTED_ORIGINS="${EXTERNAL_PROTOCOL}://${EXTERNAL_DOMAIN},http://localhost:${PORT}"
    fi
    echo "🌐 External domain configured: ${EXTERNAL_DOMAIN}"
elif [ -n "$EXTERNAL_HTTP_PORT" ]; then
    # External HTTP port provided (for local access)
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    
    if [ -z "$TRUSTED_ORIGINS" ]; then
        export TRUSTED_ORIGINS="http://localhost:${EXTERNAL_HTTP_PORT},http://127.0.0.1:${EXTERNAL_HTTP_PORT}"
        echo "⚠️  WARNING: Using default trusted origins. For external access, set TRUSTED_ORIGINS environment variable."
        echo "   Example: TRUSTED_ORIGINS=\"http://localhost:${EXTERNAL_HTTP_PORT},http://YOUR_SERVER_IP:${EXTERNAL_HTTP_PORT}\""
    fi
else
    # Default local configuration
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:${PORT}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:${PORT}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"http://localhost:${PORT}"}
    
    if [ -z "$TRUSTED_ORIGINS" ]; then
        export TRUSTED_ORIGINS="http://localhost:${PORT}"
        echo "💡 TIP: For external access, set TRUSTED_ORIGINS environment variable."
    fi
fi

echo "=== Configuration ==="
echo "Database: ${DATABASE_URL}"
echo "Server port: ${PORT}"
echo "Web: static export via nginx (root /app/apps/web/out)"
echo "Auth URL: ${BETTER_AUTH_URL}"
echo "Trusted origins: ${TRUSTED_ORIGINS}"
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    echo "External port: ${EXTERNAL_HTTP_PORT}"
    echo ""
    echo "💡 TIP: If you get 'Invalid origin' errors when accessing from other devices,"
    echo "   set the TRUSTED_ORIGINS environment variable in your Docker configuration:"
    echo "   TRUSTED_ORIGINS=\"http://localhost:${EXTERNAL_HTTP_PORT},http://YOUR_SERVER_IP:${EXTERNAL_HTTP_PORT}\""
fi

# Ensure directories exist
echo "=== Setting up directories ==="
mkdir -p /app/database /app/static
ls -la /app/database/

# Create production environment files
echo "=== Setting up environment files ==="

# Server environment
cat > /app/apps/server/.env << EOF
PORT=${PORT}
DATABASE_URL=${DATABASE_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
CORS_ORIGIN=${CORS_ORIGIN}
TRUSTED_ORIGINS=${TRUSTED_ORIGINS}
NODE_ENV=production
GPU_DETECTION_ENABLED=${GPU_DETECTION_ENABLED:-true}
HARDWARE_ACCELERATION_AVAILABLE=${HARDWARE_ACCELERATION_AVAILABLE:-false}
GPU_VENDOR=${GPU_VENDOR:-none}
GPU_DEVICE_COUNT=${GPU_DEVICE_COUNT:-0}
FFMPEG_HWACCEL_METHOD=${FFMPEG_HWACCEL_METHOD:-none}
FFMPEG_PATH=${FFMPEG_PATH}
FFPROBE_PATH=${FFPROBE_PATH}
HARDWARE_ACCEL_DEVICE=${HARDWARE_ACCEL_DEVICE}
XMLTV_STATIC_PATH=/app/static/xmltv.cached.xml
NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-}
NVIDIA_DRIVER_CAPABILITIES=${NVIDIA_DRIVER_CAPABILITIES:-}
PUID=${PUID:-99}
PGID=${PGID:-100}
EOF

echo "Environment files created successfully"

# Initialize database (preserve existing data)
echo "=== Initializing database ==="
cd /app/apps/server

echo "Generating Prisma client..."
npx prisma generate --schema ./prisma/schema

echo "Setting up database (preserving existing data)..."
if [ -f "/app/database/production.db" ] && [ -s "/app/database/production.db" ]; then
    echo "Existing database found, running migration to update schema..."
    npx prisma db push --schema ./prisma/schema
else
    echo "No existing database found, creating new database..."
    npx prisma db push --schema ./prisma/schema
fi

cd /app

# Set up cleanup function
cleanup() {
    echo "=== Shutting down services ==="
    if [ -n "$NGINX_PID" ] && kill -0 $NGINX_PID 2>/dev/null; then
        echo "Stopping nginx (PID: $NGINX_PID)"
        kill $NGINX_PID
    fi
    if [ -n "$SERVER_PID" ] && kill -0 $SERVER_PID 2>/dev/null; then
        echo "Stopping server (PID: $SERVER_PID)"
        kill $SERVER_PID
    fi
    echo "=== Cleanup complete ==="
}

trap cleanup TERM INT

echo "=== Starting nginx ==="
nginx &
NGINX_PID=$!
echo "Nginx started with PID: $NGINX_PID"
sleep 2

echo "=== Starting server on port 3000 ==="
cd /app/apps/server
npm start &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"
sleep 5

echo "=== All services started successfully! ==="
echo "Static web UI served by nginx from /app/apps/web/out"

# Show access information
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    echo "🌐 TwentyFourSeven is available at: http://localhost:${EXTERNAL_HTTP_PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:${EXTERNAL_HTTP_PORT}/files/"
    echo "🔧 All services are proxied through nginx for optimal performance"
fi

# Show hardware acceleration status
if [ "$ENABLE_HARDWARE_ACCEL" = "true" ]; then
    echo ""
    echo "🚀 Hardware Acceleration Status: ENABLED"
    echo "   GPU Vendor: ${GPU_VENDOR}"
    echo "   Method: ${FFMPEG_HWACCEL_METHOD}"
    echo "   Device: ${HARDWARE_ACCEL_DEVICE}"
    if command -v nvidia-smi >/dev/null 2>&1; then
        echo "   nvidia-smi: Available"
    else
        echo "   nvidia-smi: Not available"
    fi
    echo "   🔧 Device permissions: Handled by init script"
fi

echo "=== Monitoring services ==="
wait 