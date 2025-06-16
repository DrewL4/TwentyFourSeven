# Docker Environment Configuration for Unraid

This file contains all the environment variables you need to add to your `.env` files for proper GPU detection and hardware acceleration in Unraid Docker containers.

## Server Environment Variables (`apps/server/.env`)

```bash
# Existing variables
CORS_ORIGIN=http://localhost:3001
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=file:./local.db

# FFMPEG & GPU Configuration
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FFMPEG_AUTO_DETECT=true
FFMPEG_PATH_LOCKED=false

# GPU Detection & Hardware Acceleration
GPU_DETECTION_ENABLED=true
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
ENABLE_HARDWARE_ACCEL=true
HARDWARE_ACCEL_DEVICE=/dev/dri/renderD128

# Docker & Unraid Configuration
DOCKER_RUNTIME=nvidia
ENABLE_GPU_PASSTHROUGH=true
UNRAID_GPU_SUPPORT=true
DRI_DEVICE_ACCESS=true

# System Paths (Unraid specific)
UNRAID_APPDATA_PATH=/mnt/user/appdata
UNRAID_BOOT_PATH=/boot/config
UNRAID_FFMPEG_PATH=/usr/share/nginx/html/ffmpeg

# Performance & Testing
HARDWARE_ACCEL_TEST_TIMEOUT=10000
GPU_DETECTION_CACHE_TTL=300000
FFMPEG_TEST_ENABLED=true
```

## Web Environment Variables (`apps/web/.env`)

```bash
# Existing variables
NEXT_PUBLIC_SERVER_URL=http://localhost:3000

# GPU & Hardware Detection (Client-side)
NEXT_PUBLIC_GPU_DETECTION_ENABLED=true
NEXT_PUBLIC_HARDWARE_ACCEL_ENABLED=true
NEXT_PUBLIC_UNRAID_MODE=false
```

## Docker Template Environment Variables

When creating your Unraid Docker template, use these environment variable mappings:

### Container Environment Variables
```xml
<Config Name="CORS Origin" Target="CORS_ORIGIN" Default="http://localhost:3001" Mode="" Description="CORS origin for API access" Type="Variable" Display="always" Required="true" Mask="false">http://YOUR_UNRAID_IP:3001</Config>

<Config Name="GPU Detection" Target="GPU_DETECTION_ENABLED" Default="true" Mode="" Description="Enable GPU detection and hardware acceleration" Type="Variable" Display="always" Required="false" Mask="false">true</Config>

<Config Name="NVIDIA GPUs" Target="NVIDIA_VISIBLE_DEVICES" Default="all" Mode="" Description="NVIDIA GPU visibility (set to 'all' for all GPUs)" Type="Variable" Display="always" Required="false" Mask="false">all</Config>

<Config Name="Hardware Acceleration" Target="ENABLE_HARDWARE_ACCEL" Default="true" Mode="" Description="Enable hardware acceleration for transcoding" Type="Variable" Display="always" Required="false" Mask="false">true</Config>

<Config Name="FFMPEG Path" Target="FFMPEG_PATH" Default="/usr/bin/ffmpeg" Mode="" Description="Path to FFMPEG executable" Type="Variable" Display="advanced" Required="false" Mask="false">/usr/bin/ffmpeg</Config>

<Config Name="Unraid Mode" Target="UNRAID_GPU_SUPPORT" Default="true" Mode="" Description="Enable Unraid-specific GPU support" Type="Variable" Display="advanced" Required="false" Mask="false">true</Config>
```

### Docker Runtime Configuration
```xml
<Config Name="Extra Parameters" Target="" Default="" Mode="" Description="Docker extra parameters for GPU support" Type="Variable" Display="always" Required="false" Mask="false">--runtime=nvidia</Config>
```

### Device Mappings
```xml
<!-- For NVIDIA GPUs -->
<Config Name="NVIDIA GPU" Target="" Default="" Mode="" Description="NVIDIA GPU device access" Type="Device" Display="always" Required="false" Mask="false">/dev/nvidia0:/dev/nvidia0</Config>
<Config Name="NVIDIA Control" Target="" Default="" Mode="" Description="NVIDIA control device" Type="Device" Display="always" Required="false" Mask="false">/dev/nvidiactl:/dev/nvidiactl</Config>
<Config Name="NVIDIA UVM" Target="" Default="" Mode="" Description="NVIDIA UVM device" Type="Device" Display="always" Required="false" Mask="false">/dev/nvidia-uvm:/dev/nvidia-uvm</Config>

<!-- For Intel/AMD GPUs -->
<Config Name="DRI Devices" Target="/dev/dri" Default="/dev/dri" Mode="" Description="Direct Rendering Infrastructure devices for Intel/AMD GPU acceleration" Type="Device" Display="always" Required="false" Mask="false">/dev/dri</Config>
```

### Volume Mappings
```xml
<Config Name="NVIDIA SMI" Target="/usr/bin/nvidia-smi" Default="/usr/bin/nvidia-smi" Mode="ro" Description="NVIDIA System Management Interface (read-only)" Type="Path" Display="advanced" Required="false" Mask="false">/usr/bin/nvidia-smi</Config>

<Config Name="System PCI Info" Target="/sys/bus/pci" Default="/sys/bus/pci" Mode="ro" Description="PCI bus information for GPU detection (read-only)" Type="Path" Display="advanced" Required="false" Mask="false">/sys/bus/pci</Config>

<Config Name="LSPCI Tool" Target="/usr/bin/lspci" Default="/usr/bin/lspci" Mode="ro" Description="PCI listing tool for GPU detection (read-only)" Type="Path" Display="advanced" Required="false" Mask="false">/usr/bin/lspci</Config>
```

## Usage Instructions

1. **Copy these variables** to your respective `.env` files
2. **Adjust the values** based on your Unraid setup
3. **For Unraid Docker template**, use the XML configurations above
4. **Test GPU detection** through the FFMPEG settings page
5. **Verify hardware acceleration** using the built-in test functionality

## Important Notes

- Set `NVIDIA_VISIBLE_DEVICES=all` to expose all NVIDIA GPUs
- Mount `/dev/dri` for Intel/AMD GPU access
- Use `--runtime=nvidia` for NVIDIA Container Runtime
- The app automatically detects Unraid environment
- GPU detection is cached for 5 minutes by default

## Troubleshooting

If GPU detection isn't working in Docker:
1. Verify GPU passthrough is enabled in Unraid
2. Check that the NVIDIA Container Runtime is installed
3. Ensure proper device mappings in the Docker template
4. Check container logs for GPU detection errors
5. Test manually with `nvidia-smi` or `lspci` inside the container 