'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, ExternalLink, Copy, Eye, EyeOff } from 'lucide-react';
import { getServerUrl } from '@/utils/server-url';

interface ConnectionStatus {
  isConnected: boolean;
  watchTowerUrl?: string;
  lastSync?: string;
  userCount?: number;
  errors?: string[];
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  error?: string;
}

const WatchTowerConnectionSetup: React.FC = () => {
  const [apiToken, setApiToken] = useState('');
  const [watchTowerUrl, setWatchTowerUrl] = useState('http://localhost:8000');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ isConnected: false });
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);
  const [showToken, setShowToken] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);

  useEffect(() => {
    loadConnectionStatus();
    initializeSetupSteps();
  }, []);

  const initializeSetupSteps = () => {
    setSetupSteps([
      {
        id: 'enter-token',
        title: 'Enter WatchTower API Token',
        description: 'Get this from your WatchTower admin panel under Integration Management',
        completed: false
      },
      {
        id: 'test-connection',
        title: 'Test Connection',
        description: 'Verify that TwentyFourSeven can communicate with WatchTower',
        completed: false
      },
      {
        id: 'register-webhook',
        title: 'Register Webhooks',
        description: 'Set up real-time sync for user changes',
        completed: false
      },
      {
        id: 'sync-users',
        title: 'Initial User Sync',
        description: 'Import existing users from WatchTower',
        completed: false
      }
    ]);
  };

  const loadConnectionStatus = async () => {
    try {
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/admin/watchtower/status`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      if (response.ok) {
        const status = await response.json();
        setConnectionStatus(status);
        updateSetupStepsFromStatus(status);
      }
    } catch (error) {
      console.error('Failed to load connection status:', error);
    }
  };

  const updateSetupStepsFromStatus = (status: ConnectionStatus) => {
    setSetupSteps(prev => prev.map(step => {
      switch (step.id) {
        case 'enter-token':
          return { ...step, completed: !!status.watchTowerUrl };
        case 'test-connection':
          return { ...step, completed: status.isConnected };
        case 'register-webhook':
          return { ...step, completed: status.isConnected };
        case 'sync-users':
          return { ...step, completed: status.isConnected && (status.userCount || 0) > 0 };
        default:
          return step;
      }
    }));
  };

  const validateToken = (token: string): boolean => {
    return token.length >= 32 && /^[a-f0-9]+$/i.test(token);
  };

  const testConnection = async (): Promise<boolean> => {
    try {
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/admin/watchtower/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          watchTowerUrl, 
          apiToken 
        })
      });

      const results = await response.json();
      setTestResults(results);
      
      return response.ok && results.success;
    } catch (error) {
      setTestResults({ success: false, error: 'Connection failed' });
      return false;
    }
  };

  const registerWebhooks = async (): Promise<boolean> => {
    try {
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/admin/watchtower/register-webhooks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          watchTowerUrl, 
          apiToken 
        })
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to register webhooks:', error);
      return false;
    }
  };

  const syncUsers = async (): Promise<boolean> => {
    try {
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/admin/watchtower/sync-users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          watchTowerUrl, 
          apiToken 
        })
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to sync users:', error);
      return false;
    }
  };

  const handleConnect = async () => {
    if (!validateToken(apiToken)) {
      alert('Invalid API token format. Token should be 32+ hexadecimal characters.');
      return;
    }

    setIsConnecting(true);
    let currentStepIndex = 0;

    try {
      // Step 1: Mark token entered
      setSetupSteps(prev => prev.map((step, index) => 
        index === 0 ? { ...step, completed: true } : step
      ));
      currentStepIndex++;

      // Step 2: Test connection
      const connectionSuccess = await testConnection();
      setSetupSteps(prev => prev.map((step, index) => 
        index === 1 ? { 
          ...step, 
          completed: connectionSuccess,
          error: connectionSuccess ? undefined : 'Connection failed'
        } : step
      ));

      if (!connectionSuccess) {
        throw new Error('Connection test failed');
      }
      currentStepIndex++;

      // Step 3: Register webhooks
      const webhookSuccess = await registerWebhooks();
      setSetupSteps(prev => prev.map((step, index) => 
        index === 2 ? { 
          ...step, 
          completed: webhookSuccess,
          error: webhookSuccess ? undefined : 'Webhook registration failed'
        } : step
      ));

      if (!webhookSuccess) {
        throw new Error('Webhook registration failed');
      }
      currentStepIndex++;

      // Step 4: Sync users
      const syncSuccess = await syncUsers();
      setSetupSteps(prev => prev.map((step, index) => 
        index === 3 ? { 
          ...step, 
          completed: syncSuccess,
          error: syncSuccess ? undefined : 'User sync failed'
        } : step
      ));

      if (syncSuccess) {
        // Save configuration
        const serverUrl = getServerUrl();
        await fetch(`${serverUrl}/api/admin/watchtower/save-config`, {
          method: 'POST',
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            watchTowerUrl, 
            apiToken 
          })
        });

        // Reload status
        await loadConnectionStatus();
      }

    } catch (error) {
      console.error('Setup failed:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(apiToken);
  };

  const disconnectWatchTower = async () => {
    if (!confirm('Are you sure you want to disconnect from WatchTower? This will disable SSO and real-time sync.')) {
      return;
    }

    try {
      const serverUrl = getServerUrl();
      await fetch(`${serverUrl}/api/admin/watchtower/disconnect`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      setConnectionStatus({ isConnected: false });
      setApiToken('');
      setTestResults(null);
      initializeSetupSteps();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                WatchTower Integration
                {connectionStatus.isConnected ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Not Connected
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Connect TwentyFourSeven to your WatchTower instance for user management and SSO
              </CardDescription>
            </div>
            {connectionStatus.isConnected && (
              <Button
                variant="outline"
                onClick={disconnectWatchTower}
                className="text-red-600 hover:text-red-700"
              >
                Disconnect
              </Button>
            )}
          </div>
        </CardHeader>
        
        {connectionStatus.isConnected && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {connectionStatus.userCount || 0}
                </div>
                <div className="text-sm text-gray-600">Synced Users</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {connectionStatus.lastSync ? '✓' : '—'}
                </div>
                <div className="text-sm text-gray-600">Last Sync</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">SSO</div>
                <div className="text-sm text-gray-600">Enabled</div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Setup Form */}
      {!connectionStatus.isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Setup Connection</CardTitle>
            <CardDescription>
              Follow these steps to connect TwentyFourSeven to your WatchTower instance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* WatchTower URL */}
            <div className="space-y-2">
              <Label htmlFor="watchtower-url">WatchTower URL</Label>
              <Input
                id="watchtower-url"
                value={watchTowerUrl}
                onChange={(e) => setWatchTowerUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
            </div>

            {/* API Token */}
            <div className="space-y-2">
              <Label htmlFor="api-token">API Token</Label>
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <Input
                    id="api-token"
                    type={showToken ? 'text' : 'password'}
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    placeholder="Enter your WatchTower API token..."
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {apiToken && (
                  <Button type="button" variant="outline" size="sm" onClick={copyToken}>
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-sm text-gray-600">
                Get this token from WatchTower Admin → Integration Management → Create App Tokens
              </p>
            </div>

            {/* Connection Button */}
            <Button
              onClick={handleConnect}
              disabled={!apiToken || !watchTowerUrl || isConnecting}
              className="w-full"
            >
              {isConnecting ? 'Connecting...' : 'Connect to WatchTower'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Setup Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Progress</CardTitle>
          <CardDescription>Track the connection setup process</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {setupSteps.map((step, index) => (
              <div key={step.id} className="flex items-start space-x-3">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  step.completed 
                    ? 'bg-green-500 text-white' 
                    : step.error
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {step.completed ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : step.error ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <span className="text-xs font-bold">{index + 1}</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{step.title}</div>
                  <div className="text-sm text-gray-600">{step.description}</div>
                  {step.error && (
                    <div className="text-sm text-red-600 mt-1">{step.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      {testResults && (
        <Card>
          <CardHeader>
            <CardTitle>Connection Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            {testResults.success ? (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Successfully connected to WatchTower! Found {testResults.userCount} users.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connection failed: {testResults.error}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help & Documentation */}
      <Card>
        <CardHeader>
          <CardTitle>Need Help?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Button variant="outline" className="w-full justify-start">
              <ExternalLink className="w-4 h-4 mr-2" />
              View Integration Documentation
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <ExternalLink className="w-4 h-4 mr-2" />
              WatchTower Admin Panel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WatchTowerConnectionSetup; 