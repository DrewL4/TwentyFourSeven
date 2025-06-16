"use client"
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tv, Library, Settings, Play, Radio, FileText } from "lucide-react";

// Type for channel data from the API
type Channel = {
  id: string;
  number: number;
  name: string;
  icon?: string | null;
  stealth: boolean;
  groupTitle?: string | null;
};

export default function Home() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());
  const channelsQuery = useQuery(orpc.channels.list.queryOptions());
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());
  const serversQuery = useQuery(orpc.servers.list.queryOptions());

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">TwentyFour/Seven</h1>
            <p className="text-muted-foreground">Live TV from your media library</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <div className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-muted-foreground">
              {healthCheck.isLoading ? "Checking..." : healthCheck.data ? "Online" : "Offline"}
            </span>
          </div>
          
          {/* Quick Links */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/media.m3u">
                <Radio className="w-4 h-4 mr-1" />
                M3U
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/media.xml">
                <FileText className="w-4 h-4 mr-1" />
                XMLTV
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/guide">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Tv className="w-5 h-5 text-blue-600" />
                <CardTitle className="text-lg">TV Guide</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                View current and upcoming programs across all channels
              </CardDescription>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/channels">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-green-600" />
                <CardTitle className="text-lg">Channels</CardTitle>
              </div>
              <Badge variant="secondary" className="w-fit">
                {channelsQuery.data?.length || 0}
              </Badge>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Configure and manage your TV channels
              </CardDescription>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/library">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Library className="w-5 h-5 text-purple-600" />
                <CardTitle className="text-lg">Library</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Browse and manage your media libraries
              </CardDescription>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/settings">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-600" />
                <CardTitle className="text-lg">Settings</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Configure servers, streaming, and preferences
              </CardDescription>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Radio className="w-5 h-5" />
              Active Channels
            </CardTitle>
          </CardHeader>
          <CardContent>
            {channelsQuery.isLoading ? (
              <div className="animate-pulse bg-muted h-8 rounded"></div>
            ) : (
              <div className="text-2xl font-bold">
                {channelsQuery.data?.length || 0}
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Configured TV channels
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="w-5 h-5" />
              HDHomeRun
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settingsQuery.isLoading ? (
              <div className="animate-pulse bg-muted h-8 rounded"></div>
            ) : (
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${settingsQuery.data?.hdhrActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-2xl font-bold">
                  {settingsQuery.data?.hdhrActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Tuner emulation status
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Library className="w-5 h-5" />
              Media Servers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {serversQuery.isLoading ? (
              <div className="animate-pulse bg-muted h-8 rounded"></div>
            ) : (
              <div className="text-2xl font-bold">
                {serversQuery.data?.filter(server => server.active && server.type === 'PLEX').length || 0}
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Connected Plex servers
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Channels Preview */}
      {channelsQuery.data && channelsQuery.data.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent Channels</CardTitle>
            <CardDescription>Your latest configured channels</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {channelsQuery.data.slice(0, 5).map((channel: Channel) => (
                <div key={channel.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{channel.number}</Badge>
                    <span className="font-medium">{channel.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/channels/${channel.id}`}>
                      Configure
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
