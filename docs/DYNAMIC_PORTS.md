# Dynamic Port Configuration

TwentyFourSeven now supports **dynamic port configuration** that automatically adapts to your deployment environment. This makes it much easier for non-technical users to deploy via Unraid or Docker Compose.

## How It Works

The application automatically detects your deployment mode and configures all internal URLs accordingly:

### 🟢 **Recommended: Unraid Template (Simplest)**
- **User sees:** Only 1 port to configure (e.g., 8088)
- **Application automatically configures:** All internal URLs to use that single port
- **Access via:** `http://YOUR-SERVER-IP:8088`

### 🟡 **Docker Compose (Advanced)**
- **User sees:** 3 ports (8088 for nginx, 33000 for API, 33001 for web)
- **Application shows:** All port mappings in startup messages
- **Access via:** `http://localhost:8088` (nginx proxy - recommended)

### 🔵 **Development Mode**
- **Application uses:** Direct port access for local development
- **Access via:** `http://localhost:3001` (web) and `http://localhost:3000` (API)

## For Less Technical Users (Unraid)

1. Install the TwentyFourSeven template in Unraid
2. Set **ONE port** (default: 8088)
3. Click start - everything else is automatic!
4. Access your app at `http://YOUR-UNRAID-IP:8088`

## For Technical Users (Docker Compose)

The configuration supports both modes:
- **Simple:** Set `EXTERNAL_HTTP_PORT=8088` → All URLs use port 8088
- **Advanced:** Set individual ports with `EXTERNAL_NGINX_PORT`, `EXTERNAL_SERVER_PORT`, `EXTERNAL_WEB_PORT`

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `EXTERNAL_HTTP_PORT` | Single port for all access (recommended) | `8088` |
| `EXTERNAL_NGINX_PORT` | Nginx proxy port (advanced) | `8088` |
| `EXTERNAL_SERVER_PORT` | Direct API access port (advanced) | `33000` |
| `EXTERNAL_WEB_PORT` | Direct web access port (advanced) | `33001` |

The application automatically chooses the right configuration mode based on which variables are set. 