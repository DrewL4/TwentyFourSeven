#!/bin/sh

# Print commands but don't exit on errors during GPU/FFMPEG detection
set -x

echo "=== Starting TwentyFourSeven Production Deployment ==="
echo "Current user: $(whoami)"
echo "Working directory: $(pwd)"
echo "Environment: NODE_ENV=$NODE_ENV"
echo "PUID: ${PUID:-99}, PGID: ${PGID:-100}"

# Hardware Acceleration and GPU Detection (Enhanced following Plex patterns)
echo "=== Hardware Acceleration & GPU Detection ==="

# Set default values
export HARDWARE_ACCELERATION_AVAILABLE="false"
export GPU_VENDOR="none"
export GPU_DEVICE_COUNT=0
export FFMPEG_HWACCEL_METHOD="cpu"

if [ "$GPU_DETECTION_ENABLED" != "false" ]; then
    echo "🔍 Starting comprehensive GPU detection..."
    
    # NVIDIA GPU Detection (following Plex NVIDIA patterns)
    echo "--- NVIDIA GPU Detection ---"
    if [ -n "$NVIDIA_VISIBLE_DEVICES" ] && [ "$NVIDIA_VISIBLE_DEVICES" != "none" ]; then
        echo "🎮 NVIDIA GPUs configured: $NVIDIA_VISIBLE_DEVICES"
        echo "🚀 NVIDIA Driver capabilities: ${NVIDIA_DRIVER_CAPABILITIES:-compute,utility,video}"
        
        # Check NVIDIA runtime availability (following Plex pattern)
        if [ -d "/proc/driver/nvidia" ]; then
            echo "✅ NVIDIA driver detected in container"
            if [ -f "/proc/driver/nvidia/version" ]; then
                echo "📋 NVIDIA Driver version:"
                cat /proc/driver/nvidia/version 2>/dev/null || echo "   Driver version info not accessible"
            fi
            
            # Test nvidia-smi availability (comes from NVIDIA runtime)
            echo "🧪 Testing nvidia-smi availability..."
            if command -v nvidia-smi > /dev/null 2>&1; then
                echo "✅ nvidia-smi is available"
                nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || echo "   nvidia-smi query failed"
            else
                echo "⚠️  nvidia-smi not available (provided by NVIDIA runtime)"
            fi
            
            # Check for NVIDIA devices (following Plex device detection)
            if [ -d "/dev" ]; then
                NVIDIA_DEVICE_COUNT=$(ls /dev/nvidia* 2>/dev/null | wc -l || echo "0")
                if [ "$NVIDIA_DEVICE_COUNT" -gt 0 ]; then
                    echo "🔧 NVIDIA devices found: $NVIDIA_DEVICE_COUNT"
                    ls -la /dev/nvidia* 2>/dev/null || true
                    export HARDWARE_ACCELERATION_AVAILABLE="true"
                    export GPU_VENDOR="nvidia"
                    export GPU_DEVICE_COUNT="$NVIDIA_DEVICE_COUNT"
                    # Set NVIDIA device path
                    export HARDWARE_ACCEL_DEVICE="/dev/nvidia0"
                else
                    echo "⚠️  No NVIDIA devices found in /dev"
                    echo "💡 Make sure container is started with --runtime=nvidia"
                fi
            fi
        else
            echo "⚠️  NVIDIA driver not detected in container"
            echo "💡 Container may not be running with NVIDIA runtime"
            echo "💡 Ensure: docker run --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all"
        fi
    else
        echo "❌ NVIDIA GPUs not configured (NVIDIA_VISIBLE_DEVICES not set)"
    fi
    
    # Intel/AMD GPU Detection (following Plex DRI patterns)
    echo "--- Intel/AMD GPU Detection ---"
    if [ -d "/dev/dri" ]; then
        # Check for render nodes (following Plex DRI detection)
        RENDER_NODES=$(ls /dev/dri/render* 2>/dev/null | wc -l || echo "0")
        CARD_NODES=$(ls /dev/dri/card* 2>/dev/null | wc -l || echo "0")
        
        if [ "$RENDER_NODES" -gt 0 ] || [ "$CARD_NODES" -gt 0 ]; then
            echo "🎮 Intel/AMD GPU devices found:"
            echo "   Render nodes: $RENDER_NODES"
            echo "   Card nodes: $CARD_NODES"
            ls -la /dev/dri/ 2>/dev/null || true
            
            # Test DRI device access (permissions handled by init-gpu-permissions.sh)
            if [ -c "/dev/dri/renderD128" ]; then
                echo "🧪 Testing DRI device access..."
                if [ -r "/dev/dri/renderD128" ]; then
                    echo "✅ DRI device access confirmed"
                    if [ "$HARDWARE_ACCELERATION_AVAILABLE" != "true" ]; then
                        export HARDWARE_ACCELERATION_AVAILABLE="true"
                        export GPU_VENDOR="intel_amd"
                        export GPU_DEVICE_COUNT="$RENDER_NODES"
                    fi
                else
                    echo "⚠️  DRI device access denied"
                    echo "💡 Permissions should be handled by init script"
                fi
            fi
            
            # Set hardware acceleration device path
            export HARDWARE_ACCEL_DEVICE="${HARDWARE_ACCEL_DEVICE:-/dev/dri/renderD128}"
        else
            echo "❌ No Intel/AMD GPU render nodes found"
        fi
    else
        echo "❌ /dev/dri not available - Intel/AMD GPU acceleration not possible"
        echo "💡 Ensure: docker run --device=/dev/dri:/dev/dri"
    fi
    
else
    echo "🔇 GPU detection disabled (GPU_DETECTION_ENABLED=false)"
fi

# Validate required NVIDIA driver capabilities before proceeding to FFmpeg tests
if [ "$GPU_VENDOR" = "nvidia" ]; then
    # Ensure environment variable is not empty
    NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-}"
    for cap in video compute; do
        if ! echo "$NVIDIA_DRIVER_CAPABILITIES" | tr ',' ' ' | grep -qw "$cap"; then
            echo "⚠️  Required capability '$cap' missing from NVIDIA_DRIVER_CAPABILITIES ($NVIDIA_DRIVER_CAPABILITIES). Continuing in CPU mode."
            CAP_MISSING=true
        fi
    done
    echo "✅ Required NVIDIA driver capabilities present: $NVIDIA_DRIVER_CAPABILITIES"
fi

echo "🔍 DEBUG: About to start FFMPEG configuration..."
echo "🔍 DEBUG: Current GPU_VENDOR: ${GPU_VENDOR}"
echo "🔍 DEBUG: Current HARDWARE_ACCELERATION_AVAILABLE: ${HARDWARE_ACCELERATION_AVAILABLE}"

# FFMPEG Configuration and Testing
echo "=== FFMPEG Configuration ==="

# Set FFMPEG paths
export FFMPEG_PATH="${FFMPEG_PATH:-/usr/local/bin/ffmpeg}"
export FFPROBE_PATH="${FFPROBE_PATH:-/usr/local/bin/ffprobe}"

echo "📹 FFMPEG path: $FFMPEG_PATH"
echo "🔍 FFPROBE path: $FFPROBE_PATH"

# Debug: Check if FFMPEG exists
echo "🔍 Checking FFMPEG installation..."
if [ -f "$FFMPEG_PATH" ]; then
    echo "✅ FFMPEG file exists at $FFMPEG_PATH"
    ls -la "$FFMPEG_PATH"
else
    echo "❌ FFMPEG file not found at $FFMPEG_PATH"
    echo "🔍 Searching for FFMPEG in common locations..."
    which ffmpeg || echo "ffmpeg not found in PATH"
    find /usr -name "ffmpeg" 2>/dev/null || echo "No ffmpeg found in /usr"
fi

# Test FFMPEG installation
echo "🔍 DEBUG: Testing if FFMPEG is executable at: $FFMPEG_PATH"
if [ -x "$FFMPEG_PATH" ]; then
    echo "✅ FFMPEG executable found and accessible"
    
    # Show FFMPEG version and capabilities
    echo "📋 FFMPEG version:"
    $FFMPEG_PATH -version 2>/dev/null | head -1 || echo "Could not get FFMPEG version"
    
    # Test hardware acceleration capabilities
    echo "🧪 Testing FFMPEG hardware acceleration..."
    
    if [ "$GPU_VENDOR" = "nvidia" ]; then
        echo "--- Testing NVIDIA NVENC ---"
        echo "🔍 Checking for NVENC encoders in FFMPEG..."
        
        # Debug: Show all available encoders
        echo "📋 Available encoders containing 'nvenc':"
        $FFMPEG_PATH -encoders 2>/dev/null | grep nvenc || echo "   No NVENC encoders found"
        
        # Test NVENC encoder availability
        if $FFMPEG_PATH -encoders 2>/dev/null | grep -q nvenc; then
            echo "✅ NVENC encoders detected in FFMPEG"
            export FFMPEG_HWACCEL_METHOD="nvenc"
            
            # Test actual NVENC functionality if nvidia-smi is available
            if command -v nvidia-smi > /dev/null 2>&1; then
                echo "🧪 Testing NVENC functionality..."
                echo "🔍 Running test encode: $FFMPEG_PATH -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -c:v h264_nvenc -f null -"
                # Simple test encode with NVENC (show error output for debugging)
                if $FFMPEG_PATH -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -c:v h264_nvenc -f null - 2>&1; then
                    echo "✅ NVENC hardware encoding test successful"
                else
                    echo "⚠️  NVENC hardware encoding test failed - falling back to CPU"
                    echo "🔍 Testing with verbose output..."
                    $FFMPEG_PATH -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -c:v h264_nvenc -f null - -v error 2>&1 || true
                    export FFMPEG_HWACCEL_METHOD="cpu"
                fi
            else
                echo "⚠️  nvidia-smi not available, skipping NVENC functionality test"
            fi
        else
            echo "⚠️  NVENC encoders not available in this FFMPEG build"
            export FFMPEG_HWACCEL_METHOD="cpu"
        fi
    elif [ "$GPU_VENDOR" = "intel_amd" ]; then
        echo "--- Testing VAAPI ---"
        # Test VAAPI encoder availability
        if $FFMPEG_PATH -encoders 2>/dev/null | grep -q vaapi; then
            echo "✅ VAAPI encoders detected in FFMPEG"
            export FFMPEG_HWACCEL_METHOD="vaapi"
            
            # Test actual VAAPI functionality
            echo "🧪 Testing VAAPI functionality..."
            if $FFMPEG_PATH -init_hw_device vaapi=va:/dev/dri/renderD128 -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -vf 'format=nv12,hwupload' -c:v h264_vaapi -f null - 2>/dev/null; then
                echo "✅ VAAPI hardware encoding test successful"
            else
                echo "⚠️  VAAPI hardware encoding test failed - falling back to CPU"
                export FFMPEG_HWACCEL_METHOD="cpu"
            fi
        else
            echo "⚠️  VAAPI encoders not available in this FFMPEG build"
            export FFMPEG_HWACCEL_METHOD="cpu"
        fi
    else
        # No GPU detected or CPU-only mode
        export FFMPEG_HWACCEL_METHOD="cpu"
    fi
    
    # Test basic FFMPEG functionality
    echo "🧪 Testing basic FFMPEG functionality..."
    if $FFMPEG_PATH -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -f null - 2>/dev/null; then
        echo "✅ FFMPEG basic functionality confirmed"
    else
        echo "⚠️  FFMPEG basic test failed"
    fi
    
else
    echo "❌ FFMPEG not found at $FFMPEG_PATH"
    echo "🔍 Trying alternative FFMPEG locations..."
    
    # Try common alternative locations
    for alt_path in "/usr/bin/ffmpeg" "/usr/local/bin/ffmpeg" "/opt/ffmpeg/bin/ffmpeg"; do
        if [ -x "$alt_path" ]; then
            echo "✅ Found FFMPEG at alternative location: $alt_path"
            export FFMPEG_PATH="$alt_path"
            export FFPROBE_PATH="$(dirname $alt_path)/ffprobe"
            break
        fi
    done
    
    # If still not found, disable hardware acceleration
    if [ ! -x "$FFMPEG_PATH" ]; then
        echo "❌ FFMPEG not found in any common location"
        export HARDWARE_ACCELERATION_AVAILABLE="false"
        export FFMPEG_HWACCEL_METHOD="none"
    fi
fi

# Summary
echo "=== Hardware Acceleration Summary ==="
echo "🎯 Hardware acceleration available: ${HARDWARE_ACCELERATION_AVAILABLE}"
echo "🎮 GPU vendor: ${GPU_VENDOR}"
echo "🔢 GPU device count: ${GPU_DEVICE_COUNT}"
echo "🛠️  FFMPEG hardware acceleration method: ${FFMPEG_HWACCEL_METHOD:-none}"
if [ "$HARDWARE_ACCELERATION_AVAILABLE" = "true" ]; then
    echo "✅ Hardware acceleration is ready!"
    echo "💡 GPU device permissions handled by init script (following Plex pattern)"
else
    echo "⚠️  Hardware acceleration not available - using CPU-only mode"
    echo "💡 For NVIDIA: ensure --runtime=nvidia and NVIDIA_VISIBLE_DEVICES=all"
    echo "💡 For Intel/AMD: ensure --device=/dev/dri:/dev/dri"
fi

# Fail fast if NVIDIA GPU detected but NVENC still unavailable
if [ "$GPU_VENDOR" = "nvidia" ] && [ "$FFMPEG_HWACCEL_METHOD" != "nvenc" ]; then
    echo "⚠️  Detected NVIDIA GPU but NVENC encoders are missing in FFmpeg. Falling back to CPU mode."
fi

# Perform a quick GPU transcoding validation by encoding a 2-second HLS stream
if [ "$HARDWARE_ACCELERATION_AVAILABLE" = "true" ] && [ "$FFMPEG_HWACCEL_METHOD" != "cpu" ]; then
    echo "=== GPU Transcoding Validation ==="
    TEST_HLS_DIR="/tmp/gpu_hls_test"
    rm -rf "$TEST_HLS_DIR" && mkdir -p "$TEST_HLS_DIR"
    if [ "$FFMPEG_HWACCEL_METHOD" = "nvenc" ]; then
        $FFMPEG_PATH -hide_banner -loglevel error -y \
            -f lavfi -i testsrc2=duration=2:size=640x360:rate=30 \
            -c:v h264_nvenc -preset p4 -tune hq \
            -f hls -hls_time 1 -hls_list_size 2 -hls_flags omit_endlist "$TEST_HLS_DIR/index.m3u8" || GPU_TEST_FAILED=true
    elif [ "$FFMPEG_HWACCEL_METHOD" = "vaapi" ]; then
        $FFMPEG_PATH -hide_banner -loglevel error -y \
            -init_hw_device vaapi=va:/dev/dri/renderD128 \
            -f lavfi -i testsrc2=duration=2:size=640x360:rate=30 \
            -vf 'format=nv12,hwupload' -c:v h264_vaapi \
            -f hls -hls_time 1 -hls_list_size 2 -hls_flags omit_endlist "$TEST_HLS_DIR/index.m3u8" || GPU_TEST_FAILED=true
    fi
    if [ "$GPU_TEST_FAILED" = "true" ] || [ ! -f "$TEST_HLS_DIR/index.m3u8" ]; then
        echo "⚠️  GPU transcoding validation failed. Continuing with CPU transcoding."
    else
        echo "✅ GPU transcoding validation succeeded."
        rm -rf "$TEST_HLS_DIR"
    fi
fi

# Re-enable strict error handling for the rest of the script
echo "🔍 DEBUG: Hardware acceleration detection complete, enabling strict error handling"
set -e

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
GPU_VENDOR=${GPU_VENDOR:-none}
GPU_DEVICE_COUNT=${GPU_DEVICE_COUNT:-0}
FFMPEG_HWACCEL_METHOD=${FFMPEG_HWACCEL_METHOD:-none}
FFMPEG_PATH=${FFMPEG_PATH}
FFPROBE_PATH=${FFPROBE_PATH}
HARDWARE_ACCEL_DEVICE=${HARDWARE_ACCEL_DEVICE}
NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-}
NVIDIA_DRIVER_CAPABILITIES=${NVIDIA_DRIVER_CAPABILITIES:-}
PUID=${PUID:-99}
PGID=${PGID:-100}
EOF

# Web environment
cat > /app/apps/web/.env << EOF
NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
PORT=${WEB_PORT}
NODE_ENV=production
HARDWARE_ACCELERATION_AVAILABLE=${HARDWARE_ACCELERATION_AVAILABLE:-false}
GPU_VENDOR=${GPU_VENDOR:-none}
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

# Display hardware acceleration status
if [ "$HARDWARE_ACCELERATION_AVAILABLE" = "true" ]; then
    echo ""
    echo "🚀 Hardware Acceleration Status: ENABLED"
    echo "   GPU Vendor: ${GPU_VENDOR}"
    echo "   Method: ${FFMPEG_HWACCEL_METHOD}"
    echo "   Device: ${HARDWARE_ACCEL_DEVICE}"
    if command -v nvidia-smi > /dev/null 2>&1; then
        echo "   nvidia-smi: Available"
    fi
    echo "   🔧 Device permissions: Handled by init script"
else
    echo ""
    echo "⚠️  Hardware Acceleration Status: DISABLED (CPU-only mode)"
    echo "💡 Check Docker run parameters:"
    echo "   For NVIDIA: --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all"
    echo "   For Intel/AMD: --device=/dev/dri:/dev/dri"
fi

echo "=== Monitoring services ==="
# Keep the container running and wait for both processes
wait 