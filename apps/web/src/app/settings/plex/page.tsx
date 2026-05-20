"use client"
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { 
  Server, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Settings,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  Edit3,
  Save,
  X
} from "lucide-react";
import { toast } from "sonner";

interface PlexServer {
  id: string;
  name: string;
  url: string;
  token?: string | null;
  type: string;
  active: boolean;
  libraries?: any[];
}

interface PlexLoginForm {
  username: string;
  password: string;
}

interface PlexServerForm {
  name: string;
  uri: string;
  accessToken: string;
}

interface PlexLibrary {
  key: string;
  title: string;
  type: string;
  agent: string;
  scanner: string;
  language: string;
  uuid: string;
  updatedAt: number;
  createdAt: number;
}

type LibrarySelectionServer = {
  id?: string;
  name: string;
  uri: string;
  accessToken: string;
};

type GetLibrariesVariables = {
  url: string;
  token: string;
  mode: "create" | "edit";
  requestId: string;
  preselectedKeys?: string[];
};

const SUPPORTED_PLEX_LIBRARY_TYPES = new Set(["movie", "show"]);

function normalizeSelectableLibraries(libraries: PlexLibrary[]): PlexLibrary[] {
  return libraries
    .filter((lib) => SUPPORTED_PLEX_LIBRARY_TYPES.has(lib.type))
    .map((lib) => ({ ...lib, key: String(lib.key) }));
}

export default function PlexSettingsPage() {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [loginForm, setLoginForm] = useState<PlexLoginForm>({ username: '', password: '' });
  const [serverForm, setServerForm] = useState<PlexServerForm>({ name: '', uri: '', accessToken: '' });
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<any[]>([]);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlexServerForm>({ name: '', uri: '', accessToken: '' });
  const [showLibrarySelection, setShowLibrarySelection] = useState(false);
  const [availableLibraries, setAvailableLibraries] = useState<PlexLibrary[]>([]);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
  const [librarySelectionServer, setLibrarySelectionServer] =
    useState<LibrarySelectionServer | null>(null);
  const libraryFetchRequestIdRef = useRef<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');

  // Set webhook URL on client side
  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/plex/webhook`);
  }, []);

  // Queries
  const serversQuery = useQuery(orpc.servers.list.queryOptions());
  const plexSettingsQuery = useQuery(orpc.settings.plex.get.queryOptions());
  const webhookStatsQuery = useQuery(orpc.settings.webhooks.getStats.queryOptions());
  const webhookActivityQuery = useQuery(orpc.settings.webhooks.getActivity.queryOptions({ input: { limit: 10 } }));

  // Mutations
  const plexLoginMutation = useMutation({
    mutationFn: async (variables: { username: string; password: string }) => {
      const { client } = await import("@/utils/orpc");
      return await client.servers.plexLogin(variables);
    },
    onSuccess: (data) => {
      setDiscoveredServers(data.servers);
      toast.success(`Found ${data.servers.length} Plex servers`);
    },
    onError: (error) => {
      toast.error(`Login failed: ${error.message}`);
    }
  });

  const addServerMutation = useMutation(orpc.servers.addPlexServer.mutationOptions({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['servers', 'list'] });
      const previousServers = queryClient.getQueryData(['servers', 'list']);
      
      // Optimistically add the new server
      const optimisticServer = {
        id: `temp-${Date.now()}`,
        ...variables,
        type: 'PLEX',
        active: true,
        libraries: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      queryClient.setQueryData(['servers', 'list'], (old: any) => 
        old ? [...old, optimisticServer] : [optimisticServer]
      );
      
      return { previousServers };
    },
    onError: (error, variables, context) => {
      if (context?.previousServers) {
        queryClient.setQueryData(['servers', 'list'], context.previousServers);
      }
      toast.error(`Failed to add server: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      setServerForm({ name: '', uri: '', accessToken: '' });
      toast.success('Plex server added and libraries synced successfully');
    }
  }));

  const updateServerMutation = useMutation(orpc.servers.update.mutationOptions({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['servers', 'list'] });
      const previousServers = queryClient.getQueryData(['servers', 'list']);
      
      // Optimistically update the server
      queryClient.setQueryData(['servers', 'list'], (old: any) => 
        old ? old.map((server: any) => 
          server.id === variables.id 
            ? { ...server, ...variables }
            : server
        ) : []
      );
      
      return { previousServers };
    },
    onError: (error: any, variables, context) => {
      if (context?.previousServers) {
        queryClient.setQueryData(['servers', 'list'], context.previousServers);
      }
      toast.error(`Failed to update server: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      setEditingServer(null);
      setEditForm({ name: '', uri: '', accessToken: '' });
      toast.success('Plex server updated successfully');
    }
  }));

  const testConnectionMutation = useMutation(orpc.servers.testConnection.mutationOptions({
    onSuccess: (data) => {
      toast.success(data.valid ? 'Connection successful' : 'Connection failed');
    }
  }));

  const syncLibrariesMutation = useMutation({
    mutationFn: async (variables: { serverId: string }) => {
      const { client } = await import("@/utils/orpc");
      return await client.servers.syncLibrariesFast(variables);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      toast.success(data.message || 'Library sync started');
    },
    onError: (error) => {
      toast.error(`Sync failed: ${error.message}`);
    }
  });

  const updatePlexSettingsMutation = useMutation(orpc.settings.plex.update.mutationOptions({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['settings', 'plex', 'get'] });
      const previousSettings = queryClient.getQueryData(['settings', 'plex', 'get']);
      
      // Optimistically update Plex settings
      queryClient.setQueryData(['settings', 'plex', 'get'], (old: any) => ({
        ...old,
        ...variables
      }));
      
      return { previousSettings };
    },
    onError: (error, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'plex', 'get'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'plex', 'get'] });
      toast.success('Plex settings updated');
    }
  }));

  const deleteServerMutation = useMutation(orpc.servers.delete.mutationOptions({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['servers', 'list'] });
      const previousServers = queryClient.getQueryData(['servers', 'list']);
      
      // Optimistically remove the server
      queryClient.setQueryData(['servers', 'list'], (old: any) => 
        old ? old.filter((server: any) => server.id !== variables.id) : []
      );
      
      return { previousServers };
    },
    onError: (error, variables, context) => {
      if (context?.previousServers) {
        queryClient.setQueryData(['servers', 'list'], context.previousServers);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      toast.success('Server removed');
    }
  }));

  const refreshAllServersMutation = useMutation({
    mutationFn: async () => {
      const { client } = await import("@/utils/orpc");
      const servers = serversQuery.data?.filter(s => s.type === 'PLEX') || [];
      const results = await Promise.allSettled(
        servers.map(server => client.servers.syncLibrariesFast({ serverId: server.id }))
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      toast.success('All Plex servers refreshed - content sync running in background');
    },
    onError: (error) => {
      toast.error(`Failed to refresh servers: ${error.message}`);
    }
  });

  const getLibrariesMutation = useMutation({
    mutationFn: async (variables: GetLibrariesVariables) => {
      const { client } = await import("@/utils/orpc");
      const libraries = await client.servers.getLibraries({
        url: variables.url,
        token: variables.token,
      });
      return {
        libraries: normalizeSelectableLibraries(libraries as PlexLibrary[]),
        mode: variables.mode,
        requestId: variables.requestId,
        preselectedKeys: variables.preselectedKeys?.map(String),
      };
    },
    onSuccess: (result) => {
      if (result.requestId !== libraryFetchRequestIdRef.current) {
        return;
      }

      setAvailableLibraries(result.libraries);

      if (result.mode === "edit") {
        const preselected = result.preselectedKeys ?? [];
        setSelectedLibraries(
          preselected.filter((key) =>
            result.libraries.some((lib) => lib.key === key),
          ),
        );
      } else {
        setSelectedLibraries(result.libraries.map((lib) => lib.key));
      }
    },
    onError: (error, variables) => {
      if (variables.requestId !== libraryFetchRequestIdRef.current) {
        return;
      }
      setShowLibrarySelection(false);
      setLibrarySelectionServer(null);
      toast.error(`Failed to get libraries: ${error.message}`);
    },
  });

  const addServerWithLibrariesMutation = useMutation({
    mutationFn: async (variables: { name: string; uri: string; accessToken: string; selectedLibraries: string[] }) => {
      const { client } = await import("@/utils/orpc");
      const server = await client.servers.addPlexServer({
        name: variables.name,
        uri: variables.uri,
        accessToken: variables.accessToken,
        skipInitialLibrarySync: true,
      });
      const selection = await client.servers.updateLibrarySelection({
        serverId: server.id,
        selectedLibraryKeys: variables.selectedLibraries.map(String),
      });
      if (!selection.success) {
        throw new Error(selection.message || "Failed to save library selection");
      }
      return { server, selection };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", "list"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      libraryFetchRequestIdRef.current = null;
      setShowLibrarySelection(false);
      setLibrarySelectionServer(null);
      setSelectedLibraries([]);
      setAvailableLibraries([]);
      setServerForm({ name: "", uri: "", accessToken: "" });
      toast.success("Plex server added with selected libraries");
    },
    onError: (error) => {
      toast.error(`Failed to add server: ${error.message}`);
    },
  });

  const updateLibrarySelectionMutation = useMutation({
    mutationFn: async (variables: { serverId: string; selectedLibraryKeys: string[] }) => {
      const { client } = await import("@/utils/orpc");
      const result = await client.servers.updateLibrarySelection({
        serverId: variables.serverId,
        selectedLibraryKeys: variables.selectedLibraryKeys.map(String),
      });
      if (!result.success) {
        throw new Error(result.message || "Failed to update library selection");
      }
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["servers", "list"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      libraryFetchRequestIdRef.current = null;
      setShowLibrarySelection(false);
      setLibrarySelectionServer(null);
      setSelectedLibraries([]);
      setAvailableLibraries([]);
      toast.success(data.message || "Library selection updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update library selection: ${error.message}`);
    },
  });

  const isLibrarySelectionBusy =
    getLibrariesMutation.isPending ||
    addServerWithLibrariesMutation.isPending ||
    updateLibrarySelectionMutation.isPending;

  const openLibrarySelection = useCallback(
    (params: {
      server: LibrarySelectionServer;
      mode: "create" | "edit";
      preselectedKeys?: string[];
    }) => {
      const requestId = crypto.randomUUID();
      libraryFetchRequestIdRef.current = requestId;

      setLibrarySelectionServer(params.server);
      setShowLibrarySelection(true);
      setAvailableLibraries([]);

      if (params.mode === "edit" && params.preselectedKeys) {
        setSelectedLibraries(params.preselectedKeys.map(String));
      } else {
        setSelectedLibraries([]);
      }

      getLibrariesMutation.mutate({
        url: params.server.uri,
        token: params.server.accessToken,
        mode: params.mode,
        requestId,
        preselectedKeys: params.preselectedKeys?.map(String),
      });
    },
    [getLibrariesMutation],
  );

  const handlePlexLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.username || !loginForm.password) {
      toast.error('Please enter username and password');
      return;
    }
    plexLoginMutation.mutate(loginForm);
  };

  const handleAddServer = async (server: any) => {
    const uriCandidate = server.bestConnection?.uri || server.allConnections?.[0]?.uri;
    if (!uriCandidate) {
      toast.error('No connection available for this server');
      return;
    }

    openLibrarySelection({
      server: {
        name: server.name,
        uri: uriCandidate,
        accessToken: server.accessToken,
      },
      mode: "create",
    });
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverForm.name || !serverForm.uri || !serverForm.accessToken) {
      toast.error('Please fill in all fields');
      return;
    }
    
    // First test connection and get libraries
    const connectionValid = await testConnectionMutation.mutateAsync({
      url: serverForm.uri,
      token: serverForm.accessToken
    });
    
    if (!connectionValid.valid) {
      toast.error('Unable to connect to server. Please check your URL and token.');
      return;
    }
    
    openLibrarySelection({
      server: {
        name: serverForm.name,
        uri: serverForm.uri,
        accessToken: serverForm.accessToken,
      },
      mode: "create",
    });
  };

  const handleEditServer = (server: PlexServer) => {
    setEditingServer(server.id);
    setEditForm({
      name: server.name,
      uri: server.url,
      accessToken: server.token || ''
    });
  };

  const handleEditServerLibraries = (server: PlexServer) => {
    if (!server.token) {
      toast.error('No access token available');
      return;
    }
    
    const preselectedKeys = (server.libraries ?? []).map((lib) => String(lib.key));

    openLibrarySelection({
      server: {
        id: server.id,
        name: server.name,
        uri: server.url,
        accessToken: server.token,
      },
      mode: "edit",
      preselectedKeys,
    });
  };

  const handleUpdateServer = async (serverId: string) => {
    if (!editForm.name || !editForm.uri || !editForm.accessToken) {
      toast.error('Please fill in all fields');
      return;
    }
    updateServerMutation.mutate({
      id: serverId,
      name: editForm.name,
      url: editForm.uri,
      token: editForm.accessToken
    });
  };

  const handleCancelEdit = () => {
    setEditingServer(null);
    setEditForm({ name: '', uri: '', accessToken: '' });
  };

  const handleTestConnection = (server: PlexServer) => {
    if (!server.token) {
      toast.error('No access token available');
      return;
    }
    testConnectionMutation.mutate({
      url: server.url,
      token: server.token
    });
  };

  const handleSyncLibraries = (serverId: string) => {
    syncLibrariesMutation.mutate({ serverId });
  };

  const handleRefreshAllServers = () => {
    refreshAllServersMutation.mutate();
  };

  const handleLibraryToggle = (libraryKey: string) => {
    const key = String(libraryKey);
    setSelectedLibraries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleConfirmLibrarySelection = () => {
    if (!librarySelectionServer) return;
    
    if (librarySelectionServer.id) {
      // Editing existing server - update library selection
      updateLibrarySelectionMutation.mutate({
        serverId: librarySelectionServer.id,
        selectedLibraryKeys: selectedLibraries.map(String),
      });
    } else {
      // Adding new server
      addServerWithLibrariesMutation.mutate({
        name: librarySelectionServer.name,
        uri: librarySelectionServer.uri,
        accessToken: librarySelectionServer.accessToken,
        selectedLibraries: selectedLibraries.map(String),
      });
    }
  };

  const handleCancelLibrarySelection = () => {
    libraryFetchRequestIdRef.current = null;
    setShowLibrarySelection(false);
    setLibrarySelectionServer(null);
    setSelectedLibraries([]);
    setAvailableLibraries([]);
  };

  const getLibraryTypeIcon = (type: string) => {
    switch (type) {
      case 'movie': return '🎬';
      case 'show': return '📺';
      case 'artist': return '🎵';
      case 'photo': return '📷';
      default: return '📁';
    }
  };

  const getLibraryTypeLabel = (type: string) => {
    switch (type) {
      case 'movie': return 'Movies';
      case 'show': return 'TV Shows';
      case 'artist': return 'Music';
      case 'photo': return 'Photos';
      default: return 'Other';
    }
  };

  const plexServers = serversQuery.data?.filter(s => s.type === 'PLEX') || [];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-600 rounded-lg flex items-center justify-center">
          <Server className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Plex Settings</h1>
          <p className="text-muted-foreground">Manage your Plex server connections and settings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plex Login & Discovery */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Add Plex Server
            </CardTitle>
            <CardDescription>
              Sign in to your Plex account to discover servers or add manually
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Plex Login Form */}
            <form onSubmit={handlePlexLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Plex Username/Email</Label>
                <Input
                  id="username"
                  type="email"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="your@email.com"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full"
                disabled={plexLoginMutation.isPending}
              >
                {plexLoginMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Discovering Servers...
                  </>
                ) : (
                  'Discover Plex Servers'
                )}
              </Button>
            </form>

            {/* Discovered Servers */}
            {discoveredServers.length > 0 && (
              <div className="space-y-3">
                <Separator />
                <h4 className="font-medium">Discovered Servers</h4>
                {discoveredServers.map((server, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{server.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {server.bestConnection?.uri || server.allConnections?.[0]?.uri || 'No connection available'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {server.bestConnection ? (
                          <Badge variant="outline" className="text-green-600">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600">
                            <XCircle className="w-3 h-3 mr-1" />
                            No Connection
                          </Badge>
                        )}
                        {server.bestConnection?.local && (
                          <Badge variant="secondary">Local</Badge>
                        )}
                      </div>
                    </div>
                    <Button
                          onClick={() => handleAddServer(server)}
                          disabled={!(server.bestConnection || (server.allConnections && server.allConnections.length > 0)) || addServerMutation.isPending}
                          size="sm"
                        >
                      {addServerMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Add Server'
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Manual Add Toggle */}
            <div className="space-y-3">
              <Separator />
              <Button
                variant="outline"
                onClick={() => setShowManualAdd(!showManualAdd)}
                className="w-full"
              >
                {showManualAdd ? 'Hide Manual Setup' : 'Add Server Manually'}
              </Button>

              {/* Manual Add Form */}
              {showManualAdd && (
                <form onSubmit={handleManualAdd} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="serverName">Server Name</Label>
                    <Input
                      id="serverName"
                      value={serverForm.name}
                      onChange={(e) => setServerForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="My Plex Server"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="serverUri">Server URL</Label>
                    <Input
                      id="serverUri"
                      value={serverForm.uri}
                      onChange={(e) => setServerForm(prev => ({ ...prev, uri: e.target.value }))}
                      placeholder="http://192.168.1.100:32400"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="accessToken">Access Token</Label>
                    <Input
                      id="accessToken"
                      value={serverForm.accessToken}
                      onChange={(e) => setServerForm(prev => ({ ...prev, accessToken: e.target.value }))}
                      placeholder="xxxxxxxxxxxxxxxxxxxx"
                    />
                    <p className="text-xs text-muted-foreground">
                      Find your token at: Settings → Account → Privacy & Online Services → Plex Web
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={addServerMutation.isPending}
                  >
                    {addServerMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Adding Server...
                      </>
                    ) : (
                      'Add Server'
                    )}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Plex Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Plex Configuration
            </CardTitle>
            <CardDescription>
              Configure Plex integration settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {plexSettingsQuery.data && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-refresh Libraries</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync Plex libraries on schedule
                    </p>
                  </div>
                  <Switch
                    checked={plexSettingsQuery.data.autoRefreshLibraries}
                    onCheckedChange={(checked: boolean) => 
                      updatePlexSettingsMutation.mutate({ autoRefreshLibraries: checked })
                    }
                  />
                </div>

                {plexSettingsQuery.data.autoRefreshLibraries && (
                  <div className="space-y-2">
                    <Label htmlFor="refreshInterval">Refresh Interval (hours)</Label>
                    <Input
                      id="refreshInterval"
                      type="number"
                      min="1"
                      max="168"
                      value={plexSettingsQuery.data.refreshInterval}
                      onChange={(e) => 
                        updatePlexSettingsMutation.mutate({ 
                          refreshInterval: parseInt(e.target.value) || 24 
                        })
                      }
                    />
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Webhooks</Label>
                    <p className="text-sm text-muted-foreground">
                      Allow real-time sync from Plex when content is added or updated
                    </p>
                  </div>
                  <Switch
                    checked={plexSettingsQuery.data.webhookEnabled}
                    onCheckedChange={(checked: boolean) => 
                      updatePlexSettingsMutation.mutate({ webhookEnabled: checked })
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Library Selection Modal */}
      {showLibrarySelection && (
        <Card className="mt-6 border-2 border-blue-200 bg-blue-50/50 dark:border-blue-800/60 dark:bg-blue-950/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              {librarySelectionServer?.id ? 'Manage Server Libraries' : 'Select Libraries to Sync'}
            </CardTitle>
            <CardDescription>
              {librarySelectionServer?.id 
                ? `Manage which libraries from "${librarySelectionServer?.name}" are synced with TwentyFourSeven.`
                : `Choose which libraries from "${librarySelectionServer?.name}" you want to sync with TwentyFourSeven. You can change this selection later.`}{" "}
              Only Movies and TV Show libraries can be synced.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {getLibrariesMutation.isPending ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span>Loading libraries from Plex...</span>
              </div>
            ) : availableLibraries.length === 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No Movies or TV Show libraries were found on this Plex server. Add those
                  library types in Plex, then try again.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedLibraries(availableLibraries.map(lib => lib.key))}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedLibraries([])}
                    >
                      Select None
                    </Button>
                  </div>
                  <Badge variant="outline">
                    {selectedLibraries.length} of {availableLibraries.length} selected
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {availableLibraries.map((library) => (
                    <div
                      key={library.key}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        selectedLibraries.includes(library.key)
                          ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40'
                          : 'border-border bg-card hover:border-blue-300/60 dark:hover:border-blue-700/60'
                      }`}
                      onClick={() => handleLibraryToggle(library.key)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">
                            {getLibraryTypeIcon(library.type)}
                          </span>
                          <div>
                            <h4 className="font-medium text-foreground">{library.title}</h4>
                            <p className="text-sm text-muted-foreground">
                              {getLibraryTypeLabel(library.type)}
                            </p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 border-2 rounded flex items-center justify-center ${
                          selectedLibraries.includes(library.key)
                            ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-500'
                            : 'border-muted-foreground/40'
                        }`}>
                          {selectedLibraries.includes(library.key) && (
                            <CheckCircle className="w-3 h-3 text-white" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 pt-4">
                  <Button
                    onClick={handleConfirmLibrarySelection}
                    disabled={
                      selectedLibraries.length === 0 ||
                      isLibrarySelectionBusy ||
                      getLibrariesMutation.isPending ||
                      availableLibraries.length === 0
                    }
                    className="flex-1"
                  >
                    {(addServerWithLibrariesMutation.isPending ||
                      updateLibrarySelectionMutation.isPending) ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {librarySelectionServer?.id ? 'Updating Libraries...' : 'Adding Server...'}
                      </>
                    ) : (
                      librarySelectionServer?.id 
                        ? `Update Library Selection`
                        : `Add Server with ${selectedLibraries.length} Libraries`
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelLibrarySelection}
                    disabled={isLibrarySelectionBusy}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connected Servers */}
      {plexServers.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Connected Plex Servers</CardTitle>
              <CardDescription>
                Manage your connected Plex servers and sync libraries
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={handleRefreshAllServers}
              disabled={refreshAllServersMutation.isPending}
              className="shrink-0"
              title="Quick refresh all servers (Full sync runs in background)"
            >
              {refreshAllServersMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Quick Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Quick Refresh All
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {plexServers.map((server: any) => (
                <div key={server.id} className="p-4 border rounded-lg">
                  {editingServer === server.id ? (
                    // Edit Mode
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                          <Server className="w-5 h-5 text-orange-600" />
                        </div>
                        <h4 className="font-medium">Edit Server</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`edit-name-${server.id}`}>Server Name</Label>
                          <Input
                            id={`edit-name-${server.id}`}
                            value={editForm.name}
                            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="My Plex Server"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor={`edit-uri-${server.id}`}>Server URL</Label>
                          <Input
                            id={`edit-uri-${server.id}`}
                            value={editForm.uri}
                            onChange={(e) => setEditForm(prev => ({ ...prev, uri: e.target.value }))}
                            placeholder="http://192.168.1.100:32400"
                          />
                        </div>
                        
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor={`edit-token-${server.id}`}>Access Token</Label>
                          <Input
                            id={`edit-token-${server.id}`}
                            value={editForm.accessToken}
                            onChange={(e) => setEditForm(prev => ({ ...prev, accessToken: e.target.value }))}
                            placeholder="xxxxxxxxxxxxxxxxxxxx"
                          />
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 pt-4">
                        <Button
                          onClick={() => handleUpdateServer(server.id)}
                          disabled={updateServerMutation.isPending}
                          size="sm"
                        >
                          {updateServerMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4 mr-2" />
                              Save Changes
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleCancelEdit}
                          size="sm"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Server className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <h4 className="font-medium">{server.name}</h4>
                            <p className="text-sm text-muted-foreground">{server.url}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={server.active ? "default" : "secondary"}>
                                {server.active ? "Active" : "Inactive"}
                              </Badge>
                              {server.libraries && (
                                <Badge variant="outline">
                                  {server.libraries.length} Libraries
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestConnection(server)}
                          disabled={testConnectionMutation.isPending}
                          title="Test Connection"
                        >
                          {testConnectionMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                        </Button>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSyncLibraries(server.id)}
                          disabled={syncLibrariesMutation.isPending}
                          title="Quick Sync (Full sync runs in background)"
                        >
                          {syncLibrariesMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </Button>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditServerLibraries(server)}
                          disabled={isLibrarySelectionBusy}
                          title="Manage Libraries"
                        >
                          {isLibrarySelectionBusy && showLibrarySelection ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Settings className="w-4 h-4" />
                          )}
                        </Button>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditServer(server)}
                          disabled={editingServer !== null}
                          title="Edit Server"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteServerMutation.mutate({ id: server.id })}
                          disabled={deleteServerMutation.isPending}
                          title="Remove Server"
                          className="text-red-600 hover:text-red-700"
                        >
                          {deleteServerMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help Information */}
      <Alert className="mt-6">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Getting Started:</strong> Sign in with your Plex account to automatically discover servers, 
          or add servers manually using their IP address and access token. Once connected, sync libraries 
          to import your media for use in TwentyFourSeven channels.
        </AlertDescription>
      </Alert>

      {/* Webhook Status Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Webhook Configuration
          </CardTitle>
          <CardDescription>
            Real-time sync of new content from Plex to TwentyFourSeven
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Webhook URL</p>
                <p className="text-sm text-muted-foreground">
                  Configure this URL in your Plex server settings
                </p>
              </div>
              <Badge variant="outline">Active</Badge>
            </div>
            
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success('Webhook URL copied to clipboard');
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {/* Webhook Status and Stats */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Webhook Status</p>
                <p className="text-sm text-muted-foreground">
                  {plexSettingsQuery.data?.webhookEnabled 
                    ? "Endpoint is ready to receive Plex events" 
                    : "Webhooks are disabled - enable in Plex Settings below"}
                </p>
              </div>
              <Badge 
                variant={plexSettingsQuery.data?.webhookEnabled ? "default" : "secondary"} 
                className={
                  plexSettingsQuery.data?.webhookEnabled
                    ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                    : "bg-muted text-muted-foreground"
                }
              >
                {plexSettingsQuery.data?.webhookEnabled ? (
                  <>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Enabled
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3 mr-1" />
                    Disabled
                  </>
                )}
              </Badge>
            </div>

            {/* Webhook Stats */}
            {webhookStatsQuery.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="text-sm font-medium text-muted-foreground">Total Events</p>
                  <p className="text-2xl font-bold text-primary">{webhookStatsQuery.data.total}</p>
                </div>
                <div className="rounded-lg border bg-green-50 p-3 dark:bg-green-950/30 dark:border-green-900/50">
                  <p className="text-sm font-medium text-green-900 dark:text-green-200">Processed</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{webhookStatsQuery.data.processed}</p>
                </div>
                <div className="rounded-lg border bg-red-50 p-3 dark:bg-red-950/30 dark:border-red-900/50">
                  <p className="text-sm font-medium text-red-900 dark:text-red-200">Failed</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{webhookStatsQuery.data.failed}</p>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3 dark:bg-blue-950/30 dark:border-blue-900/50">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Last 24h</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{webhookStatsQuery.data.last24Hours}</p>
                </div>
              </div>
            )}

            {/* Recent Library Changes */}
            {webhookActivityQuery.data && webhookActivityQuery.data.activities.length > 0 && (
              <div>
                <p className="font-medium mb-3">Recent Library Changes</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {webhookActivityQuery.data.activities
                    .filter((activity: any) => 
                      activity.eventType === 'library.new' || 
                      activity.eventType === 'library.removed' || 
                      activity.eventType === 'library.delete' ||
                      activity.eventType === 'library.update'
                    )
                    .map((activity: any) => {
                      const getEventIcon = (eventType: string) => {
                        switch (eventType) {
                          case 'library.new':
                            return '📥';
                          case 'library.update':
                            return '🔄';
                          case 'library.removed':
                          case 'library.delete':
                            return '🗑️';
                          default:
                            return '📝';
                        }
                      };
                      
                      const getEventLabel = (eventType: string) => {
                        switch (eventType) {
                          case 'library.new':
                            return 'Added';
                          case 'library.update':
                            return 'Updated';
                          case 'library.removed':
                          case 'library.delete':
                            return 'Removed';
                          default:
                            return eventType;
                        }
                      };

                      return (
                        <div key={activity.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{getEventIcon(activity.eventType)}</span>
                              <p className="text-sm font-medium">{activity.contentTitle}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {getEventLabel(activity.eventType)} • {activity.serverName} • {new Date(activity.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <Badge 
                            variant={activity.status === 'processed' ? 'default' : activity.status === 'failed' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {activity.status}
                          </Badge>
                        </div>
                      );
                    })}
                </div>
                {webhookActivityQuery.data.activities.filter((activity: any) => 
                  activity.eventType === 'library.new' || 
                  activity.eventType === 'library.removed' || 
                  activity.eventType === 'library.delete' ||
                  activity.eventType === 'library.update'
                ).length === 0 && (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">No library changes recorded yet</p>
                  </div>
                )}
              </div>
            )}

            {/* No Activity Message */}
            {webhookActivityQuery.data && webhookActivityQuery.data.activities.length === 0 && (
              <div className="text-center py-6">
                <p className="text-muted-foreground">No library changes yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add or remove content from your Plex server to see activity here
                </p>
              </div>
            )}
            
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Setup Instructions:</strong>
                <ol className="list-decimal ml-4 mt-2 space-y-1">
                  <li>Open your Plex server settings</li>
                  <li>Navigate to Settings → Network → Webhooks</li>
                  <li>Add the webhook URL above</li>
                  <li>Test by adding new content to your Plex server</li>
                </ol>
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 