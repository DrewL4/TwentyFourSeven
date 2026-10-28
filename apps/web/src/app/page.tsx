"use client"
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLogo } from "@/components/app-logo";
import { Library, Settings, Play, Radio, FileText, Tv, Film } from "lucide-react";
import { FRANCHISES_BLURB, FRANCHISES_LABEL, FRANCHISES_PATH } from "@/lib/nav-links";
import { getServerUrl } from "@/utils/server-url";
import { useAdmin } from "@/hooks/use-admin";
import PlaylistLoginCard from "@/components/settings/playlist-login-card";

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
  const channelsQuery = useQuery(orpc.channels.listSummary.queryOptions());
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());
  const { isAdmin, canManage, isLoading: roleLoading } = useAdmin();
  // Media servers (and their tokens) are admin-only.
  const serversQuery = useQuery({ ...orpc.servers.list.queryOptions(), enabled: isAdmin });
  const serverUrl = getServerUrl();
  const needsMediaServer = isAdmin && serversQuery.isSuccess && serversQuery.data.length === 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <AppLogo size="md" />
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">TwentyFour/Seven</h1>
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
              {/* Plain <a>: these are file downloads, not app pages. next/link
                  would try to prefetch them as pages and log 404s. */}
              <a href={`${serverUrl}/media.m3u`} download="twentyfourseven.m3u">
                <Radio className="w-4 h-4 mr-1" />
                M3U
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`${serverUrl}/media.xml`} download="twentyfourseven.xml">
                <FileText className="w-4 h-4 mr-1" />
                XMLTV
              </a>
            </Button>
          </div>
        </div>
      </div>

      {needsMediaServer && (
        <Card className="mb-8 border-amber-500/50 bg-amber-500/5" data-testid="next-step-plex">
          <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm">
              <span className="font-semibold">Next step:</span> tell TwentyFourSeven where your videos are
              (your movie and TV folders, or Plex). Channels and the guide stay empty until then.
            </p>
            <Button size="sm" asChild>
              <Link href="/settings">Choose your videos</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Navigation Cards */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${isAdmin ? "lg:grid-cols-3 xl:grid-cols-5" : canManage ? "lg:grid-cols-4" : ""} gap-6 mb-8`}>
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

        {canManage && (<>
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
          <Link href={FRANCHISES_PATH}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-accent-text" />
                <CardTitle className="text-lg">{FRANCHISES_LABEL}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                {FRANCHISES_BLURB}
              </CardDescription>
            </CardContent>
          </Link>
        </Card>

        {isAdmin && (
        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/settings">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-accent-text" />
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
        )}
        </>)}
      </div>

      {/* Status Overview */}
      <div className={`grid grid-cols-1 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"} gap-6`}>
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

        {isAdmin && (
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
                {serversQuery.data?.filter(server => server.active).length || 0}
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Video sources
            </p>
          </CardContent>
        </Card>
        )}
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
                  {canManage && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/channels/${channel.id}`}>
                        Configure
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Viewers can't open Settings, so their TV app login lives here. */}
      {!isAdmin && !roleLoading && (
        <div className="mt-6">
          <PlaylistLoginCard showHdhr={!!settingsQuery.data?.hdhrActive} />
        </div>
      )}
    </div>
  );
}