#!/bin/sh

# Exit on any error
set -e

echo "Starting production deployment..."

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
else
    # Fallback for development/direct access
    export BETTER_AUTH_URL=${BETTER_AUTH_URL:-"http://localhost:${PORT}"}
    export CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:${WEB_PORT}"}
    export NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL:-"http://localhost:${PORT}"}
fi

echo "Using database: ${DATABASE_URL}"
echo "Server will run on port: ${PORT}"
echo "Web will run on port: ${WEB_PORT}"
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    echo "External access configured for port: ${EXTERNAL_HTTP_PORT}"
    echo "All services will be accessible through nginx proxy"
fi

# Create production environment files
echo "Setting up production environment..."

# Server environment
cat > /app/apps/server/.env << EOF
PORT=${PORT}
DATABASE_URL=${DATABASE_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
CORS_ORIGIN=${CORS_ORIGIN}
NODE_ENV=production
EOF

# Web environment
cat > /app/apps/web/.env << EOF
NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
PORT=${WEB_PORT}
NODE_ENV=production
EOF

# Initialize database
echo "Initializing database..."
cd /app/apps/server
npx prisma generate
npx prisma db push --force-reset || npx prisma db push
cd /app

# Test nginx configuration
echo "Testing nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "Nginx configuration test failed!"
    exit 1
fi

# Function to cleanup background processes
cleanup() {
    echo "Shutting down..."
    kill $SERVER_PID $WEB_PID $NGINX_PID 2>/dev/null || true
    nginx -s quit 2>/dev/null || true
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup TERM INT

# Start nginx
echo "Starting nginx..."
nginx &
NGINX_PID=$!

# Start server in background
echo "Starting server on port ${PORT}..."
cd /app/apps/server
npm start &
SERVER_PID=$!

# Wait a moment for server to start
sleep 5

# Start web application in background
echo "Starting web application on port ${WEB_PORT}..."
cd /app/apps/web
PORT=${WEB_PORT} npm start &
WEB_PID=$!

echo "Applications started successfully!"

# Show appropriate access URLs based on configuration
if [ -n "$EXTERNAL_HTTP_PORT" ]; then
    # Nginx proxy mode (recommended for production)
    echo "🌐 TwentyFourSeven is available at: http://localhost:${EXTERNAL_HTTP_PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:${EXTERNAL_HTTP_PORT}/files/"
    echo "🔧 All services are proxied through nginx for optimal performance"
elif [ -n "$EXTERNAL_NGINX_PORT" ]; then
    # Docker Compose mode with separate ports
    echo "🌐 Nginx proxy available at: http://localhost:${EXTERNAL_NGINX_PORT}"
    echo "🖥️  Web application available at: http://localhost:${EXTERNAL_WEB_PORT}"
    echo "🔌 Server API available at: http://localhost:${EXTERNAL_SERVER_PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:${EXTERNAL_NGINX_PORT}/files/"
else
    # Development mode with direct access
    echo "🖥️  Web application available at: http://localhost:${WEB_PORT}"
    echo "🔌 Server API available at: http://localhost:${PORT}"
    echo "📁 Static files (.m3u/.xml) available at: http://localhost:80/files/"
fi

# Keep the container running and wait for both processes
wait 