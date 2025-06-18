"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Eye, EyeOff, Users, Settings, CheckCircle, Download } from 'lucide-react';

interface FirstTimeSetupProps {
  onComplete: () => void;
}

export default function FirstTimeSetup({ onComplete }: FirstTimeSetupProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showLocalPassword, setShowLocalPassword] = useState(false);
  
  // Step 1: Setup Choice
  const [setupType, setSetupType] = useState<'watchtower' | 'local' | null>(null);
  
  // WatchTower Connection
  const [watchTowerUrl, setWatchTowerUrl] = useState('https://wtbeta.midweststreams.us');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // Local Admin Creation
  const [localAdminName, setLocalAdminName] = useState('');
  const [localAdminEmail, setLocalAdminEmail] = useState('');
  const [localAdminPassword, setLocalAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Step 2: Import Options (WatchTower) or Step 3: Password Setup
  const [importUsers, setImportUsers] = useState(true);
  const [createAdminAccount, setCreateAdminAccount] = useState(true);
  const [setupPasswords, setSetupPasswords] = useState(false);
  
  // Password Setup for imported users
  const [importedUsers, setImportedUsers] = useState<Array<{
    id: string;
    name: string;
    email: string;
    password?: string;
  }>>([]);
  
  // Step 4: Results
  const [importResults, setImportResults] = useState<{
    created: number;
    updated: number;
    skipped: number;
    adminCreated: boolean;
    passwordsSet?: number;
  } | null>(null);

  const handleLocalAdminCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (localAdminPassword !== confirmPassword) {
        throw new Error("Passwords do not match");
      }

      // Create local admin account
      const adminData = {
        name: localAdminName,
        email: localAdminEmail,
        password: localAdminPassword,
        source: 'local_admin_setup'
      };

      const adminResponse = await fetch("http://localhost:3000/api/admin/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminData),
      });

      if (!adminResponse.ok) {
        throw new Error("Failed to create admin account");
      }

      setImportResults({
        created: 1,
        updated: 0,
        skipped: 0,
        adminCreated: true
      });

      toast.success("Admin account created successfully!");
      setStep(setupType === 'local' ? 3 : 4); // Local goes directly to complete
      
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create admin account");
    } finally {
      setLoading(false);
    }
  };

  const handleWatchTowerConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Test connection to WatchTower
      const loginResponse = await fetch(`${watchTowerUrl}/api/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username_or_email: username,
          password,
        }),
      });

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        let errorMessage = "Failed to connect to WatchTower. Check your credentials.";
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage = `Connection failed: ${errorData.error}`;
          }
        } catch (e) {
          errorMessage = `Connection failed: ${loginResponse.status} ${loginResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Test admin access
      const loginData = await loginResponse.json();
      const accessToken = loginData.access_token;
      
      if (!accessToken) {
        throw new Error("No access token received from WatchTower");
      }

      const adminTestResponse = await fetch(`${watchTowerUrl}/api/admin/export-users/`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        credentials: "include",
      });

      if (!adminTestResponse.ok) {
        throw new Error("You don't have admin access in WatchTower. Only WatchTower admins can set up TwentyFour/Seven.");
      }

      setIsConnected(true);
      toast.success("Successfully connected to WatchTower with admin access!");
      setStep(3);
      
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    
    try {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let adminCreated = false;
      let tvUsers: any[] = [];

      if (importUsers) {
        // Step 1: Login to WatchTower again
        const loginResponse = await fetch(`${watchTowerUrl}/api/login/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            username_or_email: username,
            password,
          }),
        });

        const loginData = await loginResponse.json();
        const accessToken = loginData.access_token;

        // Step 2: Fetch users from WatchTower
        const usersResponse = await fetch(`${watchTowerUrl}/api/admin/export-users/`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          credentials: "include",
        });

        const usersData = await usersResponse.json();
        tvUsers = usersData.users || [];

        // Store for password setup if needed
        if (setupPasswords) {
          setImportedUsers(tvUsers.map((user: any) => ({
            id: user.id,
            name: `${user.first_name} ${user.last_name}`.trim() || user.username,
            email: user.email
          })));
        }

        // Step 3: Import users
        for (const wtUser of tvUsers) {
          try {
            const userData = {
              name: `${wtUser.first_name} ${wtUser.last_name}`.trim() || wtUser.username,
              email: wtUser.email,
              emailVerified: false,
              source: 'watchtower_import'
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
              skipped++;
            }
          } catch (error) {
            skipped++;
          }
        }
      }

      if (createAdminAccount) {
        // Create admin account using WatchTower credentials (same password!)
        // The person who successfully logged into WatchTower IS the admin
        // Find their user record from the imported users to get their real email
        const adminUser = tvUsers.find((user: any) => user.username === username || user.email === username);
        const adminEmail = adminUser ? adminUser.email : (username.includes('@') ? username : `${username}@example.com`);
        const adminName = adminUser ? `${adminUser.first_name} ${adminUser.last_name}`.trim() || adminUser.username : username;
        
        try {
          const adminData = {
            name: adminName,
            email: adminEmail,
            password: password, // Use the same password from WatchTower login!
            source: 'watchtower_admin_setup'
          };

          const adminResponse = await fetch("http://localhost:3000/api/admin/create-admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(adminData),
          });

          if (adminResponse.ok) {
            adminCreated = true;
          } else {
            const errorData = await adminResponse.json();
            console.error("Failed to create admin account:", errorData);
          }
        } catch (error) {
          console.error("Failed to create admin account:", error);
        }
      }

      // Save WatchTower configuration to settings
      if (setupType === 'watchtower' && isConnected) {
        try {
          const settingsData = {
            watchTowerEnabled: true,
            watchTowerUrl: watchTowerUrl,
            watchTowerUsername: username,
            watchTowerPassword: password, // TODO: Encrypt this
            watchTowerAutoSync: true,
            watchTowerSyncInterval: 24,
            watchTowerLastSync: new Date().toISOString()
          };

          const settingsResponse = await fetch("http://localhost:3000/api/admin/save-watchtower-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settingsData),
          });

          if (!settingsResponse.ok) {
            console.error("Failed to save WatchTower settings");
          }
        } catch (error) {
          console.error("Failed to save WatchTower settings:", error);
        }
      }

      

      setImportResults({
        created,
        updated,
        skipped,
        adminCreated
      });

      // Go to password setup if requested, otherwise complete
      if (setupPasswords && importUsers && created > 0) {
        setStep(4); // Password setup step
      } else {
        setStep(4); // Complete step
      }
      
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            TwentyFour/Seven Setup
          </CardTitle>
          <CardDescription>
            Connect to your WatchTower application to get started
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Progress Indicator */}
          <div className="flex items-center justify-center space-x-2">
            <div className={`flex items-center space-x-1 ${step >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                {step > 1 ? <CheckCircle className="w-3 h-3" /> : '1'}
              </div>
              <span className="text-xs font-medium">Choose</span>
            </div>
            <div className={`w-4 h-0.5 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
            <div className={`flex items-center space-x-1 ${step >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                {step > 2 ? <CheckCircle className="w-3 h-3" /> : '2'}
              </div>
              <span className="text-xs font-medium">{setupType === 'watchtower' ? 'Import' : 'Create'}</span>
            </div>
            <div className={`w-4 h-0.5 ${step >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`} />
            <div className={`flex items-center space-x-1 ${step >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                {step > 3 ? <CheckCircle className="w-3 h-3" /> : '3'}
              </div>
              <span className="text-xs font-medium">{setupType === 'watchtower' ? 'Passwords' : 'Complete'}</span>
            </div>
            {setupType === 'watchtower' && (
              <>
                <div className={`w-4 h-0.5 ${step >= 4 ? 'bg-blue-600' : 'bg-gray-200'}`} />
                <div className={`flex items-center space-x-1 ${step >= 4 ? 'text-blue-600' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 4 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                    {step >= 4 ? <CheckCircle className="w-3 h-3" /> : '4'}
                  </div>
                  <span className="text-xs font-medium">Complete</span>
                </div>
              </>
            )}
          </div>

          {/* Step 1: Setup Choice */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">Choose Setup Method</h3>
                <p className="text-sm text-gray-600">How would you like to set up TwentyFour/Seven?</p>
              </div>
              
              <div className="space-y-3">
                <div 
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                    setupType === 'watchtower' 
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSetupType('watchtower')}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-4 h-4 rounded-full border-2 ${
                      setupType === 'watchtower' 
                        ? 'border-blue-600 bg-blue-600' 
                        : 'border-gray-300'
                    }`}>
                      {setupType === 'watchtower' && (
                        <div className="w-full h-full rounded-full bg-white transform scale-50"></div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium flex items-center gap-2">
                        <Download className="w-4 h-4 text-blue-600" />
                        Import from WatchTower
                      </h4>
                      <p className="text-sm text-gray-600">
                        Connect to your existing WatchTower application and import all users
                      </p>
                    </div>
                  </div>
                </div>
                
                <div 
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                    setupType === 'local' 
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSetupType('local')}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-4 h-4 rounded-full border-2 ${
                      setupType === 'local' 
                        ? 'border-blue-600 bg-blue-600' 
                        : 'border-gray-300'
                    }`}>
                      {setupType === 'local' && (
                        <div className="w-full h-full rounded-full bg-white transform scale-50"></div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium flex items-center gap-2">
                        <Settings className="w-4 h-4 text-green-600" />
                        Create Local Admin
                      </h4>
                      <p className="text-sm text-gray-600">
                        Create a standalone admin account for TwentyFour/Seven
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={() => setStep(2)} 
                className="w-full" 
                disabled={!setupType}
              >
                Continue
              </Button>
            </div>
          )}

                    {/* Step 2: WatchTower Connection OR Local Admin Creation */}
          {step === 2 && setupType === 'watchtower' && (
            <form onSubmit={handleWatchTowerConnect} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="watchtower-url">WatchTower URL</Label>
                <Input
                  id="watchtower-url"
                  type="url"
                  value={watchTowerUrl}
                  onChange={(e) => setWatchTowerUrl(e.target.value)}
                  placeholder="https://your-watchtower.com"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="username">WatchTower Username/Email</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your WatchTower username or email"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">WatchTower Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your WatchTower password"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Connecting..." : "Connect to WatchTower"}
              </Button>
            </form>
          )}

          {step === 2 && setupType === 'local' && (
            <form onSubmit={handleLocalAdminCreate} className="space-y-4">
              <div className="text-center space-y-2 mb-4">
                <Settings className="w-8 h-8 text-green-600 mx-auto" />
                <h3 className="text-lg font-semibold">Create Admin Account</h3>
                <p className="text-sm text-gray-600">Set up your administrator account</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="local-name">Full Name</Label>
                <Input
                  id="local-name"
                  type="text"
                  value={localAdminName}
                  onChange={(e) => setLocalAdminName(e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="local-email">Email Address</Label>
                <Input
                  id="local-email"
                  type="email"
                  value={localAdminEmail}
                  onChange={(e) => setLocalAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="local-password">Password</Label>
                <div className="relative">
                  <Input
                    id="local-password"
                    type={showLocalPassword ? "text" : "password"}
                    value={localAdminPassword}
                    onChange={(e) => setLocalAdminPassword(e.target.value)}
                    placeholder="Create a strong password"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowLocalPassword(!showLocalPassword)}
                  >
                    {showLocalPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={loading || localAdminPassword !== confirmPassword}>
                {loading ? "Creating Account..." : "Create Admin Account"}
              </Button>
              
              {localAdminPassword !== confirmPassword && confirmPassword && (
                <p className="text-sm text-red-600">Passwords do not match</p>
              )}
            </form>
          )}

          {/* Step 3: WatchTower Import Options */}
          {step === 3 && setupType === 'watchtower' && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
                <h3 className="text-lg font-semibold">Connected Successfully!</h3>
                <p className="text-sm text-gray-600">Choose what you'd like to import:</p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="import-users"
                    checked={importUsers}
                    onCheckedChange={(checked) => setImportUsers(checked === true)}
                  />
                  <Label htmlFor="import-users" className="flex items-center space-x-2">
                    <Users className="w-4 h-4" />
                    <span>Import all WatchTower users</span>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="create-admin"
                    checked={createAdminAccount}
                    onCheckedChange={(checked) => setCreateAdminAccount(checked === true)}
                  />
                  <Label htmlFor="create-admin" className="flex items-center space-x-2">
                    <Settings className="w-4 h-4" />
                    <span>Create admin account for me</span>
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="setup-passwords"
                    checked={setupPasswords}
                    onCheckedChange={(checked) => setSetupPasswords(checked === true)}
                  />
                  <Label htmlFor="setup-passwords" className="flex items-center space-x-2">
                    <Eye className="w-4 h-4" />
                    <span>Set up passwords for imported users</span>
                  </Label>
                </div>
              </div>
              
              <Button 
                onClick={handleImport} 
                className="w-full" 
                disabled={loading || (!importUsers && !createAdminAccount)}
              >
                {loading ? "Importing..." : "Start Import"}
              </Button>
            </div>
          )}

          {/* Step 3: Local Admin Results OR Step 4: WatchTower Results */}
          {((step === 3 && setupType === 'local') || (step === 4 && setupType === 'watchtower')) && importResults && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
                <h3 className="text-lg font-semibold">Setup Complete!</h3>
              </div>
              
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
                <h4 className="font-medium">Import Summary:</h4>
                <ul className="text-sm space-y-1">
                  {importResults.created > 0 && (
                    <li>✅ {importResults.created} new users created</li>
                  )}
                  {importResults.updated > 0 && (
                    <li>🔄 {importResults.updated} existing users updated</li>
                  )}
                  {importResults.skipped > 0 && (
                    <li>⏭️ {importResults.skipped} users skipped</li>
                  )}
                  {importResults.adminCreated && (
                    <li>👑 Admin account created for you</li>
                  )}
                </ul>
              </div>
              
              <Button onClick={onComplete} className="w-full">
                Continue to TwentyFour/Seven
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 