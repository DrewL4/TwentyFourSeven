#!/bin/sh

# Exit on any error and print commands
set -ex

echo "=== Starting TwentyFourSeven Production Deployment ==="
echo "Current user: $(whoami)"
echo "Working directory: $(pwd)"
echo "Environment: NODE_ENV=$NODE_ENV"

# GPU Detection
echo "=== GPU Detection ==="
if [ "$GPU_DETECTION_ENABLED" = "true" ]; then
    # Check for NVIDIA GPUs using multiple methods
    if [ -n "$NVIDIA_VISIBLE_DEVICES" ] && [ "$NVIDIA_VISIBLE_DEVICES" != "none" ]; then
        echo "🎮 NVIDIA GPUs configured: $NVIDIA_VISIBLE_DEVICES"
        echo "🚀 NVIDIA Driver capabilities: ${NVIDIA_DRIVER_CAPABILITIES:-compute,utility,video}"
        
        # Try to detect GPU info from /proc or /sys
        if [ -d "/proc/driver/nvidia" ]; then
            echo "✅ NVIDIA driver detected in container"
            if [ -f "/proc/driver/nvidia/version" ]; then
                echo "📋 NVIDIA Driver info:"
                cat /proc/driver/nvidia/version 2>/dev/null || echo "   Driver version info not accessible"
            fi
        else
            echo "⚠️  NVIDIA driver not detected in container (this may be normal)"
        fi
        
        # Check for GPU devices
        if [ -d "/dev" ]; then
            GPU_DEVICES=$(ls /dev/nvidia* 2>/dev/null | wc -l)
            if [ "$GPU_DEVICES" -gt 0 ]; then
                echo "🔧 NVIDIA devices found: $GPU_DEVICES"
                ls -la /dev/nvidia* 2>/dev/null || true
            else
                echo "⚠️  No NVIDIA devices found in /dev (check --runtime=nvidia)"
            fi
        fi
        
        export HARDWARE_ACCELERATION_AVAILABLE="true"
    else
        echo "❌ NVIDIA GPUs not configured (NVIDIA_VISIBLE_DEVICES not set)"
        export HARDWARE_ACCELERATION_AVAILABLE="false"
    fi
    
    # Check for Intel/AMD GPUs
    if [ -d "/dev/dri" ]; then
        DRI_DEVICES=$(ls /dev/dri/render* 2>/dev/null | wc -l)
        if [ "$DRI_DEVICES" -gt 0 ]; then
            echo "🎮 Intel/AMD GPU devices found: $DRI_DEVICES"
            ls -la /dev/dri/ 2>/dev/null || true
            export HARDWARE_ACCELERATION_AVAILABLE="true"
        fi
    fi
else
    echo "🔇 GPU detection disabled"
    export HARDWARE_ACCELERATION_AVAILABLE="false"
fi

echo "🎯 Hardware acceleration: ${HARDWARE_ACCELERATION_AVAILABLE:-false}"

# Set default environment variables if not provided
export PORT=${PORT:-3000}
export WEB_PORT=${WEB_PORT:-3001}
export DATABASE_URL=${DATABASE_URL:-"file:/app/database/production.db"}
export BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-"$(openssl rand -hex 32)"}

# Detect external HTTP port for nginx proxy
# If EXTERNAL_HTTP_PORT is set, use it for all URLs (for Unraid/Docker users)
# Otherwise, fall back to direct port access for development
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"http://localhost:${EXTERNAL_HTTP_PORT}"}
    
    # Set up trusted origins - allow user to override via TRUSTED_ORIGINS env var
    # If not set, provide basic localhost defaults (users should set TRUSTED_ORIGINS for their network)
    if [ -z "$TRUSTED_ORIGINS" ]; then
        # Basic defaults - users should set TRUSTED_ORIGINS environment variable
        # with their specific server IP, e.g., TRUSTED_ORIGINS="http://localhost:8097,http://192.168.1.7:8097"
        export TRUSTED_ORIGINS="http://localhost:${EXTERNAL_HTTP_PORT},http://127.0.0.1:${EXTERNAL_HTTP_PORT}"
        echo "⚠️  WARNING: Using default trusted origins. For external access, set TRUSTED_ORIGINS environment variable."
        echo "   Example: TRUSTED_ORIGINS=\"http://localhost:${EXTERNAL_HTTP_PORT},http://YOUR_SERVER_IP:${EXTERNAL_HTTP_PORT}\""
    fi
else
    # Fallback for development/direct access
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:${PORT}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:${WEB_PORT}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"http://localhost:${PORT}"}
    
    # Set up trusted origins - allow user to override via TRUSTED_ORIGINS env var even for npm/development
    if [ -z "$TRUSTED_ORIGINS" ]; then
        # Default for development/npm proxy
        export TRUSTED_ORIGINS="http://localhost:${PORT},http://localhost:${WEB_PORT}"
        echo "💡 TIP: For external access (npm proxy, reverse proxy, etc.), set TRUSTED_ORIGINS environment variable."
        echo "   Example: TRUSTED_ORIGINS=\"http://localhost:${PORT},http://YOUR_DOMAIN:YOUR_PORT\""
    fi
fi

echo "=== Configuration ==="
echo "Database: ${DATABASE_URL}"
echo "Server port: ${PORT}"
echo "Web port: ${WEB_PORT}"
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
NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-}
NVIDIA_DRIVER_CAPABILITIES=${NVIDIA_DRIVER_CAPABILITIES:-}
EOF

# Web environment
cat > /app/apps/web/.env << EOF
NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
PORT=${WEB_PORT}
NODE_ENV=production
EOF

echo "Environment files created successfully"

# Initialize database (preserve existing data)
echo "=== Initializing database ==="
cd /app/apps/server

echo "Generating Prisma client..."
npx prisma generate || {
    echo "Prisma generate failed, trying with explicit schema path..."
    npx prisma generate --schema=./prisma/schema || {
        echo "Prisma generate failed completely. Continuing without database..."
    }
}

echo "Setting up database (preserving existing data)..."
# Check if database exists and has data
if [ -f "/app/database/production.db" ] && [ -s "/app/database/production.db" ]; then
    echo "Existing database found, running migration to update schema..."
    npx prisma db push || {
        echo "Database migration failed. Continuing with existing database..."
    }
else
    echo "No existing database found, creating fresh database..."
    npx prisma db push || {
        echo "Database setup failed. Continuing without database..."
    }
fi

cd /app

# Test nginx configuration
echo "=== Testing nginx configuration ==="
nginx -t 2>&1 || {
    echo "Nginx test failed! Checking configuration..."
    cat /etc/nginx/nginx.conf
    exit 1
}

# Function to cleanup background processes
cleanup() {
    echo "=== Shutting down ==="
    kill $SERVER_PID $WEB_PID $NGINX_PID 2>/dev/null || true
    nginx -s quit 2>/dev/null || true
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup TERM INT

# Start nginx
echo "=== Starting nginx ==="
nginx 2>&1 &
NGINX_PID=$!
echo "Nginx started with PID: $NGINX_PID"

# Wait for nginx to start
sleep 2

# Start server in background
echo "=== Starting server on port ${PORT} ==="
cd /app/apps/server
npm start 2>&1 &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

# Wait for server to start
sleep 5

# Start web application in background
echo "=== Starting web application on port ${WEB_PORT} ==="
cd /app/apps/web
PORT=${WEB_PORT} npm start 2>&1 &
WEB_PID=$!
echo "Web application started with PID: $WEB_PID"

echo "=== All services started successfully! ==="

# Show appropriate access URLs based on configuration
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    echo "🌐 TwentyFourSeven is available at: http://localhost:${EXTERNAL_HTTP_PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:${EXTERNAL_HTTP_PORT}/files/"
    echo "🔧 All services are proxied through nginx for optimal performance"
elif [ -n "$EXTERNAL_NGINX_PORT" ]; then
    echo "🌐 Nginx proxy available at: http://localhost:${EXTERNAL_NGINX_PORT}"
    echo "🖥️  Web application available at: http://localhost:${EXTERNAL_WEB_PORT}"
    echo "🔌 Server API available at: http://localhost:${EXTERNAL_SERVER_PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:${EXTERNAL_NGINX_PORT}/files/"
else
    echo "🖥️  Web application available at: http://localhost:${WEB_PORT}"
    echo "🔌 Server API available at: http://localhost:${PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:80/files/"
fi

echo "=== Monitoring services ==="
# Keep the container running and wait for both processes
wait 