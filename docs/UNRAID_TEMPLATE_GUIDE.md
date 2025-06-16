# Unraid Template Installation Guide

This guide explains how to install and customize your app using the Unraid Community Applications template.

## 🚀 Quick Installation

### Method 1: Community Applications (Recommended)
1. Open Unraid WebUI
2. Go to **Apps** tab
3. Search for "TwentyFourSeven"
4. Click **Install**
5. Configure settings (see below)
6. Click **Apply**

### Method 2: Manual Template Installation
1. Download `twentyfourseven-unraid-template.xml`
2. In Unraid WebUI, go to **Docker** tab
3. Click **Add Container**
4. Click **Template** dropdown
5. Select **Load Template** and upload the XML file

## ⚙️ Configuration Options

### 🔧 **Basic Settings** (Always Displayed)

| Setting | Default | Description |
|---------|---------|-------------|
| **Container Name** | `TwentyFourSeven` | Change to customize container name |
| **WebUI Port** | `3001` | Port for accessing the web interface |
| **API Port** | `3000` | Port for the backend API server |
| **Authentication Secret** | *auto-generated* | **IMPORTANT**: Set a custom secret for production |
| **Database Storage** | `/mnt/user/appdata/twentyfourseven/database` | Path for persistent database storage |

### 🔧 **Advanced Settings** (Click "Show more settings")

| Setting | Default | Description |
|---------|---------|-------------|
| **WebUI URL** | `http://[IP]:[PORT:3000]` | Full URL for API server |
| **CORS Origin** | `http://[IP]:[PORT:3001]` | Allowed CORS origin |
| **Public Server URL** | `http://[IP]:[PORT:3000]` | Public API URL for frontend |
| **Log Level** | `info` | Application logging level |
| **Timezone** | `America/New_York` | Container timezone |
| **PUID** | `99` | User ID for file permissions |
| **PGID** | `100` | Group ID for file permissions |
| **GPU Device** | *empty* | GPU device for hardware acceleration |

## 🎯 Common Configuration Scenarios

### 1. **Basic Installation (Default Settings)**
- Use default ports 3000/3001
- Auto-generated authentication secret
- Persistent database storage
- Perfect for getting started quickly

### 2. **Custom Ports**
```
WebUI Port: 8080
API Port: 8081
WebUI URL: http://[IP]:8081
CORS Origin: http://[IP]:8080
Public Server URL: http://[IP]:8081
```

### 3. **Reverse Proxy Setup** (Nginx Proxy Manager, etc.)
```
WebUI Port: 3001 (or custom)
API Port: 3000 (or custom)
WebUI URL: https://myapp-api.yourdomain.com
CORS Origin: https://myapp.yourdomain.com
Public Server URL: https://myapp-api.yourdomain.com
```

### 4. **GPU Acceleration** (for media processing)

**Intel GPU:**
```
GPU Device: /dev/dri
```

**NVIDIA GPU:**
```
GPU Device: nvidia.com/gpu=all
```
*Note: Requires NVIDIA Docker runtime installed*

### 5. **High Security Setup**
```
Authentication Secret: [Generate 64-character random string]
Database Storage: /mnt/user/secure/my-app/database
Log Level: warn
```

## 🔐 Security Best Practices

### 1. **Authentication Secret**
```bash
# Generate a secure secret (run on Unraid terminal)
openssl rand -hex 32
```
Copy the output and paste into "Authentication Secret" field.

### 2. **Network Security**
- Use custom ports to avoid conflicts
- Consider using Unraid's built-in VPN if accessing remotely
- Set up reverse proxy with SSL for external access

### 3. **File Permissions**
- Default PUID/PGID (99/100) work for most Unraid setups
- Adjust if you have custom user/group requirements

## 📁 File Locations

### Default Paths
```
Database: /mnt/user/appdata/twentyfourseven/database/
Container Config: /var/lib/docker/containers/[container-id]/
```

### Custom Paths
You can change the database storage location in the template:
```
/mnt/user/secure/twentyfourseven/          # More secure location
/mnt/cache/twentyfourseven/               # SSD cache for better performance
/mnt/disk1/twentyfourseven/               # Specific disk
```

## 🛠️ Troubleshooting

### Port Conflicts
```bash
# Check if ports are in use
netstat -tulpn | grep :3000
netstat -tulpn | grep :3001

# Or in Unraid Docker tab, check other containers
```

### Database Issues
```bash
# Access container console in Unraid Docker tab
ls -la /app/database/
rm /app/database/production.db  # Reset database
```

### Permission Issues
```bash
# Fix database permissions
chown -R 99:100 /mnt/user/appdata/twentyfourseven/
```

### Container Won't Start
1. Check Docker logs in Unraid WebUI
2. Verify all required fields are filled
3. Ensure ports aren't already in use
4. Check authentication secret format

## 🔄 Updates and Maintenance

### Updating the Application
1. Stop container in Docker tab
2. Click container name → **Force Update**
3. Start container
4. Database and settings are preserved

### Backup Database
```bash
# Copy database file before updates
cp /mnt/user/appdata/twentyfourseven/database/production.db /mnt/user/backups/
```

## 📋 Template Customization

### For Developers: Modifying the Template

1. **Update Repository URL**:
   ```xml
   <Repository>your-dockerhub-username/twentyfourseven:latest</Repository>
   ```

2. **Update Support/Project URLs**:
   ```xml
   <Support>https://github.com/your-username/twentyfourseven</Support>
   <Project>https://github.com/your-username/twentyfourseven</Project>
   ```

3. **Add Custom Icon**:
   ```xml
   <Icon>https://raw.githubusercontent.com/your-username/twentyfourseven/main/icon.png</Icon>
   ```

4. **Update Template URL**:
   ```xml
   <TemplateURL>https://raw.githubusercontent.com/your-username/twentyfourseven/main/twentyfourseven-unraid-template.xml</TemplateURL>
   ```

### Publishing to Community Applications
1. Fork the [Community Applications repository](https://github.com/Squidly271/docker-templates)
2. Add your template to the appropriate folder
3. Submit a pull request

## 🎉 Success!

After installation, access your application at:
- **Web Interface**: `http://[UNRAID-IP]:[WebUI-Port]`
- **API Docs**: `http://[UNRAID-IP]:[API-Port]/api`

The container will automatically:
- ✅ Create and initialize the database
- ✅ Generate secure authentication keys
- ✅ Start both frontend and backend services
- ✅ Configure proper networking and CORS
- ✅ Set up health monitoring 