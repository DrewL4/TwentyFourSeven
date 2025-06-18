"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, Users as UsersIcon, Loader2, AlertCircle, CheckCircle, LogIn } from "lucide-react";
import { toast } from "sonner";

interface User {
  _id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  watchTowerJoinDate?: string;
}

interface WatchTowerUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  tv_service: boolean;
  is_active: boolean;
  date_joined: string; // ISO date string from WatchTower
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [watchTowerUrl, setWatchTowerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isWatchTowerConfigured, setIsWatchTowerConfigured] = useState(false);

  useEffect(() => {
    fetchUsers();
    loadWatchTowerSettings();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch("http://localhost:3000/api/admin/users");
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      } else {
        toast.error("Failed to fetch users");
      }
    } catch (error) {
      toast.error("Error loading users");
    } finally {
      setLoading(false);
    }
  };

  const loadWatchTowerSettings = async () => {
    try {
      const response = await fetch("http://localhost:3000/api/admin/get-watchtower-settings");
      if (response.ok) {
        const data = await response.json();
        if (data.settings && data.settings.watchTowerEnabled) {
          setWatchTowerUrl(data.settings.watchTowerUrl || "");
          setUsername(data.settings.watchTowerUsername || "");
          setIsWatchTowerConfigured(true);
        }
      }
    } catch (error) {
      // Settings don't exist yet, that's fine
    }
  };

  const importFromWatchTower = async () => {
    if (!watchTowerUrl || !username || !password) {
      toast.error("Please provide WatchTower URL, username, and password");
      return;
    }

    setImporting(true);
    try {
      const watchTowerApiUrl = watchTowerUrl.replace(/\/$/, "");
      
      // Step 1: Login to WatchTower
      const loginResponse = await fetch(`${watchTowerApiUrl}/api/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        credentials: "include", // Include cookies for session
        body: JSON.stringify({
          username_or_email: username,
          password,
        }),
      });

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        let errorMessage = "Failed to login to WatchTower. Check your credentials.";
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage = `Login failed: ${errorData.error}`;
          }
        } catch (e) {
          // If response isn't JSON, use the status text
          errorMessage = `Login failed: ${loginResponse.status} ${loginResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Step 2: Get JWT tokens from login
      const loginData = await loginResponse.json();
      const accessToken = loginData.access_token;
      
      if (!accessToken) {
        throw new Error("No access token received from WatchTower login");
      }
      
      // Step 3: Fetch users with JWT authentication
      const usersResponse = await fetch(`${watchTowerApiUrl}/api/admin/export-users/`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        credentials: "include", // Include session cookies as backup
      });

      if (!usersResponse.ok) {
        const errorText = await usersResponse.text();
        let errorMessage = "Failed to fetch users from WatchTower. Make sure you have admin access.";
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage = `Export failed: ${errorData.error}`;
          }
        } catch (e) {
          errorMessage = `Export failed: ${usersResponse.status} ${usersResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await usersResponse.json();
      const tvUsers = data.users?.filter((user: WatchTowerUser) => 
        user.tv_service && user.is_active
      ) || [];

      if (tvUsers.length === 0) {
        toast.info("No active TV users found in WatchTower");
        return;
      }

      // Step 4: Import users to our system
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      for (const wtUser of tvUsers) {
        try {
          const userData = {
            name: `${wtUser.first_name} ${wtUser.last_name}`.trim() || wtUser.username,
            email: wtUser.email,
            emailVerified: false, // They'll need to verify
            source: 'watchtower_import',
            originalJoinDate: wtUser.date_joined // Pass the WatchTower join date
          };

          const importResponse = await fetch("http://localhost:3000/api/admin/import-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
          });

          if (importResponse.ok) {
            const result = await importResponse.json();
            if (result.action === "created") {
              created++;
            } else if (result.action === "updated") {
              updated++;
            }
          } else {
            const errorData = await importResponse.json();
            skipped++;
            if (errorData.error) {
              errors.push(`${wtUser.email}: ${errorData.error}`);
            }
          }
        } catch (error) {
          skipped++;
          errors.push(`${wtUser.email}: Import failed`);
        }
      }

      // Show detailed results
      const total = created + updated;
      if (total > 0) {
        let message = `Import completed! `;
        if (created > 0) message += `${created} new users created`;
        if (updated > 0) {
          if (created > 0) message += `, `;
          message += `${updated} existing users updated`;
        }
        if (skipped > 0) message += `, ${skipped} skipped`;
        toast.success(message);
      } else {
        toast.warning(`No users processed. ${skipped} users were skipped`);
      }

      if (errors.length > 0 && errors.length <= 3) {
        // Show first few errors
        errors.forEach(error => toast.error(error));
      }

      // Save WatchTower settings for future use
      try {
        const settingsData = {
          watchTowerEnabled: true,
          watchTowerUrl: watchTowerApiUrl,
          watchTowerUsername: username,
          watchTowerPassword: password, // This will be hashed and cached on the server
          watchTowerAutoSync: true,
          watchTowerSyncInterval: 24,
          watchTowerLastSync: new Date().toISOString()
        };

        await fetch("http://localhost:3000/api/admin/save-watchtower-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsData),
        });

        setIsWatchTowerConfigured(true);
      } catch (error) {
        console.error("Failed to save WatchTower settings:", error);
      }

      fetchUsers(); // Refresh the users list
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import from WatchTower");
    } finally {
      setImporting(false);
    }
  };

  const syncWatchTowerUsers = async () => {
    setSyncing(true);
    try {
      // If password is provided, update the stored settings first
      if (password) {
        const settingsData = {
          watchTowerEnabled: true,
          watchTowerUrl: watchTowerUrl,
          watchTowerUsername: username,
          watchTowerPassword: password,
          watchTowerAutoSync: true,
          watchTowerSyncInterval: 24,
          watchTowerLastSync: new Date().toISOString()
        };

        await fetch("http://localhost:3000/api/admin/save-watchtower-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsData),
        });
      }

      const response = await fetch("http://localhost:3000/api/admin/sync-watchtower-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        const { created, updated, skipped, total } = data.results;
        
        let message = `Sync completed! `;
        if (created > 0) message += `${created} new users created`;
        if (updated > 0) {
          if (created > 0) message += `, `;
          message += `${updated} existing users updated`;
        }
        if (skipped > 0) message += `, ${skipped} skipped`;
        message += ` (${total} total users processed)`;
        
        toast.success(message);
        await fetchUsers();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to sync users");
      }
    } catch (error) {
      toast.error("Error syncing users from WatchTower");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center space-x-2">
        <UsersIcon className="h-8 w-8" />
        <div>
          <h1 className="text-3xl font-bold">Users Management</h1>
          <p className="text-muted-foreground">Manage users and import from WatchTower</p>
        </div>
      </div>

      {/* Import from WatchTower */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Download className="h-5 w-5" />
            <span>{isWatchTowerConfigured ? "WatchTower Integration" : "Import from WatchTower"}</span>
          </CardTitle>
          <CardDescription>
            {isWatchTowerConfigured 
              ? "WatchTower is configured. You can sync users or update settings."
              : "Sign in to your WatchTower account to import TV users"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="watchtower-url">WatchTower URL</Label>
            <Input
              id="watchtower-url"
              placeholder="https://your-watchtower.com"
              value={watchTowerUrl}
              onChange={(e) => setWatchTowerUrl(e.target.value)}
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="username">WatchTower Username</Label>
              <Input
                id="username"
                placeholder="Your WatchTower username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <Label htmlFor="password">WatchTower Password{isWatchTowerConfigured ? " (leave blank to use saved)" : ""}</Label>
              <Input
                id="password"
                type="password"
                placeholder={isWatchTowerConfigured ? "Leave blank to use saved password" : "Your WatchTower password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>
          
          <Button 
            onClick={isWatchTowerConfigured ? syncWatchTowerUsers : importFromWatchTower} 
            disabled={importing || syncing || !watchTowerUrl || !username || (!isWatchTowerConfigured && !password)}
            className="w-full md:w-auto"
          >
            {(importing || syncing) ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isWatchTowerConfigured ? "Syncing..." : "Importing..."}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                {isWatchTowerConfigured ? "Sync Users" : "Sign In & Import TV Users"}
              </>
            )}
          </Button>
          
          <div className="flex items-start space-x-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p>• Only active users with TV service will be imported</p>
              <p>• Imported users will need to set their passwords using "forgot password"</p>
              <p>• Existing users (same email) will be updated with fresh data</p>
              {isWatchTowerConfigured && <p>• WatchTower credentials are securely stored for automatic syncing</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Users List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Current Users ({users.length})</CardTitle>
            <CardDescription>All users in the TwentyFour/Seven system</CardDescription>
          </div>
          <Button 
            onClick={syncWatchTowerUsers} 
            disabled={syncing}
            variant="outline"
            size="sm"
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Sync from WatchTower
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No users found. Import some users from WatchTower to get started.
            </p>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <div key={user._id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{user.name}</div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.watchTowerJoinDate ? (
                        <>
                          WatchTower: {new Date(user.watchTowerJoinDate).toLocaleDateString()}
                          <br />
                          TwentyFour/Seven: {new Date(user.createdAt).toLocaleDateString()}
                        </>
                      ) : (
                        <>Joined: {new Date(user.createdAt).toLocaleDateString()}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {user.emailVerified ? (
                      <Badge variant="default" className="flex items-center space-x-1">
                        <CheckCircle className="h-3 w-3" />
                        <span>Verified</span>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="flex items-center space-x-1">
                        <AlertCircle className="h-3 w-3" />
                        <span>Unverified</span>
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 