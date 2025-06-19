import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export interface FfmpegInfo {
  version: string;
  path: string;
  configuration: string[];
  codecs: string[];
  formats: string[];
  filters: string[];
  protocols: string[];
}

export interface HardwareAccelInfo {
  type: 'nvenc' | 'vaapi' | 'qsv' | 'videotoolbox' | 'none';
  device?: string;
  encoders: string[];
  supported: boolean;
}

export interface SystemInfo {
  platform: string;
  isUnraid: boolean;
  gpus: Array<{
    vendor: 'nvidia' | 'amd' | 'intel';
    model: string;
    driver?: string;
  }>;
  hardwareAccel: HardwareAccelInfo[];
}

export class FfmpegService {
  private static instance: FfmpegService;
  private ffmpegCache: FfmpegInfo | null = null;
  private systemInfoCache: SystemInfo | null = null;
  private cacheTimestamp: number | null = null;

  static getInstance(): FfmpegService {
    if (!FfmpegService.instance) {
      FfmpegService.instance = new FfmpegService();
    }
    return FfmpegService.instance;
  }

  /**
   * Auto-detect FFMPEG path on the system
   */
  async detectFfmpegPath(): Promise<string[]> {
    // Check if auto-detection is disabled
    if (process.env.FFMPEG_AUTO_DETECT === 'false') {
      const customPath = process.env.FFMPEG_PATH;
      if (customPath) {
        return [customPath];
      }
    }

    const possiblePaths = [
      process.env.FFMPEG_PATH || 'ffmpeg', // Environment variable first
      'ffmpeg', // System PATH
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/opt/ffmpeg/bin/ffmpeg',
      process.env.UNRAID_FFMPEG_PATH || '/usr/share/nginx/html/ffmpeg', // Unraid Docker common path
      `${process.env.UNRAID_APPDATA_PATH || '/mnt/user/appdata'}/ffmpeg/ffmpeg`, // Unraid user appdata
      `${process.env.UNRAID_BOOT_PATH || '/boot/config'}/plugins/ffmpeg/ffmpeg`, // Unraid plugin path
      'C:\\ffmpeg\\bin\\ffmpeg.exe', // Windows
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    ].filter(Boolean);

    const validPaths: string[] = [];

    for (const ffmpegPath of possiblePaths) {
      try {
        const isValid = await this.validateFfmpegPath(ffmpegPath);
        if (isValid) {
          validPaths.push(ffmpegPath);
        }
      } catch (error) {
        // Continue checking other paths
      }
    }

    return validPaths;
  }

  /**
   * Validate if an FFMPEG path is working
   */
  async validateFfmpegPath(ffmpegPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`"${ffmpegPath}" -version`);
      return stdout.includes('ffmpeg version');
    } catch (error) {
      return false;
    }
  }

  /**
   * Get detailed FFMPEG information
   */
  async getFfmpegInfo(ffmpegPath: string = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<FfmpegInfo> {
    if (this.ffmpegCache && this.ffmpegCache.path === ffmpegPath) {
      return this.ffmpegCache;
    }

    try {
      const { stdout: versionOutput } = await execAsync(`"${ffmpegPath}" -version`);
      const { stdout: codecsOutput } = await execAsync(`"${ffmpegPath}" -codecs`);
      const { stdout: formatsOutput } = await execAsync(`"${ffmpegPath}" -formats`);
      const { stdout: filtersOutput } = await execAsync(`"${ffmpegPath}" -filters`);
      const { stdout: protocolsOutput } = await execAsync(`"${ffmpegPath}" -protocols`);

      // Parse version
      const versionMatch = versionOutput.match(/ffmpeg version ([^\s]+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      // Parse configuration
      const configMatch = versionOutput.match(/configuration: (.+)/);
      const configuration = configMatch ? configMatch[1].split(' ') : [];

      // Parse codecs
      const codecLines = codecsOutput.split('\n').slice(10); // Skip header
      const codecs = codecLines
        .filter(line => line.trim().length > 0 && !line.startsWith(' '))
        .map(line => line.split(' ').pop() || '')
        .filter(codec => codec.length > 0);

      // Parse formats
      const formatLines = formatsOutput.split('\n').slice(4); // Skip header
      const formats = formatLines
        .filter(line => line.trim().length > 0 && !line.startsWith(' '))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return parts.length > 1 ? parts[1] : '';
        })
        .filter(format => format.length > 0);

      // Parse filters
      const filterLines = filtersOutput.split('\n').slice(8); // Skip header
      const filters = filterLines
        .filter(line => line.trim().length > 0 && !line.startsWith(' '))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return parts.length > 2 ? parts[2] : '';
        })
        .filter(filter => filter.length > 0);

      // Parse protocols
      const protocolLines = protocolsOutput.split('\n');
      const inputStart = protocolLines.findIndex(line => line.includes('Input:'));
      const outputStart = protocolLines.findIndex(line => line.includes('Output:'));
      const protocols = [
        ...protocolLines.slice(inputStart + 1, outputStart).join(' ').split(/\s+/),
        ...protocolLines.slice(outputStart + 1).join(' ').split(/\s+/)
      ].filter(protocol => protocol.trim().length > 0);

      this.ffmpegCache = {
        version,
        path: ffmpegPath,
        configuration,
        codecs,
        formats,
        filters,
        protocols
      };

      return this.ffmpegCache;
    } catch (error) {
      throw new Error(`Failed to get FFMPEG info: ${error}`);
    }
  }

  /**
   * Detect system information including GPUs and hardware acceleration
   */
  async getSystemInfo(): Promise<SystemInfo> {
    // Check cache TTL
    const cacheTTL = parseInt(process.env.GPU_DETECTION_CACHE_TTL || '300000'); // 5 minutes default
    if (this.systemInfoCache && this.cacheTimestamp && (Date.now() - this.cacheTimestamp < cacheTTL)) {
      return this.systemInfoCache;
    }

    const platform = process.platform;
    const isUnraid = await this.detectUnraid();
    const gpus = process.env.GPU_DETECTION_ENABLED === 'false' ? [] : await this.detectGPUs();
    const hardwareAccel = process.env.ENABLE_HARDWARE_ACCEL === 'false' ? [] : await this.detectHardwareAcceleration();

    this.systemInfoCache = {
      platform,
      isUnraid,
      gpus,
      hardwareAccel
    };

    this.cacheTimestamp = Date.now();
    return this.systemInfoCache;
  }

  /**
   * Detect if running on Unraid
   */
  private async detectUnraid(): Promise<boolean> {
    try {
      // Check for Unraid-specific files and directories
      const unraidIndicators = [
        '/boot/config/docker.cfg',
        '/usr/local/emhttp',
        '/var/log/unraid'
      ];

      for (const indicator of unraidIndicators) {
        if (existsSync(indicator)) {
          return true;
        }
      }

      // Check /etc/os-release for Unraid
      if (existsSync('/etc/os-release')) {
        const osRelease = readFileSync('/etc/os-release', 'utf8');
        if (osRelease.includes('Unraid') || osRelease.includes('unRAID')) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect available GPUs
   */
  private async detectGPUs(): Promise<Array<{ vendor: 'nvidia' | 'amd' | 'intel'; model: string; driver?: string }>> {
    const gpus: Array<{ vendor: 'nvidia' | 'amd' | 'intel'; model: string; driver?: string }> = [];

    try {
      // NVIDIA GPU detection
      try {
        const { stdout: nvidiaOutput } = await execAsync('nvidia-smi --query-gpu=name,driver_version --format=csv,noheader,nounits');
        const nvidiaLines = nvidiaOutput.trim().split('\n');
        for (const line of nvidiaLines) {
          const [model, driver] = line.split(', ');
          if (model && model.trim()) {
            gpus.push({
              vendor: 'nvidia',
              model: model.trim(),
              driver: driver?.trim()
            });
          }
        }
      } catch (error) {
        // NVIDIA not available via nvidia-smi; attempt fallback detection via lspci
        try {
          const { stdout: lspciNvidia } = await execAsync('lspci | grep -i nvidia');
          const lspciLines = lspciNvidia.trim().split('\n');
          for (const line of lspciLines) {
            if (line.toLowerCase().includes('nvidia')) {
              // Extract a readable model name (everything after the VGA/3D controller text)
              const modelMatch = line.match(/NVIDIA.*?(?=\s*\(|$)/i);
              const model = modelMatch ? modelMatch[0].replace(/NVIDIA\s*/i, '').trim() : 'NVIDIA GPU';
              gpus.push({
                vendor: 'nvidia',
                model
              });
            }
          }
        } catch {
          // Fallback also failed – ignore
        }
      }

      // Intel GPU detection
      try {
        const { stdout: intelOutput } = await execAsync('lspci | grep -i "vga\\|3d\\|display" | grep -i intel');
        const intelLines = intelOutput.trim().split('\n');
        for (const line of intelLines) {
          if (line.includes('Intel')) {
            const modelMatch = line.match(/Intel.*?(?=\s*\(|$)/);
            const model = modelMatch ? modelMatch[0].trim() : 'Intel GPU';
            gpus.push({
              vendor: 'intel',
              model
            });
          }
        }
      } catch (error) {
        // Intel GPU detection failed
      }

      // AMD GPU detection
      try {
        const { stdout: amdOutput } = await execAsync('lspci | grep -i "vga\\|3d\\|display" | grep -i amd');
        const amdLines = amdOutput.trim().split('\n');
        for (const line of amdLines) {
          if (line.includes('AMD') || line.includes('ATI')) {
            const modelMatch = line.match(/(AMD|ATI).*?(?=\s*\(|$)/);
            const model = modelMatch ? modelMatch[0].trim() : 'AMD GPU';
            gpus.push({
              vendor: 'amd',
              model
            });
          }
        }
      } catch (error) {
        // AMD GPU detection failed
      }
    } catch (error) {
      console.warn('GPU detection failed:', error);
    }

    return gpus;
  }

  /**
   * Detect available hardware acceleration options
   */
  private async detectHardwareAcceleration(): Promise<HardwareAccelInfo[]> {
    const hardwareAccel: HardwareAccelInfo[] = [];

    try {
      const ffmpegInfo = await this.getFfmpegInfo();

      // NVIDIA NVENC detection
      if (ffmpegInfo.codecs.some(codec => codec.includes('nvenc'))) {
        const encoders = ffmpegInfo.codecs.filter(codec => codec.includes('nvenc'));
        hardwareAccel.push({
          type: 'nvenc',
          device: 'cuda:0',
          encoders,
          supported: true
        });
      }

      // Intel Quick Sync (QSV) detection
      if (ffmpegInfo.codecs.some(codec => codec.includes('qsv'))) {
        const encoders = ffmpegInfo.codecs.filter(codec => codec.includes('qsv'));
        hardwareAccel.push({
          type: 'qsv',
          encoders,
          supported: true
        });
      }

      // VA-API detection (Intel/AMD on Linux)
      if (ffmpegInfo.codecs.some(codec => codec.includes('vaapi'))) {
        const encoders = ffmpegInfo.codecs.filter(codec => codec.includes('vaapi'));
        // Detect VA-API device - use environment variable or auto-detect
        let device = process.env.HARDWARE_ACCEL_DEVICE || '/dev/dri/renderD128';
        
        if (!process.env.HARDWARE_ACCEL_DEVICE) {
          try {
            const { stdout } = await execAsync('ls /dev/dri/renderD*');
            const devices = stdout.trim().split('\n');
            if (devices.length > 0) {
              device = devices[0];
            }
          } catch (error) {
            // Use default
          }
        }
        
        hardwareAccel.push({
          type: 'vaapi',
          device,
          encoders,
          supported: true
        });
      }

      // VideoToolbox detection (macOS)
      if (process.platform === 'darwin' && ffmpegInfo.codecs.some(codec => codec.includes('videotoolbox'))) {
        const encoders = ffmpegInfo.codecs.filter(codec => codec.includes('videotoolbox'));
        hardwareAccel.push({
          type: 'videotoolbox',
          encoders,
          supported: true
        });
      }

    } catch (error) {
      console.warn('Hardware acceleration detection failed:', error);
    }

    // Add software fallback
    hardwareAccel.push({
      type: 'none',
      encoders: ['libx264', 'libx265'],
      supported: true
    });

    return hardwareAccel;
  }

  /**
   * Test hardware acceleration configuration
   */
  async testHardwareAcceleration(
    type: string,
    device?: string,
    ffmpegPath: string = process.env.FFMPEG_PATH || 'ffmpeg'
  ): Promise<{ success: boolean; error?: string; performance?: number }> {
    // Check if testing is enabled
    if (process.env.FFMPEG_TEST_ENABLED === 'false') {
      return { success: false, error: 'Hardware acceleration testing is disabled' };
    }

    try {
      const testCommand = this.buildTestCommand(type, device, ffmpegPath);
      
      const timeout = parseInt(process.env.HARDWARE_ACCEL_TEST_TIMEOUT || '10000');
      const startTime = Date.now();
      await execAsync(testCommand, { timeout }); // Configurable timeout
      const endTime = Date.now();
      
      return {
        success: true,
        performance: endTime - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build test command for hardware acceleration
   */
  private buildTestCommand(type: string, device?: string, ffmpegPath: string = process.env.FFMPEG_PATH || 'ffmpeg'): string {
    let hwAccelArgs = '';
    let encoderArgs = '';

    switch (type) {
      case 'nvenc':
        hwAccelArgs = '-hwaccel cuda';
        encoderArgs = '-c:v h264_nvenc';
        break;
      case 'qsv':
        hwAccelArgs = '-hwaccel qsv';
        encoderArgs = '-c:v h264_qsv';
        break;
      case 'vaapi':
        hwAccelArgs = `-hwaccel vaapi -hwaccel_device ${device || '/dev/dri/renderD128'}`;
        encoderArgs = '-c:v h264_vaapi';
        break;
      case 'videotoolbox':
        hwAccelArgs = '-hwaccel videotoolbox';
        encoderArgs = '-c:v h264_videotoolbox';
        break;
      default:
        encoderArgs = '-c:v libx264';
    }

    return `"${ffmpegPath}" ${hwAccelArgs} -f lavfi -i testsrc=duration=1:size=320x240:rate=30 ${encoderArgs} -f null -`;
  }

  /**
   * Get recommended settings based on system capabilities
   */
  async getRecommendedSettings(): Promise<{
    ffmpegPath: string;
    enableTranscoding: boolean;
    hardwareAccel: HardwareAccelInfo | null;
    threads: number;
    targetResolution: string;
  }> {
    const systemInfo = await this.getSystemInfo();
    const ffmpegPaths = await this.detectFfmpegPath();
    
    // Determine best hardware acceleration
    let recommendedHwAccel: HardwareAccelInfo | null = null;
    for (const hwAccel of systemInfo.hardwareAccel) {
      if (hwAccel.type !== 'none' && hwAccel.supported) {
        recommendedHwAccel = hwAccel;
        break;
      }
    }

    // Determine optimal thread count
    const cpuCount = require('os').cpus().length;
    const recommendedThreads = Math.min(cpuCount, 8); // Cap at 8 threads

    return {
      ffmpegPath: ffmpegPaths[0] || 'ffmpeg',
      enableTranscoding: true,
      hardwareAccel: recommendedHwAccel,
      threads: recommendedThreads,
      targetResolution: '1920x1080'
    };
  }

  /**
   * Clear caches (useful for testing or when system changes)
   */
  clearCache(): void {
    this.ffmpegCache = null;
    this.systemInfoCache = null;
  }
}

export const ffmpegService = FfmpegService.getInstance(); 