# TwentyFourSeven NVIDIA GPU Setup for Unraid

This guide will help you set up and verify NVIDIA GPU support for TwentyFourSeven in Unraid.

## Prerequisites

### 1. Install NVIDIA Driver Plugin (if not already installed)
1. Go to **Apps** → **Community Applications**
2. Search for "**Nvidia-Driver**"
3. Install the plugin appropriate for your GPU
4. Reboot your Unraid server after installation

### 2. Verify NVIDIA Setup on Unraid Host
Open a terminal on your Unraid server and run:
```bash
nvidia-smi
```
You should see your GPU(s) listed with driver version and memory usage.

## TwentyFourSeven Docker Setup

### 1. Install from Unraid Template
1. Go to **Docker** → **Add Container**
2. Use the **TwentyFourSeven** template
3. **Important Settings:**
   - **HTTP Port**: Set your desired port (default: 8088)
   - **Enable GPU Detection**: ✅ `true`
   - **Enable Hardware Acceleration**: ✅ `true`
   - **NVIDIA Visible Devices**: Set to `all` (or specific GPU IDs like `0,1`)

### 2. Manual Docker Setup (Alternative)
If installing manually, ensure these settings:

**Extra Parameters:**
```
--restart=unless-stopped --runtime=nvidia
```

**Environment Variables:**
```
GPU_DETECTION_ENABLED=true
ENABLE_HARDWARE_ACCEL=true
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
```

## Verification Steps

### 1. Check Container Logs
After starting the container, check the logs for:
```
External access configured for port: 8088
🌐 TwentyFourSeven is available at: http://localhost:8088
```

### 2. Test GPU Detection in Web Interface
1. Open TwentyFourSeven at `http://YOUR-UNRAID-IP:8088`
2. Go to **Settings** → **FFMPEG Configuration**
3. Look for **"Detected Hardware"** section
4. You should see: `NVIDIA [Your GPU Model]`

### 3. Test Hardware Acceleration
In the FFMPEG settings page:
1. Click **"NVIDIA NVENC (Recommended)"** preset
2. Enable **"Hardware Acceleration"**
3. Set **Acceleration Type** to **"NVIDIA NVENC"**
4. Click **"Test Hardware Acceleration"**
5. You should see ✅ success result

### 4. Manual GPU Verification (Advanced)
Execute commands inside the container:

```bash
# Enter container shell
docker exec -it [container-name] sh

# Check if NVIDIA runtime is working
nvidia-smi

# Check GPU detection
lspci | grep -i nvidia

# Test NVENC encoding
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v h264_nvenc -f null -
```

## Troubleshooting

### GPU Not Detected
**Symptoms:**
- "No dedicated GPU detected" message
- NVIDIA NVENC preset is grayed out

**Solutions:**
1. **Verify NVIDIA Driver Plugin is installed:**
   ```bash
   # On Unraid host
   nvidia-smi
   ```

2. **Check container runtime:**
   - Ensure `--runtime=nvidia` is in Extra Parameters
   - Verify `NVIDIA_VISIBLE_DEVICES=all` is set

3. **Restart container with proper settings**

### Hardware Acceleration Test Fails
**Symptoms:**
- GPU detected but NVENC test fails
- "No supported hardware acceleration methods found"

**Solutions:**
1. **Check FFMPEG NVENC support:**
   ```bash
   # Inside container
   ffmpeg -codecs | grep nvenc
   ```

2. **Verify GPU memory availability:**
   ```bash
   # Inside container  
   nvidia-smi
   ```

3. **Try different encoder:**
   - Use `h264_nvenc` instead of `hevc_nvenc`
   - Check if GPU supports the specific codec

### Container Won't Start
**Symptoms:**
- Container fails to start with GPU runtime

**Solutions:**
1. **Install NVIDIA Container Runtime:**
   ```bash
   # On Unraid host (if needed)
   docker run --rm --runtime=nvidia nvidia/cuda:11.0-base nvidia-smi
   ```

2. **Remove `--runtime=nvidia` temporarily:**
   - Start container without GPU support
   - Verify basic functionality
   - Re-add GPU support once working

## Expected Performance

With NVIDIA GPU acceleration:
- **Encoding Speed**: 5-10x faster than CPU
- **CPU Usage**: Significantly reduced
- **Power Efficiency**: Better for continuous transcoding
- **Quality**: Comparable to CPU encoding with proper settings

## Optimal Settings for Different Use Cases

### Live Streaming
- **Encoder**: `h264_nvenc`
- **Preset**: `fast` or `medium`
- **Rate Control**: CBR with target bitrate
- **B-frames**: 2-3 for better compression

### File Transcoding
- **Encoder**: `h264_nvenc` or `hevc_nvenc`
- **Preset**: `slow` for best quality
- **Rate Control**: CQ (Constant Quality) with CRF 20-23
- **B-frames**: 3-4 for maximum compression

### Low Latency
- **Encoder**: `h264_nvenc`
- **Preset**: `ultrafast` or `superfast`
- **Rate Control**: CBR
- **B-frames**: 0 for minimum latency

## GPU Compatibility

### Supported NVIDIA GPUs
- **GTX 10 Series**: GTX 1050 and above (NVENC Gen 6)
- **GTX 16 Series**: All models (NVENC Gen 7)
- **RTX 20 Series**: All models (NVENC Gen 7)
- **RTX 30 Series**: All models (NVENC Gen 7)
- **RTX 40 Series**: All models (NVENC Gen 8)

### Encoding Capabilities by Generation
- **NVENC Gen 6**: H.264, limited HEVC
- **NVENC Gen 7**: H.264, HEVC, improved quality
- **NVENC Gen 8**: H.264, HEVC, AV1 (RTX 40 series)

## Final Checklist

Before deploying to Docker Hub, verify:
- ✅ Container starts successfully with `--runtime=nvidia`
- ✅ GPU detection works in web interface
- ✅ NVENC hardware acceleration test passes
- ✅ Transcoding performance is improved vs CPU
- ✅ No errors in container logs related to GPU
- ✅ Template variables are properly configured

## Support

If you encounter issues:
1. Check container logs for error messages
2. Verify Unraid NVIDIA plugin installation
3. Test basic GPU functionality outside container
4. Consult TwentyFourSeven documentation for latest updates 