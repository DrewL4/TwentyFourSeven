"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { 
  Video, 
  Settings, 
  Cpu, 
  HardDrive, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Info,
  Monitor,
  Zap,
  Save,
  TestTube,
  Gauge,
  Lock,
  Unlock
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import Link from "next/link";

interface FfmpegInfo {
  version: string;
  path: string;
  configuration: string[];
  codecs: string[];
  formats: string[];
  filters: string[];
  protocols: string[];
}

interface HardwareAccelInfo {
  type: 'nvenc' | 'vaapi' | 'qsv' | 'videotoolbox' | 'none';
  device?: string;
  encoders: string[];
  supported: boolean;
}

interface SystemInfo {
  platform: string;
  isUnraid: boolean;
  gpus: Array<{
    vendor: 'nvidia' | 'amd' | 'intel';
    model: string;
    driver?: string;
  }>;
  hardwareAccel: HardwareAccelInfo[];
}

// Define options arrays outside component to prevent recreation on re-renders
const resolutionOptions = [
  { value: 'original', label: 'No scaling (original resolution)' },
  { value: '720x480', label: '720x480 (480p)' },
  { value: '1280x720', label: '1280x720 (720p)' },
  { value: '1920x1080', label: '1920x1080 (1080p)' },
  { value: '2560x1440', label: '2560x1440 (1440p)' },
  { value: '3840x2160', label: '3840x2160 (4K)' }
];

const x264PresetOptions = [
  { value: 'ultrafast', label: 'Ultrafast (lowest quality, fastest encoding)' },
  { value: 'superfast', label: 'Superfast' },
  { value: 'veryfast', label: 'Very Fast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium (balanced)' },
  { value: 'slow', label: 'Slow' },
  { value: 'slower', label: 'Slower' },
  { value: 'veryslow', label: 'Very Slow (highest quality, slowest encoding)' }
];

const nvencPresetOptions = [
  { value: 'p1', label: 'P1 (Fastest, Lower Quality)' },
  { value: 'p2', label: 'P2' },
  { value: 'p3', label: 'P3 (Fast)' },
  { value: 'p4', label: 'P4 (Medium)' },
  { value: 'p5', label: 'P5 (Slow, Good Quality)' },
  { value: 'p6', label: 'P6 (Slower, Better Quality)' },
  { value: 'p7', label: 'P7 (Slowest, Best Quality)' },
];

const videoCodecOptions = [
    { value: 'libx264', label: 'H.264 (libx264, CPU)' },
    { value: 'libx265', label: 'H.265/HEVC (libx265, CPU)' },
    { value: 'h264_nvenc', label: 'H.264 (NVIDIA NVENC)' },
    { value: 'hevc_nvenc', label: 'H.265/HEVC (NVIDIA NVENC)' },
    { value: 'h264_qsv', label: 'H.264 (Intel QSV)' },
    { value: 'hevc_qsv', label: 'H.265/HEVC (Intel QSV)' },
    { value: 'h264_vaapi', label: 'H.264 (VAAPI)' },
    { value: 'hevc_vaapi', label: 'H.265/HEVC (VAAPI)' },
    { value: 'h264_videotoolbox', label: 'H.264 (Apple VideoToolbox)' },
    { value: 'hevc_videotoolbox', label: 'H.265/HEVC (Apple VideoToolbox)' },
    { value: 'copy', label: 'Copy (No Transcoding)' },
];

const audioCodecOptions = [
    { value: 'aac', label: 'AAC (Advanced Audio Coding)' },
    { value: 'ac3', label: 'AC3 (Dolby Digital)' },
    { value: 'mp3', label: 'MP3' },
    { value: 'copy', label: 'Copy (No Transcoding)' },
];

const errorScreenOptions = [
  { value: 'pic', label: 'Error Image' },
  { value: 'blank', label: 'Blank Screen' },
  { value: 'static', label: 'Static Noise' },
  { value: 'testsrc', label: 'Test Pattern' },
  { value: 'text', label: 'Error Text' },
  { value: 'kill', label: 'Stop Stream' }
];

const errorAudioOptions = [
  { value: 'silent', label: 'Silent' },
  { value: 'whitenoise', label: 'White Noise' },
  { value: 'sine', label: 'Beep Tone' }
];

const logLevelOptions = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'panic', label: 'Panic' },
  { value: 'fatal', label: 'Fatal' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'verbose', label: 'Verbose' },
  { value: 'debug', label: 'Debug' },
  { value: 'trace', label: 'Trace' }
];

export default function FfmpegSettingsPage() {
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [isDetecting, setIsDetecting] = useState(false);
  const [ffmpegInfo, setFfmpegInfo] = useState<FfmpegInfo | null>(null);
  const [videoPresetOptions, setVideoPresetOptions] = useState(x264PresetOptions);

  const queryClient = useQueryClient();
  const ffmpegSettingsQuery = useQuery(orpc.settings.ffmpeg.get.queryOptions());
  const systemInfoQuery = useQuery(orpc.settings.ffmpeg.systemInfo.queryOptions());

  const updateFfmpegMutation = useMutation(orpc.settings.ffmpeg.update.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ffmpeg"] });
    }
  }));

  const detectPathsMutation = useMutation(orpc.settings.ffmpeg.detectPaths.mutationOptions());
  const validatePathMutation = useMutation(orpc.settings.ffmpeg.validatePath.mutationOptions());
  const getInfoMutation = useMutation(orpc.settings.ffmpeg.getInfo.mutationOptions());
  const testHardwareAccelMutation = useMutation(orpc.settings.ffmpeg.testHardwareAccel.mutationOptions());
  const getRecommendedMutation = useMutation(orpc.settings.ffmpeg.getRecommendedSettings.mutationOptions());

  const [settings, setSettings] = useState({
    // Executable settings
    ffmpegPath: '',
    ffprobePath: '',
    pathLocked: false,
    autoDetectPath: true,
    
    // Transcoding settings
    enableTranscoding: true,
    targetResolution: '1920x1080',
    videoBitrate: '3000k',
    videoBufSize: '6000k',
    videoCodec: 'libx264',
    audioCodec: 'aac',
    audioSampleRate: 48000,
    audioBitrate: '128k',
    audioChannels: 2,
    
    // Hardware acceleration
    enableHardwareAccel: false,
    hardwareAccelType: 'none',
    hardwareDevice: '',
    
    // Quality settings
    videoPreset: 'medium',
    videoCrf: 23,
    maxMuxingQueueSize: 1024,
    threads: 0,
    
    // Format settings
    outputFormat: 'mpegts',
    segmentTime: 2,
    segmentListSize: 5,
    
    // Error handling
    errorScreen: 'pic',
    errorAudio: 'silent',
    
    // Logging
    logLevel: 'error',
    enableStats: false,
    statsFilePath: '',
    
    // Advanced
    globalOptions: '',
    inputOptions: '',
    outputOptions: ''
  });

  useEffect(() => {
    if (settings.videoCodec.includes('nvenc')) {
      setVideoPresetOptions(nvencPresetOptions);
    } else {
      setVideoPresetOptions(x264PresetOptions);
    }
  }, [settings.videoCodec]);

  useEffect(() => {
    if (ffmpegSettingsQuery.data) {
      setSettings({
        ffmpegPath: ffmpegSettingsQuery.data.ffmpegPath || '',
        ffprobePath: ffmpegSettingsQuery.data.ffprobePath || '',
        pathLocked: ffmpegSettingsQuery.data.pathLocked || false,
        autoDetectPath: ffmpegSettingsQuery.data.autoDetectPath || true,
        enableTranscoding: ffmpegSettingsQuery.data.enableTranscoding || true,
        targetResolution: ffmpegSettingsQuery.data.targetResolution || '1920x1080',
        videoBitrate: ffmpegSettingsQuery.data.videoBitrate || '3000k',
        videoBufSize: ffmpegSettingsQuery.data.videoBufSize || '6000k',
        videoCodec: ffmpegSettingsQuery.data.videoCodec || 'libx264',
        audioCodec: ffmpegSettingsQuery.data.audioCodec || 'aac',
        audioSampleRate: ffmpegSettingsQuery.data.audioSampleRate || 48000,
        audioBitrate: ffmpegSettingsQuery.data.audioBitrate || '128k',
        audioChannels: ffmpegSettingsQuery.data.audioChannels || 2,
        enableHardwareAccel: ffmpegSettingsQuery.data.enableHardwareAccel || false,
        hardwareAccelType: ffmpegSettingsQuery.data.hardwareAccelType || 'none',
        hardwareDevice: ffmpegSettingsQuery.data.hardwareDevice || '',
        videoPreset: ffmpegSettingsQuery.data.videoPreset || 'medium',
        videoCrf: ffmpegSettingsQuery.data.videoCrf || 23,
        maxMuxingQueueSize: ffmpegSettingsQuery.data.maxMuxingQueueSize || 1024,
        threads: ffmpegSettingsQuery.data.threads || 0,
        outputFormat: ffmpegSettingsQuery.data.outputFormat || 'mpegts',
        segmentTime: ffmpegSettingsQuery.data.segmentTime || 2,
        segmentListSize: ffmpegSettingsQuery.data.segmentListSize || 5,
        errorScreen: ffmpegSettingsQuery.data.errorScreen || 'pic',
        errorAudio: ffmpegSettingsQuery.data.errorAudio || 'silent',
        logLevel: ffmpegSettingsQuery.data.logLevel || 'error',
        enableStats: ffmpegSettingsQuery.data.enableStats || false,
        statsFilePath: ffmpegSettingsQuery.data.statsFilePath || '',
        globalOptions: ffmpegSettingsQuery.data.globalOptions || '',
        inputOptions: ffmpegSettingsQuery.data.inputOptions || '',
        outputOptions: ffmpegSettingsQuery.data.outputOptions || ''
      });
    }
  }, [ffmpegSettingsQuery.data]);

  const isPresetAvailable = (type: 'nvenc' | 'qsv' | 'vaapi' | 'cpu') => {
    if (type === 'cpu') return true;
    if (!systemInfoQuery.data) return false;
    
    const hasGpu = systemInfoQuery.data.gpus.some(gpu => {
      if (type === 'nvenc') return gpu.vendor === 'nvidia';
      if (type === 'qsv') return gpu.vendor === 'intel';
      if (type === 'vaapi') return gpu.vendor === 'amd';
      return false;
    });

    const hasHwAccel = systemInfoQuery.data.hardwareAccel.some(accel => accel.type === type && accel.supported);

    return hasGpu && hasHwAccel;
  };

  const handleApplyPreset = (type: 'nvenc' | 'qsv' | 'vaapi' | 'cpu') => {
    let presetSettings: Partial<typeof settings> = {};
    switch (type) {
      case 'nvenc':
        presetSettings = {
          enableHardwareAccel: true,
          hardwareAccelType: 'nvenc',
          videoCodec: 'h264_nvenc',
          videoPreset: 'p4', // Medium preset for NVENC
          videoBitrate: '8000k',
          videoBufSize: '16000k',
          enableTranscoding: true,
        };
        break;
      case 'qsv':
        presetSettings = {
          enableHardwareAccel: true,
          hardwareAccelType: 'qsv',
          videoCodec: 'h264_qsv',
          videoPreset: 'fast',
          videoBitrate: '8000k',
          videoBufSize: '16000k',
          enableTranscoding: true,
        };
        break;
      case 'vaapi':
        presetSettings = {
          enableHardwareAccel: true,
          hardwareAccelType: 'vaapi',
          videoCodec: 'h264_vaapi',
          videoPreset: 'fast',
          videoBitrate: '8000k',
          videoBufSize: '16000k',
          enableTranscoding: true,
        };
        break;
      case 'cpu':
      default:
        presetSettings = {
          enableHardwareAccel: false,
          hardwareAccelType: 'none',
          videoCodec: 'libx264',
          videoPreset: 'fast',
          videoBitrate: '4000k',
          videoBufSize: '8000k',
          threads: 0, // 0 for auto
          enableTranscoding: true,
        };
        break;
    }

    setSettings(prev => ({
      ...prev,
      ...presetSettings,
      // Reset some other things to sensible defaults for a preset
      audioCodec: 'aac',
      audioBitrate: '192k',
      audioChannels: 2,
      targetResolution: '1920x1080',
      outputFormat: 'mpegts',
    }));
  };

  const handleSave = () => {
    updateFfmpegMutation.mutate(settings);
  };

  const handleDetectPaths = async () => {
    setIsDetecting(true);
    try {
      const paths = await detectPathsMutation.mutateAsync({});
      if (paths.length > 0) {
        setSettings(prev => ({ ...prev, ffmpegPath: paths[0] }));
      }
    } finally {
      setIsDetecting(false);
    }
  };

  const handleValidatePath = async () => {
    if (!settings.ffmpegPath) return;
    
    const isValid = await validatePathMutation.mutateAsync({ path: settings.ffmpegPath });
    if (isValid) {
      const info = await getInfoMutation.mutateAsync({ path: settings.ffmpegPath });
      setFfmpegInfo(info);
    }
  };

  const handleTestHardwareAccel = async (type: string, device?: string) => {
    const result = await testHardwareAccelMutation.mutateAsync({
      type,
      device,
      ffmpegPath: settings.ffmpegPath || undefined
    });
    
    setTestResults(prev => ({
      ...prev,
      [type]: result
    }));
  };

  const handleApplyRecommended = async () => {
    const recommended = await getRecommendedMutation.mutateAsync({});
    setSettings(prev => ({
      ...prev,
      ffmpegPath: recommended.ffmpegPath,
      enableTranscoding: recommended.enableTranscoding,
      threads: recommended.threads,
      targetResolution: recommended.targetResolution,
      enableHardwareAccel: !!recommended.hardwareAccel,
      hardwareAccelType: recommended.hardwareAccel?.type || 'none',
      hardwareDevice: recommended.hardwareAccel?.device || ''
    }));
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Video className="w-8 h-8 text-orange-600" />
            FFMPEG Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure video transcoding, hardware acceleration, and encoding settings
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button 
            onClick={handleApplyRecommended}
            variant="outline"
            disabled={getRecommendedMutation.isPending}
          >
            <Zap className="w-4 h-4 mr-2" />
            Apply Recommended
          </Button>
          <Button 
            onClick={handleSave}
            disabled={updateFfmpegMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {updateFfmpegMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>

      {/* System Information */}
      {systemInfoQuery.data && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5" />
              System Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-medium">Platform</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">{systemInfoQuery.data.platform}</Badge>
                  {systemInfoQuery.data.isUnraid && (
                    <Badge variant="secondary">Unraid</Badge>
                  )}
                </div>
              </div>
              
              <div>
                <Label className="text-sm font-medium">GPUs Detected</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {systemInfoQuery.data.gpus.length > 0 ? (
                    systemInfoQuery.data.gpus.map((gpu, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {gpu.vendor.toUpperCase()}: {gpu.model}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None detected</span>
                  )}
                </div>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Hardware Acceleration</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {systemInfoQuery.data.hardwareAccel
                    .filter(hw => hw.type !== 'none')
                    .map((hw, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {hw.type.toUpperCase()}
                      </Badge>
                    ))
                  }
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Presets */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Configuration Presets
          </CardTitle>
          <CardDescription>
            Apply recommended settings based on your system's hardware. These presets offer a good starting point for common configurations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Detected Hardware: {systemInfoQuery.isLoading ? 'Detecting...' :
              (systemInfoQuery.data && systemInfoQuery.data.gpus.length > 0 ?
                systemInfoQuery.data.gpus.map(gpu => `${gpu.vendor.toUpperCase()} ${gpu.model}`).join(', ') :
                'No dedicated GPU detected')
            }
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Button variant="outline" onClick={() => handleApplyPreset('nvenc')} disabled={!isPresetAvailable('nvenc')}>
              NVIDIA NVENC (Recommended)
            </Button>
            <Button variant="outline" onClick={() => handleApplyPreset('qsv')} disabled={!isPresetAvailable('qsv')}>
              Intel QSV (Recommended)
            </Button>
            <Button variant="outline" onClick={() => handleApplyPreset('vaapi')} disabled={!isPresetAvailable('vaapi')}>
              AMD VCN (Recommended)
            </Button>
            <Button variant="outline" onClick={() => handleApplyPreset('cpu')}>
              CPU / Software
            </Button>
          </div>
          {systemInfoQuery.data && systemInfoQuery.data.hardwareAccel.length === 0 && systemInfoQuery.data.gpus.length > 0 &&
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                GPU detected, but no supported hardware acceleration methods found. You may need to install drivers (e.g., NVIDIA drivers) or required libraries (e.g., `va-driver-all` for VAAPI on Linux).
              </AlertDescription>
            </Alert>
          }
        </CardContent>
      </Card>

      {ffmpegSettingsQuery.isLoading || systemInfoQuery.isLoading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="animate-pulse">
                  <div className="h-6 bg-muted rounded w-1/3 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[...Array(3)].map((_, j) => (
                    <div key={j} className="animate-pulse">
                      <div className="h-4 bg-muted rounded w-1/4 mb-2"></div>
                      <div className="h-10 bg-muted rounded"></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="transcoding">Transcoding & Quality</TabsTrigger>
            <TabsTrigger value="hardware">Hardware Acceleration</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Executable Paths</CardTitle>
                <CardDescription>
                  Configure the paths to your FFMPEG and FFProbe executables.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoDetectPath"
                    checked={settings.autoDetectPath}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoDetectPath: !!checked }))}
                    disabled={settings.pathLocked}
                  />
                  <Label htmlFor="autoDetectPath">Auto-detect FFMPEG path</Label>
                </div>

                {!settings.autoDetectPath && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="ffmpegPath">FFMPEG Path</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="ffmpegPath"
                          value={settings.ffmpegPath}
                          onChange={(e) => setSettings(prev => ({ ...prev, ffmpegPath: e.target.value }))}
                          placeholder="/usr/bin/ffmpeg"
                          disabled={settings.pathLocked}
                        />
                        <Button variant="outline" onClick={handleDetectPaths} disabled={isDetecting || settings.pathLocked}>
                          <RefreshCw className={`w-4 h-4 mr-2 ${isDetecting ? 'animate-spin' : ''}`} />
                          Detect
                        </Button>
                        <Button variant="outline" onClick={handleValidatePath}>
                          Validate
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ffprobePath">FFProbe Path</Label>
                      <Input
                        id="ffprobePath"
                        value={settings.ffprobePath}
                        onChange={(e) => setSettings(prev => ({ ...prev, ffprobePath: e.target.value }))}
                        placeholder="/usr/bin/ffprobe"
                        disabled={settings.pathLocked}
                      />
                    </div>
                  </>
                )}
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="pathLocked"
                    checked={settings.pathLocked}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, pathLocked: !!checked }))}
                  />
                  <Label htmlFor="pathLocked" className="flex items-center gap-2">
                    {settings.pathLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    Lock Paths
                  </Label>
                </div>

                {ffmpegInfo && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      FFMPEG version {ffmpegInfo.version} found at {ffmpegInfo.path}.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Error Handling</CardTitle>
                 <CardDescription>
                  Configure what happens when a stream encounters an error.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                  <Label htmlFor="errorScreen">Error Screen</Label>
                  <Select value={settings.errorScreen} onValueChange={(value) => setSettings(prev => ({ ...prev, errorScreen: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {errorScreenOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="errorAudio">Error Audio</Label>
                  <Select value={settings.errorAudio} onValueChange={(value) => setSettings(prev => ({ ...prev, errorAudio: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {errorAudioOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    What to play if the video fails but audio can continue.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcoding">
            <Card>
              <CardHeader>
                <CardTitle>Transcoding & Quality Settings</CardTitle>
                <CardDescription>
                  Configure video and audio transcoding, resolution, bitrates, and quality settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableTranscoding"
                    checked={settings.enableTranscoding}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableTranscoding: !!checked }))}
                  />
                  <Label htmlFor="enableTranscoding">Enable Transcoding</Label>
                </div>
                
                {settings.enableTranscoding && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                       <h4 className="font-semibold text-lg">Video</h4>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="videoCodec">Video Codec</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The encoder to use for video. `libx264` is a great default. Use hardware-specific codecs (NVENC, QSV) if available.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Select value={settings.videoCodec} onValueChange={(value) => setSettings(prev => ({ ...prev, videoCodec: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select a codec" /></SelectTrigger>
                            <SelectContent>
                              {videoCodecOptions.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                         <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="targetResolution">Target Resolution</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The output resolution for the video. 'Original' is recommended to avoid scaling.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Select value={settings.targetResolution} onValueChange={(value) => setSettings(prev => ({ ...prev, targetResolution: value }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {resolutionOptions.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <div className="flex items-center gap-2">
                            <Label htmlFor="videoBitrate">Video Bitrate</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The target bitrate for the video in kilobits per second (e.g., 4000k). Higher values mean better quality and larger file sizes.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="videoBitrate" value={settings.videoBitrate} onChange={(e) => setSettings(prev => ({ ...prev, videoBitrate: e.target.value }))} placeholder="3000k" />
                           <p className="text-xs text-muted-foreground">Recommended: 4000k for 1080p, 8000k for 4K</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="videoBufSize">Video Buffer Size</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The size of the buffer for the video stream. Typically set to 2x the bitrate.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="videoBufSize" value={settings.videoBufSize} onChange={(e) => setSettings(prev => ({ ...prev, videoBufSize: e.target.value }))} placeholder="6000k" />
                           <p className="text-xs text-muted-foreground">Recommended: 8000k (for 4000k bitrate)</p>
                        </div>
                        <div className="space-y-2">
                           <div className="flex items-center gap-2">
                             <Label htmlFor="videoPreset">Encoding Preset</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>This setting controls the trade-off between encoding speed and quality. 'fast' is a good balance.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                           <Select value={settings.videoPreset} onValueChange={(value) => setSettings(prev => ({ ...prev, videoPreset: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select a preset" /></SelectTrigger>
                            <SelectContent>
                              {videoPresetOptions.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="videoCrf">Constant Rate Factor (CRF)</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>A quality setting for x264/x265 encoders. Lower values are higher quality. 23 is a good default.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="videoCrf" type="number" min="0" max="51" value={settings.videoCrf} onChange={(e) => setSettings(prev => ({ ...prev, videoCrf: parseInt(e.target.value) || 23 }))} />
                           <p className="text-xs text-muted-foreground">Recommended: 23</p>
                        </div>
                    </div>
                     <div className="space-y-4">
                       <h4 className="font-semibold text-lg">Audio</h4>
                        <div className="space-y-2">
                           <div className="flex items-center gap-2">
                            <Label htmlFor="audioCodec">Audio Codec</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The encoder to use for audio. AAC is a very common and compatible choice.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                           <Select value={settings.audioCodec} onValueChange={(value) => setSettings(prev => ({ ...prev, audioCodec: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select a codec" /></SelectTrigger>
                            <SelectContent>
                              {audioCodecOptions.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="audioBitrate">Audio Bitrate</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The target bitrate for the audio in kilobits per second (e.g., 192k).</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="audioBitrate" value={settings.audioBitrate} onChange={(e) => setSettings(prev => ({ ...prev, audioBitrate: e.target.value }))} placeholder="128k" />
                           <p className="text-xs text-muted-foreground">Recommended: 192k for stereo</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="audioSampleRate">Sample Rate (Hz)</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The sample rate for the audio. 48000 Hz is standard for video.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="audioSampleRate" type="number" value={settings.audioSampleRate} onChange={(e) => setSettings(prev => ({ ...prev, audioSampleRate: parseInt(e.target.value) || 48000 }))} />
                           <p className="text-xs text-muted-foreground">Recommended: 48000</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="audioChannels">Audio Channels</Label>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger>
                                <TooltipContent><p>The number of audio channels. 2 is standard for stereo.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Input id="audioChannels" type="number" min="1" max="8" value={settings.audioChannels} onChange={(e) => setSettings(prev => ({ ...prev, audioChannels: parseInt(e.target.value) || 2 }))} />
                           <p className="text-xs text-muted-foreground">Recommended: 2 (Stereo)</p>
                        </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="hardware">
            <Card>
              <CardHeader>
                <CardTitle>Hardware Acceleration</CardTitle>
                <CardDescription>
                  Configure hardware acceleration for video transcoding. This can significantly improve performance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableHardwareAccel"
                    checked={settings.enableHardwareAccel}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableHardwareAccel: !!checked }))}
                  />
                  <Label htmlFor="enableHardwareAccel">Enable Hardware Acceleration</Label>
                </div>
                
                {settings.enableHardwareAccel && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="hardwareAccelType">Acceleration Type</Label>
                      <Select
                        value={settings.hardwareAccelType}
                        onValueChange={(value) => setSettings(prev => ({ ...prev, hardwareAccelType: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="none">None</SelectItem>
                          <SelectItem value="nvenc">NVIDIA NVENC</SelectItem>
                          <SelectItem value="qsv">Intel QSV</SelectItem>
                          <SelectItem value="vaapi">VAAPI (AMD/Intel)</SelectItem>
                          <SelectItem value="videotoolbox">VideoToolbox (macOS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="hardwareDevice">Hardware Device</Label>
                      <Input
                        id="hardwareDevice"
                        value={settings.hardwareDevice}
                        onChange={(e) => setSettings(prev => ({ ...prev, hardwareDevice: e.target.value }))}
                        placeholder="e.g., /dev/dri/renderD128"
                      />
                       <p className="text-xs text-muted-foreground">
                        Optional device path for VAAPI.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced">
            <Card>
              <CardHeader>
                <CardTitle>Advanced & Debugging</CardTitle>
                <CardDescription>
                  Fine-tune FFMPEG with custom options and configure logging. Use with caution.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="space-y-2">
                  <Label htmlFor="logLevel">Log Level</Label>
                  <Select
                    value={settings.logLevel}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, logLevel: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select log level" />
                    </SelectTrigger>
                    <SelectContent>
                      {logLevelOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Controls the verbosity of FFMPEG's output. 'Error' is recommended for normal use.
                  </p>
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="threads">Encoding Threads</Label>
                  <Input
                    id="threads"
                    type="number"
                    value={settings.threads}
                    onChange={(e) => setSettings(prev => ({ ...prev, threads: parseInt(e.target.value) || 0 }))}
                    min="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of threads for encoding. 0 means auto.
                  </p>
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="maxMuxingQueueSize">Max Muxing Queue Size</Label>
                  <Input
                    id="maxMuxingQueueSize"
                    type="number"
                    value={settings.maxMuxingQueueSize}
                    onChange={(e) => setSettings(prev => ({ ...prev, maxMuxingQueueSize: parseInt(e.target.value) || 1024 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="globalOptions">Global Options</Label>
                  <Textarea
                    id="globalOptions"
                    value={settings.globalOptions}
                    onChange={(e) => setSettings(prev => ({ ...prev, globalOptions: e.target.value }))}
                    placeholder="-hide_banner -nostats"
                    />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inputOptions">Input Options</Label>
                  <Textarea
                    id="inputOptions"
                    value={settings.inputOptions}
                    onChange={(e) => setSettings(prev => ({ ...prev, inputOptions: e.target.value }))}
                    placeholder="-re"
                    />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outputOptions">Output Options</Label>
                  <Textarea
                    id="outputOptions"
                    value={settings.outputOptions}
                    onChange={(e) => setSettings(prev => ({ ...prev, outputOptions: e.target.value }))}
                    placeholder="-some_option value"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
} 