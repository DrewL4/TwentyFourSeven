"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings, Server, Radio, Video, Save, ExternalLink, Calendar, Download } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import FirstTimeSetup from "@/components/first-time-setup";
import WatchTowerConnectionSetup from "@/components/watchtower-connection-setup";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    port: 8089,
    ffmpegPath: '',
    concurrentStreams: 1,
    hdhrActive: true,
    hdhrDeviceId: '12345678',
    hdhrFriendlyName: 'My TwentyFourSeven',
    hdhrTunerCount: 2,
    guideDays: 3
  });

  const [showWatchTowerSetup, setShowWatchTowerSetup] = useState(false);

  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());

  const updateSettingsMutation = useMutation(orpc.settings.update.mutationOptions({
    onSuccess: () => {
      // Invalidate and refetch the settings
      queryClient.invalidateQueries({ queryKey: orpc.settings.get.queryOptions().queryKey });
    }
  }));

  // Update local state when query data changes
  useEffect(() => {
    if (settingsQuery.data) {
      setSettings({
        port: settingsQuery.data.port,
        ffmpegPath: settingsQuery.data.ffmpegPath || '',
        concurrentStreams: settingsQuery.data.concurrentStreams,
        hdhrActive: settingsQuery.data.hdhrActive,
        hdhrDeviceId: settingsQuery.data.hdhrDeviceId,
        hdhrFriendlyName: settingsQuery.data.hdhrFriendlyName,
        hdhrTunerCount: settingsQuery.data.hdhrTunerCount,
        guideDays: settingsQuery.data.guideDays || 3
      });
    }
  }, [settingsQuery.data]);

  const handleSave = () => {
    updateSettingsMutation.mutate({
      port: settings.port,
      ffmpegPath: settings.ffmpegPath || undefined,
      concurrentStreams: settings.concurrentStreams,
      hdhrActive: settings.hdhrActive,
      hdhrDeviceId: settings.hdhrDeviceId,
      hdhrFriendlyName: settings.hdhrFriendlyName,
      hdhrTunerCount: settings.hdhrTunerCount,
      guideDays: settings.guideDays
    });
  };

  const hasChanges = () => {
    if (!settingsQuery.data) return false;
    
    return (
      settings.port !== settingsQuery.data.port ||
      settings.ffmpegPath !== (settingsQuery.data.ffmpegPath || '') ||
      settings.concurrentStreams !== settingsQuery.data.concurrentStreams ||
      settings.hdhrActive !== settingsQuery.data.hdhrActive ||
      settings.hdhrDeviceId !== settingsQuery.data.hdhrDeviceId ||
      settings.hdhrFriendlyName !== settingsQuery.data.hdhrFriendlyName ||
      settings.hdhrTunerCount !== settingsQuery.data.hdhrTunerCount ||
      settings.guideDays !== (settingsQuery.data.guideDays || 3)
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="w-8 h-8 text-orange-600" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your TwentyFourSeven server and streaming settings
          </p>
        </div>
        
        <Button 
          onClick={handleSave}
          disabled={!hasChanges() || updateSettingsMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {updateSettingsMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {settingsQuery.isLoading ? (
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
        <div className="space-y-6">
          {/* Server Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Server Configuration
              </CardTitle>
              <CardDescription>
                Basic server settings and network configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="port">Server Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={settings.port}
                    onChange={(e) => setSettings(prev => ({ ...prev, port: parseInt(e.target.value) || 8089 }))}
                    min="1"
                    max="65535"
                  />
                  <p className="text-xs text-muted-foreground">
                    Port for the web interface and API (default: 8089)
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="concurrentStreams">Concurrent Streams</Label>
                  <Input
                    id="concurrentStreams"
                    type="number"
                    value={settings.concurrentStreams}
                    onChange={(e) => setSettings(prev => ({ ...prev, concurrentStreams: parseInt(e.target.value) || 1 }))}
                    min="1"
                    max="10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of simultaneous streams
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Guide Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Guide Configuration
              </CardTitle>
              <CardDescription>
                Configure how many days of programming guide data to generate
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guideDays">Guide Days</Label>
                <Input
                  id="guideDays"
                  type="number"
                  value={settings.guideDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, guideDays: parseInt(e.target.value) || 3 }))}
                  min="1"
                  max="14"
                />
                <p className="text-xs text-muted-foreground">
                  Number of days of guide data to generate for XMLTV and programming display (1-14 days). 
                  If there isn't enough content to fill the time period, programming will loop back to the beginning.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* FFMPEG Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="w-5 h-5" />
                Video Processing
              </CardTitle>
              <CardDescription>
                Configure FFMPEG for video transcoding, hardware acceleration, and streaming
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">FFMPEG Configuration</p>
                  <p className="text-xs text-muted-foreground">
                    Advanced video encoding, transcoding settings, and hardware acceleration
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href="/settings/ffmpeg">
                    Configure FFMPEG
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="ffmpegPath">FFMPEG Path (Legacy)</Label>
                <Input
                  id="ffmpegPath"
                  value={settings.ffmpegPath}
                  onChange={(e) => setSettings(prev => ({ ...prev, ffmpegPath: e.target.value }))}
                  placeholder="/usr/bin/ffmpeg (leave empty for auto-detection)"
                />
                <p className="text-xs text-muted-foreground">
                  Basic FFMPEG path setting. For advanced configuration, use the dedicated FFMPEG settings page.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Plex Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5 text-orange-600" />
                Plex Integration
              </CardTitle>
              <CardDescription>
                Connect and manage your Plex media servers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Plex Server Management</p>
                  <p className="text-xs text-muted-foreground">
                    Add Plex servers, sync libraries, and configure integration settings
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href="/settings/plex">
                    Configure Plex
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* HDHomeRun Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radio className="w-5 h-5" />
                HDHomeRun Emulation
              </CardTitle>
              <CardDescription>
                Configure HDHomeRun tuner emulation for Plex and other DVR software
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hdhrActive"
                  checked={settings.hdhrActive}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, hdhrActive: !!checked }))}
                />
                <Label htmlFor="hdhrActive" className="text-sm font-medium">
                  Enable HDHomeRun emulation
                </Label>
              </div>
              
              {settings.hdhrActive && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="hdhrDeviceId">Device ID</Label>
                    <Input
                      id="hdhrDeviceId"
                      value={settings.hdhrDeviceId}
                      onChange={(e) => setSettings(prev => ({ ...prev, hdhrDeviceId: e.target.value }))}
                      placeholder="12345678"
                    />
                    <p className="text-xs text-muted-foreground">
                      Unique 8-character device identifier
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="hdhrFriendlyName">Friendly Name</Label>
                    <Input
                      id="hdhrFriendlyName"
                      value={settings.hdhrFriendlyName}
                      onChange={(e) => setSettings(prev => ({ ...prev, hdhrFriendlyName: e.target.value }))}
                      placeholder="My TwentyFourSeven"
                    />
                    <p className="text-xs text-muted-foreground">
                      Name shown in Plex and other applications
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="hdhrTunerCount">Tuner Count</Label>
                    <Input
                      id="hdhrTunerCount"
                      type="number"
                      value={settings.hdhrTunerCount}
                      onChange={(e) => setSettings(prev => ({ ...prev, hdhrTunerCount: parseInt(e.target.value) || 2 }))}
                      min="1"
                      max="8"
                    />
                    <p className="text-xs text-muted-foreground">
                      Number of virtual tuners (1-8)
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* WatchTower Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-blue-600" />
                WatchTower Integration
              </CardTitle>
              <CardDescription>
                Import users and settings from your WatchTower application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Import from WatchTower</p>
                  <p className="text-xs text-muted-foreground">
                    Connect to your WatchTower instance and import users, settings, and configuration
                  </p>
                </div>
                <Button 
                  onClick={() => setShowWatchTowerSetup(true)}
                  variant="outline"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Import from WatchTower
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* URLs and Integration */}
          <Card>
            <CardHeader>
              <CardTitle>Integration URLs</CardTitle>
              <CardDescription>
                Use these URLs to integrate with Plex, Emby, and other applications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">M3U Playlist</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={`${window.location.origin}/media.m3u`}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/media.m3u`)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                
                <div>
                  <Label className="text-sm font-medium">XMLTV Guide</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={`${window.location.origin}/media.xml`}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/media.xml`)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                
                {settings.hdhrActive && (
                  <div>
                    <Label className="text-sm font-medium">HDHomeRun Discovery URL</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        value={`${window.location.origin}/discover.json`}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/discover.json`)}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* WatchTower Setup Modal */}
      {showWatchTowerSetup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-900 p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">WatchTower Import</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWatchTowerSetup(false)}
              >
                ✕
              </Button>
            </div>
            <div className="p-4">
              <WatchTowerConnectionSetup />
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 