# Unraid Docker Deployment Guide

This guide will help you deploy your application as a Docker container on Unraid.

## 🚀 Quick Start

### 1. Build the Docker Image

```bash
# Build the production image
docker build -t twentyfourseven:latest .

# Or build with a specific tag
docker build -t twentyfourseven:v1.0.0 .
```

### 2. Test Locally (Optional)

```bash
# Test with docker-compose
docker-compose up

# Or test with docker run
docker run -p 3000:3000 -p 3001:3001 twentyfourseven:latest
```

Access your application:
- Web Interface: http://localhost:3001
- API Server: http://localhost:3000

## 📦 Unraid Container Configuration

### Container Settings

| Setting | Value | Description |
|---------|-------|-------------|
| **Repository** | `twentyfourseven:latest` | Your built image |
| **Network Type** | `Bridge` | Standard bridge networking |
| **Console shell command** | `Bash` | For debugging |

### Port Mappings

| Container Port | Host Port | Description |
|----------------|-----------|-------------|
| `3000` | `3000` | API Server |
| `3001` | `3001` | Web Interface |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `WEB_PORT` | `3001` | Web application port |
| `BETTER_AUTH_SECRET` | *auto-generated* | Authentication secret (set this!) |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Auth service URL |
| `CORS_ORIGIN` | `http://localhost:3001` | CORS allowed origin |
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:3000` | Public server URL |

### Volume Mappings (Optional)

If you want to persist data between container updates:

| Container Path | Host Path | Description |
|----------------|-----------|-------------|
| `/app/database` | `/mnt/user/appdata/twentyfourseven/database` | Database persistence |

## 🔧 Configuration Examples

### Basic Configuration (Ephemeral Database)
```bash
docker run -d \
  --name=twentyfourseven \
  -p 3000:3000 \
  -p 3001:3001 \
  -e BETTER_AUTH_SECRET="your-very-secure-secret-key" \
  --restart=unless-stopped \
  twentyfourseven:latest
```

### With Persistent Database
```bash
docker run -d \
  --name=twentyfourseven \
  -p 3000:3000 \
  -p 3001:3001 \
  -e BETTER_AUTH_SECRET="your-very-secure-secret-key" \
  -v /mnt/user/appdata/twentyfourseven/database:/app/database \
  --restart=unless-stopped \
  twentyfourseven:latest
```

### Custom Ports
```bash
docker run -d \
  --name=twentyfourseven \
  -p 8080:3000 \
  -p 8081:3001 \
  -e PORT=3000 \
  -e WEB_PORT=3001 \
  -e BETTER_AUTH_SECRET="your-very-secure-secret-key" \
  -e BETTER_AUTH_URL="http://your-unraid-ip:8080" \
  -e CORS_ORIGIN="http://your-unraid-ip:8081" \
  -e NEXT_PUBLIC_SERVER_URL="http://your-unraid-ip:8080" \
  --restart=unless-stopped \
  twentyfourseven:latest
```

## 🌐 Network Configuration

### Accessing from Other Devices

Replace `localhost` with your Unraid server IP in the environment variables:

```bash
-e BETTER_AUTH_URL="http://192.168.1.100:3000"
-e CORS_ORIGIN="http://192.168.1.100:3001"
-e NEXT_PUBLIC_SERVER_URL="http://192.168.1.100:3000"
```

### Reverse Proxy (Nginx Proxy Manager, Traefik, etc.)

For external access through a reverse proxy, set the environment variables to match your proxy configuration.

## 🔐 Security Recommendations

1. **Always set a custom `BETTER_AUTH_SECRET`**:
   ```bash
   # Generate a secure secret
   openssl rand -hex 32
   ```

2. **Use strong, unique secrets** for production deployments

3. **Consider using environment files** for sensitive data:
   ```bash
   docker run --env-file production.env twentyfourseven:latest
   ```

## 🗄️ Database Management

### Database Location
- **Default**: `/app/database/production.db` (inside container)
- **Persistent**: Mount `/app/database` to host filesystem

### Database Backup
```bash
# Backup database from running container
docker exec twentyfourseven cp /app/database/production.db /tmp/backup.db
docker cp twentyfourseven:/tmp/backup.db ./database-backup.db
```

### Database Reset
```bash
# Stop container, remove database, restart
docker stop twentyfourseven
docker exec twentyfourseven rm -f /app/database/production.db
docker start twentyfourseven
```

## 🔍 Troubleshooting

### Check Container Logs
```bash
docker logs twentyfourseven
```

### Access Container Shell
```bash
docker exec -it twentyfourseven /bin/sh
```

### Health Check
The container includes a built-in health check. Check status:
```bash
docker inspect twentyfourseven | grep -A 5 Health
```

### Common Issues

1. **Port conflicts**: Ensure ports 3000 and 3001 aren't already in use
2. **Environment variables**: Double-check all URLs and secrets
3. **Database permissions**: Ensure the database directory is writable
4. **Network connectivity**: Verify firewall settings allow the configured ports

## 📋 Maintenance

### Updating the Application
1. Stop the container: `docker stop twentyfourseven`
2. Remove the container: `docker rm twentyfourseven`
3. Build new image: `docker build -t twentyfourseven:latest .`
4. Start new container with same configuration

### Monitoring
- Check container status: `docker ps`
- Monitor resource usage: `docker stats twentyfourseven`
- View logs: `docker logs -f twentyfourseven`

## 🎯 Production Checklist

- [ ] Custom `BETTER_AUTH_SECRET` set
- [ ] Proper network configuration for external access
- [ ] Database persistence configured (if desired)
- [ ] Health checks working
- [ ] Firewall ports opened
- [ ] Reverse proxy configured (if needed)
- [ ] Backup strategy in place
- [ ] Monitoring/logging configured 