# NVIDIA GPU Setup Guide for Unraid (TwentyFourSeven-Style Implementation)

This guide will walk you through setting up NVIDIA GPU hardware acceleration for TwentyFourSeven on Unraid, following the same proven patterns used by TwentyFourSeven.

## Key Changes - TwentyFourSeven-Style Implementation

We've completely rewritten the GPU detection and Docker configuration to match TwentyFourSeven's proven approach:

### 🔄 **Major Changes Made**

1. **Base Image**: Now uses `jrottenberg/ffmpeg:4.4-nvidia2004` (same as TwentyFourSeven)
2. **Simplified Runtime**: Uses `--runtime=nvidia` only (no `--gpus all`)
3. **Environment Variables**: `NVIDIA_DRIVER_CAPABILITIES=all` (TwentyFourSeven pattern)
4. **Simplified Detection**: Direct nvidia-smi check instead of complex device probing
5. **No Device Mapping**: Relies on NVIDIA runtime (like TwentyFourSeven)

## Prerequisites

### 1. Install NVIDIA Driver Plugin
1. Go to **Apps** → **Community Applications** in Unraid
2. Search for "NVIDIA-Driver"
3. Install the **NVIDIA-Driver** plugin
4. **Reboot your Unraid server** after installation

### 2. Verify GPU Detection
After reboot, check that your GPUs are detected:

```bash
# SSH into your Unraid server and run:
nvidia-smi
```

You should see output like:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 550.90.07    Driver Version: 550.90.07    CUDA Version: 12.4  |
|-------------------------------+----------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |         Memory-Usage | GPU-Util  Compute M. |
|                                         |                      |               MIG M. |
|===============================+======================+======================|
|   0  NVIDIA GeForce RTX 4090     Off   | 00000000:01:00.0  On |                  Off |
| 30%   35C    P8              31W / 450W |    123MiB / 24564MiB |      0%      Default |
|                                         |                      |                  N/A |
+-------------------------------+----------------------+----------------------+
```

## Docker Configuration

### Unraid Template Settings

The template has been simplified to match TwentyFourSeven's approach:

#### **Required Settings:**
- **ExtraParams**: `--restart=unless-stopped --runtime=nvidia`
- **NVIDIA_VISIBLE_DEVICES**: `all` 
- **NVIDIA_DRIVER_CAPABILITIES**: `all`

#### **For Multiple GPUs:**
If you have multiple NVIDIA GPUs and want to use specific ones:
1. SSH into Unraid: `nvidia-smi -L`
2. Note the GPU IDs (0, 1, 2, etc.)
3. Set **NVIDIA_VISIBLE_DEVICES** to specific IDs: `0,1` (for first two GPUs)

### Manual Docker Run Command

If running manually:
```bash
docker run -d \
  --name twentyfourseven \
  --restart=unless-stopped \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -p 8088:80 \
  -v /mnt/user/appdata/twentyfourseven/database:/app/database \
  -v /mnt/user/appdata/twentyfourseven/static:/app/static \
  drew4/twentyfourseven:latest
```

## Troubleshooting

### 1. Check Container Logs

Look for these key indicators in your container logs:

#### ✅ **Success Indicators:**
```
✅ nvidia-smi found - NVIDIA runtime is working
🎮 NVIDIA devices found: 3
✅ NVIDIA GPU detection successful
✅ NVENC encoders available
🚀 Hardware Acceleration Status: ENABLED
   GPU Vendor: nvidia
   Method: nvenc
   Device: /dev/nvidia0
```

#### ❌ **Failure Indicators:**
```
⚠️  nvidia-smi not available - NVIDIA runtime not working
💡 Ensure container is started with --runtime=nvidia
```

### 2. Common Issues & Solutions

#### **Issue: "nvidia-smi not available"**
**Solution:**
1. Verify NVIDIA-Driver plugin is installed and Unraid is rebooted
2. Check ExtraParams contains `--runtime=nvidia`
3. Verify nvidia-smi works on Unraid host: `nvidia-smi`

#### **Issue: "NVENC encoders not available"**  
**Solution:**
1. Check GPU compatibility: [NVIDIA Video Codec SDK](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new)
2. Verify driver version supports your GPU
3. Check container logs for FFmpeg encoder list

#### **Issue: "Hardware acceleration not working in streams"**
**Solution:**
1. Go to **Settings** → **FFMPEG Settings** in the web UI
2. Verify "Enable Hardware Acceleration" is checked
3. Hardware Acceleration Type should show "NVENC (NVIDIA)"
4. Video Codec should be "h264_nvenc"

### 3. Verification Steps

#### **Step 1: Check GPU Detection**
```bash
# In container logs, look for:
🎮 NVIDIA devices found: [number]
✅ NVIDIA GPU detection successful
```

#### **Step 2: Check FFmpeg NVENC Support**
```bash
# In container logs, look for:
✅ NVENC encoders available
```

#### **Step 3: Test Hardware Acceleration**
1. Access TwentyFourSeven web UI
2. Go to **Settings** → **FFMPEG Settings**
3. Should show detected GPU information
4. Enable hardware acceleration and save

#### **Step 4: Monitor GPU Usage**
```bash
# On Unraid host, monitor GPU usage:
watch -n 1 nvidia-smi
```
During video transcoding, you should see GPU utilization increase.

### 4. Advanced Troubleshooting

#### **Debug Container GPU Access**
```bash
# Enter container
docker exec -it twentyfourseven bash

# Check NVIDIA devices
ls -la /dev/nvidia*

# Test nvidia-smi inside container
nvidia-smi

# Check FFmpeg encoders
ffmpeg -encoders | grep nvenc
```

#### **Multiple GPU Selection**
If you have multiple GPUs:
```bash
# List available GPUs
nvidia-smi -L

# Set specific GPU in Unraid template
NVIDIA_VISIBLE_DEVICES=0,2  # Use GPU 0 and 2 only
```

## Differences from Previous Implementation

### ❌ **Removed (Complex Approach):**
- Complex device mapping (`/dev/nvidia0`, `/dev/nvidiactl`, etc.)
- `--gpus all` parameter
- Complex capability checking
- Fallback detection logic
- Permission management scripts

### ✅ **Added (TwentyFourSeven Approach):**
- NVIDIA-enabled FFmpeg base image
- Simple `--runtime=nvidia` only
- `NVIDIA_DRIVER_CAPABILITIES=all`
- Direct nvidia-smi detection
- Simplified error handling

## Comparison with TwentyFourSeven

| Feature | TwentyFourSeven | TwentyFourSeven |
|---------|----------|-----------------|
| Base Image | `jrottenberg/ffmpeg:4.3-nvidia1804` | `jrottenberg/ffmpeg:4.4-nvidia2004` |
| Runtime | `--runtime=nvidia` | `--runtime=nvidia` |
| GPU Detection | Simple nvidia-smi check | Simple nvidia-smi check |
| Capabilities | `NVIDIA_DRIVER_CAPABILITIES=all` | `NVIDIA_DRIVER_CAPABILITIES=all` |
| Device Mapping | None (runtime handles it) | None (runtime handles it) |

## Support

If you're still having issues:

1. **Check Unraid System Log** for NVIDIA driver errors
2. **Verify GPU Compatibility** with NVENC
3. **Test with TwentyFourSeven** - if TwentyFourSeven works, TwentyFourSeven should too
4. **Post Container Logs** showing the GPU detection section

The new implementation follows TwentyFourSeven's proven patterns exactly, so if TwentyFourSeven works on your system, TwentyFourSeven should work identically. 