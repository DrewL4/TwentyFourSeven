# FFMPEG Features Implementation

This document outlines the comprehensive FFMPEG features that have been implemented in your TwentyFour/Seven application, with special focus on Unraid compatibility and hardware acceleration.

## Overview

The FFMPEG implementation includes:
- **Automatic FFMPEG detection** across multiple platforms
- **Hardware acceleration support** (NVIDIA NVENC, Intel QSV, AMD VAAPI, Apple VideoToolbox)
- **GPU detection and optimization** for Unraid and other systems
- **Advanced transcoding settings** with quality presets
- **Real-time hardware testing** and performance monitoring
- **Unraid-specific optimizations** and path detection

## Key Features

### 1. Hardware Detection & Auto-Configuration

#### System Information Detection
- **Platform Detection**: Automatically detects Linux, macOS, Windows, and Unraid
- **GPU Detection**: Identifies NVIDIA, AMD, and Intel GPUs with driver information
- **Hardware Acceleration**: Auto-detects available acceleration methods
- **Unraid Optimization**: Special handling for Unraid Docker environments

#### FFMPEG Path Detection
The system automatically searches for FFMPEG in common locations:
- System PATH (`ffmpeg`)
- Standard Linux paths (`/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`)
- Unraid-specific paths:
  - `/usr/share/nginx/html/ffmpeg` (Docker common path)
  - `/mnt/user/appdata/ffmpeg/ffmpeg` (User appdata)
  - `/boot/config/plugins/ffmpeg/ffmpeg` (Plugin path)
- Windows paths (`C:\ffmpeg\bin\ffmpeg.exe`)

### 2. Hardware Acceleration Support

#### NVIDIA NVENC
- **Detection**: Automatic detection of NVIDIA GPUs and NVENC support
- **Encoders**: H.264 and H.265 hardware encoding
- **Device Selection**: Support for multiple GPU setups (`cuda:0`, `cuda:1`, etc.)
- **Testing**: Real-time performance testing with benchmarking

#### Intel Quick Sync (QSV)
- **Detection**: Intel integrated graphics detection
- **Encoders**: H.264 and H.265 QSV encoding
- **Compatibility**: Works with modern Intel CPUs with integrated graphics

#### AMD VAAPI
- **Detection**: AMD GPU detection with VAAPI support
- **Device Management**: Automatic `/dev/dri/renderD*` device detection
- **Linux Optimization**: Optimized for Linux systems including Unraid

#### Apple VideoToolbox
- **macOS Support**: Native hardware acceleration on Apple Silicon and Intel Macs
- **Efficiency**: Optimized for macOS video encoding workflows

### 3. Advanced Transcoding Settings

#### Video Settings
- **Resolution Scaling**: Support for 480p, 720p, 1080p, 1440p, 4K, or no scaling
- **Codec Selection**: H.264, H.265, or copy (no transcoding)
- **Bitrate Control**: Configurable video bitrate and buffer size
- **Quality Control**: CRF (Constant Rate Factor) settings from 0-51
- **Encoding Presets**: From ultrafast to veryslow for quality/speed balance

#### Audio Settings
- **Codec Support**: AAC, AC3, MP3, or copy
- **Sample Rates**: 44.1kHz, 48kHz, 96kHz
- **Channel Configuration**: Mono, Stereo, 5.1, 7.1 surround
- **Bitrate Control**: Configurable audio bitrate

#### Performance Optimization
- **Thread Management**: Auto-detection of CPU cores or manual configuration
- **Memory Management**: Configurable muxing queue sizes
- **Error Handling**: Multiple error screen and audio options
- **Logging**: Comprehensive logging levels from quiet to trace

### 4. Unraid-Specific Features

#### Docker Environment Detection
- **Container Awareness**: Detects when running in Docker containers
- **Path Mapping**: Handles Unraid's unique path structure
- **GPU Passthrough**: Supports GPU passthrough configurations
- **Plugin Integration**: Compatible with Unraid FFMPEG plugins

#### Hardware Acceleration in Unraid
- **NVIDIA Support**: Works with Unraid's NVIDIA plugin
- **Intel Support**: Supports Intel GPU passthrough
- **Device Permissions**: Handles `/dev/dri` device permissions
- **Container Optimization**: Optimized for Docker container environments

### 5. User Interface Features

#### Settings Organization
The FFMPEG settings are organized into intuitive tabs:

1. **Basic Settings**
   - FFMPEG path configuration
   - Auto-detection and validation
   - Path locking for production environments

2. **Transcoding**
   - Video and audio encoding settings
   - Quality and performance presets
   - Format and container options

3. **Hardware Acceleration**
   - GPU detection and selection
   - Hardware acceleration testing
   - Performance benchmarking
   - Device configuration

4. **Advanced**
   - Error handling configuration
   - Logging and debugging options
   - Custom FFMPEG arguments
   - Performance statistics

#### Real-Time Testing
- **Hardware Testing**: Test each acceleration method with performance metrics
- **Path Validation**: Verify FFMPEG installation and capabilities
- **Codec Detection**: Display available codecs, formats, and filters
- **Performance Monitoring**: Real-time encoding performance statistics

### 6. API Endpoints

The implementation provides comprehensive API endpoints:

#### System Information
- `GET /api/settings/ffmpeg/systemInfo` - System and GPU information
- `GET /api/settings/ffmpeg/detectPaths` - Auto-detect FFMPEG paths
- `POST /api/settings/ffmpeg/validatePath` - Validate FFMPEG path
- `POST /api/settings/ffmpeg/getInfo` - Get FFMPEG capabilities

#### Hardware Testing
- `POST /api/settings/ffmpeg/testHardwareAccel` - Test hardware acceleration
- `GET /api/settings/ffmpeg/getRecommendedSettings` - Get optimized settings

#### Configuration Management
- `GET /api/settings/ffmpeg/get` - Get current FFMPEG settings
- `POST /api/settings/ffmpeg/update` - Update FFMPEG settings

## Database Schema

### FfmpegSettings Model
The comprehensive settings model includes:

```prisma
model FfmpegSettings {
  // Executable settings
  ffmpegPath String
  ffprobePath String
  pathLocked Boolean
  autoDetectPath Boolean
  
  // Transcoding settings
  enableTranscoding Boolean
  targetResolution String
  videoBitrate String
  videoCodec String
  audioCodec String
  // ... and many more
  
  // Hardware acceleration
  enableHardwareAccel Boolean
  hardwareAccelType String
  hardwareDevice String
  
  // Performance settings
  threads Int
  videoPreset String
  videoCrf Int
  
  // Advanced options
  globalOptions String
  inputOptions String
  outputOptions String
}
```

## Best Practices for Unraid

### 1. Docker Configuration
```yaml
# Docker Compose example for Unraid
services:
  your-app:
    devices:
      - /dev/dri:/dev/dri  # For Intel/AMD hardware acceleration
    environment:
      - NVIDIA_VISIBLE_DEVICES=all  # For NVIDIA acceleration
    volumes:
      - /mnt/user/appdata/ffmpeg:/usr/local/bin  # FFMPEG binaries
```

### 2. GPU Passthrough
- Enable GPU passthrough in Unraid settings
- Install appropriate GPU drivers (NVIDIA plugin for NVIDIA GPUs)
- Configure device permissions for hardware acceleration

### 3. Performance Optimization
- Use hardware acceleration when available
- Configure appropriate thread counts based on CPU cores
- Monitor encoding performance and adjust settings accordingly
- Use appropriate quality presets for your use case

## Troubleshooting

### Common Issues

1. **FFMPEG Not Found**
   - Use auto-detection feature
   - Check Unraid FFMPEG plugin installation
   - Verify Docker volume mounts

2. **Hardware Acceleration Fails**
   - Verify GPU drivers are installed
   - Check device permissions (`/dev/dri` access)
   - Test hardware acceleration in settings

3. **Poor Performance**
   - Enable hardware acceleration if available
   - Adjust encoding presets
   - Monitor CPU/GPU usage
   - Configure appropriate thread counts

### Debugging
- Enable verbose logging in FFMPEG settings
- Use the hardware acceleration test feature
- Check system information for detected hardware
- Monitor performance statistics

## Future Enhancements

Planned improvements include:
- **AV1 encoding support** when hardware becomes available
- **Multi-GPU load balancing** for high-throughput scenarios
- **Adaptive bitrate streaming** with multiple quality levels
- **Real-time encoding statistics** dashboard
- **Automatic quality optimization** based on content analysis

## Conclusion

This FFMPEG implementation provides enterprise-grade video processing capabilities with special optimizations for Unraid environments. The combination of automatic hardware detection, comprehensive transcoding options, and real-time testing makes it suitable for both home media servers and professional streaming applications.

The modular design allows for easy extension and customization while maintaining compatibility with existing TwentyFour/Seven workflows and Unraid's unique requirements. 