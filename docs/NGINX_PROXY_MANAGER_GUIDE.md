# Nginx Proxy Manager Setup Guide for TwentyFourSeven

This guide will help you set up TwentyFourSeven with Nginx Proxy Manager (NPM) on Unraid for external access and SSL termination.

## 🏗️ Architecture Overview

```
Internet → NPM (SSL) → TwentyFourSeven Container (Port 80) → Nginx → Next.js Apps
                                                                  ↓
                                                            Static Files (.m3u/.xml)
```

## 📋 Prerequisites

- Unraid server with TwentyFourSeven container running
- Nginx Proxy Manager installed on Unraid
- Domain name pointed to your external IP
- Port forwarding set up (80/443 → NPM container)

## 🚀 TwentyFourSeven Container Setup

### 1. Install TwentyFourSeven with Nginx

Use the Unraid template with these **key settings**:

| Setting | Value | Notes |
|---------|-------|-------|
| **HTTP Port** | `8080` | Main port (avoid conflicts with NPM) |
| **WebUI Port** | `3001` | Keep default (internal) |
| **API Port** | `3000` | Keep default (internal) |
| **Database Storage** | `/mnt/user/appdata/twentyfourseven/database` | Persistent storage |
| **Static Files Storage** | `/mnt/user/appdata/twentyfourseven/static` | For .m3u/.xml files |

### 2. Create Static Files Directory

```bash
# SSH into Unraid and create the static files directory
mkdir -p /mnt/user/appdata/twentyfourseven/static

# Set proper permissions
chmod 755 /mnt/user/appdata/twentyfourseven/static
```

### 3. Add Your Media Files

Place your `.m3u` and `.xml` files in the static directory:

```bash
# Example file structure
/mnt/user/appdata/twentyfourseven/static/
├── playlist.m3u
├── channels.m3u8
├── epg.xml
└── guide.xml
```

## 🔧 Nginx Proxy Manager Configuration

### 1. Access NPM Web Interface

- Open NPM at `http://[UNRAID-IP]:81`
- Login with your credentials

### 2. Create Proxy Host

**Basic Settings:**
- **Domain Names**: `twentyfourseven.yourdomain.com`
- **Scheme**: `http`
- **Forward Hostname/IP**: `[UNRAID-IP]`
- **Forward Port**: `8080` (or your custom HTTP port)
- **Cache Assets**: ✅ Enabled
- **Block Common Exploits**: ✅ Enabled
- **Websockets Support**: ✅ Enabled

**SSL Settings:**
- **SSL Certificate**: Request a new certificate
- **Force SSL**: ✅ Enabled
- **HTTP/2 Support**: ✅ Enabled
- **HSTS Enabled**: ✅ Enabled

### 3. Advanced Configuration (Optional)

For better performance, add this to the **Advanced** tab:

```nginx
# Optimize static file serving
location /files/ {
    proxy_cache_valid 200 5m;
    proxy_cache_valid 404 1m;
    add_header Cache-Control "public, max-age=300";
}

# Optimize API responses
location /api/ {
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
}

# WebSocket support for real-time features
location /api/ws {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 📱 Access Your Application

After setup completion:

- **Main Application**: `https://twentyfourseven.yourdomain.com`
- **Static Files**: `https://twentyfourseven.yourdomain.com/files/playlist.m3u`
- **API**: `https://twentyfourseven.yourdomain.com/api/`

## 🔐 Security Considerations

### 1. Update Environment Variables

Update your TwentyFourSeven container environment variables:

```bash
BETTER_AUTH_URL=https://twentyfourseven.yourdomain.com/api
CORS_ORIGIN=https://twentyfourseven.yourdomain.com
NEXT_PUBLIC_SERVER_URL=https://twentyfourseven.yourdomain.com/api
```

### 2. NPM Access Control (Optional)

Restrict access to admin functions:

```nginx
# In NPM Advanced configuration
location /admin {
    allow 192.168.1.0/24;  # Your local network
    deny all;
}
```

### 3. Rate Limiting

The built-in nginx configuration includes rate limiting, but you can add more in NPM:

```nginx
# Additional rate limiting in NPM
location /files/ {
    limit_req zone=files burst=20 nodelay;
}
```

## 🎯 Common Use Cases

### 1. IPTV Playlist Serving

```bash
# Place your IPTV playlist
cp your-playlist.m3u /mnt/user/appdata/twentyfourseven/static/

# Access via
https://twentyfourseven.yourdomain.com/files/your-playlist.m3u
```

### 2. EPG/XML Guide Serving

```bash
# Place your EPG file
cp guide.xml /mnt/user/appdata/twentyfourseven/static/

# Access via
https://twentyfourseven.yourdomain.com/files/guide.xml
```

### 3. Multiple Playlists

```bash
# Organize by categories
/mnt/user/appdata/twentyfourseven/static/
├── sports/
│   ├── sports-hd.m3u
│   └── sports-sd.m3u
├── movies/
│   ├── movies-hd.m3u
│   └── movies-4k.m3u
└── tv/
    ├── tv-guide.xml
    └── channels.m3u8
```

## 🛠️ Troubleshooting

### 1. Static Files Not Loading

**Check container logs:**
```bash
# In Unraid Docker tab, view TwentyFourSeven logs
# Look for nginx errors
```

**Verify file permissions:**
```bash
ls -la /mnt/user/appdata/twentyfourseven/static/
# Should show readable files
```

### 2. SSL Certificate Issues

**Force certificate renewal in NPM:**
- Go to SSL Certificates
- Click "Renew" on your certificate
- Wait for renewal to complete

### 3. CORS Errors

**Verify environment variables:**
- Check that `CORS_ORIGIN` matches your domain
- Restart the container after changes

### 4. 502 Bad Gateway

**Check container status:**
```bash
# Ensure TwentyFourSeven container is running
docker ps | grep twentyfourseven

# Check if port 8080 is accessible
curl http://[UNRAID-IP]:8080
```

## 📈 Performance Optimization

### 1. Static File Caching

Files in `/files/` are automatically cached with appropriate headers:
- **M3U/XML files**: 5 minutes cache
- **Other static files**: 1 year cache

### 2. Gzip Compression

The built-in nginx config enables gzip compression for:
- Text files (HTML, CSS, JS)
- XML files (EPG data)
- JSON (API responses)

### 3. HTTP/2 Support

Enable HTTP/2 in NPM for better performance with multiple file requests.

## 🔄 Updates and Maintenance

### 1. Updating Static Files

```bash
# Update files directly
cp new-playlist.m3u /mnt/user/appdata/twentyfourseven/static/

# Files are immediately available - no restart needed
```

### 2. Container Updates

```bash
# Update container (preserves static files)
# In Unraid Docker tab:
# 1. Stop container
# 2. Force update
# 3. Start container
```

### 3. Backup Strategy

```bash
# Backup static files
tar -czf twentyfourseven-backup.tar.gz /mnt/user/appdata/twentyfourseven/

# Restore if needed
tar -xzf twentyfourseven-backup.tar.gz -C /
```

## 🎉 Success!

Your TwentyFourSeven application is now:
- ✅ Accessible via HTTPS with your domain
- ✅ Serving static files efficiently
- ✅ Protected with SSL certificates
- ✅ Optimized for performance
- ✅ Ready for production use

**Test your setup:**
1. Access `https://twentyfourseven.yourdomain.com`
2. Verify static files at `https://twentyfourseven.yourdomain.com/files/`
3. Check API endpoints work correctly
4. Confirm SSL certificate is valid 