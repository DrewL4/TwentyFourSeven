# TwentyFourSeven ↔ WatchTower Integration Guide

## 🎯 Overview

This guide shows exactly how TwentyFourSeven integrates with WatchTower as the central hub. WatchTower becomes the **single source of truth** for user management, while TwentyFourSeven provides the TV streaming service.

## 🏗️ Integration Architecture

```
┌─────────────────┐     API Calls      ┌─────────────────┐
│   WATCHTOWER    │ ◄──────────────────► │ TWENTYFOURSEVEN │
│  (Central Hub)  │                     │  (TV Service)   │
│                 │     Webhooks       │                 │
│ • Users         │ ────────────────── ► │ • Channels      │
│ • Services      │                     │ • Streaming     │
│ • Donations     │                     │ • EPG           │
│ • Auth          │                     │ • User Access   │
└─────────────────┘                     └─────────────────┘
```

## 🔧 Setup Steps

### Step 1: Environment Configuration

Add to your `.env` file in TwentyFourSeven:

```bash
# WatchTower Integration
WATCHTOWER_BASE_URL=http://localhost:8000
WATCHTOWER_API_TOKEN=your_token_from_watchtower_setup
WATCHTOWER_WEBHOOK_SECRET=your_webhook_secret_from_registration

# Webhook URL for WatchTower to call
WEBHOOK_BASE_URL=http://localhost:3000
```

### Step 2: Update Prisma Schema

Add WatchTower metadata to your existing schema:

```prisma
// Add to your existing User model in auth.prisma
model User {
  id                 String    @id @map("_id")
  name               String
  email              String
  emailVerified      Boolean
  image              String?
  createdAt          DateTime
  updatedAt          DateTime
  watchTowerJoinDate DateTime? // Original join date from WatchTower
  
  // WatchTower integration fields
  watchTowerUserId   Int?      // Link to WatchTower user ID
  watchTowerSynced   Boolean   @default(false)
  watchTowerMetadata Json?     // Store additional WatchTower data
  
  sessions           Session[]
  accounts           Account[]

  @@unique([email])
  @@map("user")
}

// New model for WatchTower sync metadata
model WatchTowerSync {
  id                String   @id @map("_id")
  lastSyncAt        DateTime
  syncType          String   // 'manual' | 'webhook' | 'scheduled'
  usersCreated      Int      @default(0)
  usersUpdated      Int      @default(0)
  usersSkipped      Int      @default(0)
  errors            Json?    // Store any sync errors
  createdAt         DateTime
  
  @@map("watchtower_sync")
}
```

### Step 3: Database Migration

```bash
cd my-app/apps/server
npx prisma generate
npx prisma db push
```

### Step 4: Get Your API Token

From WatchTower setup:

```bash
cd WatchTower/backend
python manage.py setup_cross_app_tokens
```

Copy the TwentyFourSeven token to your `.env` file.

### Step 5: Register Webhook

Run this once to register TwentyFourSeven's webhook with WatchTower:

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/register/ \
  -H "Authorization: Bearer YOUR_WATCHTOWER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "app_name": "twentyfourseven",
    "app_version": "1.0.0",
    "endpoint_url": "http://localhost:3000/api/webhooks/watchtower",
    "events": ["user.created", "user.updated", "service.updated", "donation.received"],
    "timeout_seconds": 30
  }'
```

Save the returned `secret_key` to your `.env` as `WATCHTOWER_WEBHOOK_SECRET`.

## 🚀 How It Works

### **Real-time User Sync (Webhooks)**

When something happens in WatchTower, TwentyFourSeven gets notified instantly:

1. **User Registration in WatchTower**
   ```
   WatchTower: New user "john@example.com" signs up for TV service
   ↓ Webhook sent to TwentyFourSeven
   TwentyFourSeven: Creates user account automatically
   ```

2. **Donation Received in WatchTower**
   ```
   WatchTower: User pays $50 for TV service
   ↓ Webhook sent to TwentyFourSeven
   TwentyFourSeven: Extends user's access, updates subscription status
   ```

3. **Service Configuration Change**
   ```
   WatchTower: Admin updates TV service playlist URL
   ↓ Webhook sent to TwentyFourSeven
   TwentyFourSeven: Refreshes channel list from new URL
   ```

### **Pull Data When Needed (REST API)**

TwentyFourSeven can fetch data from WatchTower on-demand:

```typescript
// Get all users with TV service
const watchTowerService = WatchTowerHubService.getInstance();
const users = await watchTowerService.fetchUsers();

// Get specific user details
const user = await watchTowerService.fetchUser(123);

// Get TV service configuration
const services = await watchTowerService.fetchServices();
const tvService = services.find(s => s.type === 'tv');
```

### **Manual Sync for Bulk Operations**

Admin can trigger manual sync in TwentyFourSeven:

```bash
# Sync all users from WatchTower
curl -X POST http://localhost:3000/api/admin/sync-watchtower

# Check connection status
curl -X GET http://localhost:3000/api/admin/sync-watchtower
```

## 📱 Frontend Integration

Add WatchTower sync to your admin dashboard:

```typescript
// apps/web/src/components/admin/WatchTowerSync.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function WatchTowerSync() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/admin/sync-watchtower', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">WatchTower Sync</h3>
      
      <Button 
        onClick={handleSync} 
        disabled={syncing}
        className="w-full"
      >
        {syncing ? 'Syncing...' : 'Sync Users from WatchTower'}
      </Button>

      {result && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">{result.message}</p>
          <div className="mt-2 text-xs text-gray-500">
            Created: {result.created} | Updated: {result.updated} | Skipped: {result.skipped}
          </div>
        </div>
      )}
    </div>
  );
}
```

## 🔐 Authentication Flow

### Option 1: Single Sign-On (Recommended)

Users log in through WatchTower, then get redirected to TwentyFourSeven:

```typescript
// When user clicks "Access TV Service" in WatchTower
const redirectUrl = `${process.env.TWENTYFOURSEVEN_URL}/auth/watchtower?token=${userToken}`;

// In TwentyFourSeven auth handler
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  
  // Validate token with WatchTower
  const watchTowerService = WatchTowerHubService.getInstance();
  const user = await watchTowerService.validateUserToken(token);
  
  if (user) {
    // Create session in TwentyFourSeven
    await createSession(user);
    return redirect('/dashboard');
  }
  
  return redirect('/login?error=invalid_token');
}
```

### Option 2: Separate Authentication

Users have separate accounts but data stays synced via webhooks.

## 🎬 Real-World Scenarios

### **Scenario 1: New User Signs Up**

1. User goes to WatchTower website
2. Signs up and pays for TV service ($25/month)
3. WatchTower sends webhook to TwentyFourSeven
4. TwentyFourSeven creates user account
5. User gets email with TwentyFourSeven access link
6. User can immediately start watching TV

### **Scenario 2: User's Subscription Expires**

1. User's donation expires in WatchTower
2. WatchTower sends `user.updated` webhook
3. TwentyFourSeven receives webhook with updated donation status
4. TwentyFourSeven restricts user's access
5. User sees "Subscription Expired" message when trying to watch

### **Scenario 3: Admin Updates Channel List**

1. Admin updates TV service playlist URL in WatchTower
2. WatchTower sends `service.updated` webhook
3. TwentyFourSeven receives webhook
4. TwentyFourSeven automatically refreshes channel list
5. Users see new channels without any manual intervention

### **Scenario 4: Bulk User Import**

1. Admin runs manual sync in TwentyFourSeven
2. TwentyFourSeven fetches all users from WatchTower via API
3. Creates/updates 500+ users in seconds
4. All users can access TwentyFourSeven immediately

## 🔧 API Examples

### Check User Access
```typescript
async function checkUserAccess(email: string): Promise<boolean> {
  const watchTowerService = WatchTowerHubService.getInstance();
  const users = await watchTowerService.fetchUsers();
  
  const user = users.find(u => u.email === email);
  if (!user) return false;
  
  // Check if user has active TV service and valid donation
  const hasActiveTV = user.services.includes('TV');
  const donationValid = user.tv_donation_due 
    ? new Date(user.tv_donation_due) > new Date() 
    : false;
    
  return hasActiveTV && donationValid;
}
```

### Get User's Connection Limit
```typescript
async function getUserConnectionLimit(email: string): Promise<number> {
  const watchTowerService = WatchTowerHubService.getInstance();
  const users = await watchTowerService.fetchUsers();
  
  const user = users.find(u => u.email === email);
  return user?.tv_connections || 1; // Default to 1 connection
}
```

### Update User Activity
```typescript
async function trackUserActivity(userId: string, activity: string) {
  // You could send this back to WatchTower via API
  // Or just log it locally for analytics
  console.log(`User ${userId} activity: ${activity}`);
}
```

## 🚀 Advanced Features

### **Smart Channel Assignment**

Based on WatchTower user data, automatically assign different channel packages:

```typescript
function getChannelsForUser(user: WatchTowerUser): Channel[] {
  const baseChannels = getAllChannels();
  
  // Premium users get all channels
  if (user.tv_donation_amount && parseFloat(user.tv_donation_amount) >= 50) {
    return baseChannels;
  }
  
  // Standard users get basic package
  return baseChannels.filter(channel => channel.tier === 'basic');
}
```

### **Dynamic Connection Limits**

Enforce connection limits based on WatchTower subscription:

```typescript
function canUserConnect(user: WatchTowerUser, currentConnections: number): boolean {
  const maxConnections = user.tv_connections || 1;
  return currentConnections < maxConnections;
}
```

### **Automatic Access Management**

Set up automated access control:

```typescript
async function handleDonationExpired(userData: any) {
  // Disconnect user from all streams
  await disconnectUser(userData.email);
  
  // Send notification
  await sendNotification(userData.email, 'Your TV subscription has expired');
  
  // Redirect to WatchTower for renewal
  const renewalUrl = `${process.env.WATCHTOWER_BASE_URL}/renew`;
  await sendEmail(userData.email, `Renew your subscription: ${renewalUrl}`);
}
```

## 🎯 Benefits for You

### **For Users:**
- **Single account** across all your services
- **Automatic access** - pay in WatchTower, immediately access TwentyFourSeven
- **Seamless experience** - no duplicate signups or logins

### **For You (Admin):**
- **Centralized user management** in WatchTower
- **Real-time synchronization** - no manual user management in TwentyFourSeven
- **Automated billing** - handle payments in WatchTower, access updates automatically
- **Unified analytics** - see all user activity across apps

### **Technical Benefits:**
- **Single source of truth** for user data
- **Automatic failover** - webhooks + periodic sync ensures consistency
- **Scalable architecture** - can add more services easily
- **Security** - centralized authentication and authorization

## 🎉 Result

With this integration, **WatchTower becomes the king** 👑 of your app ecosystem:

1. **Users sign up once** in WatchTower
2. **Pay once** in WatchTower  
3. **Get access everywhere** - TwentyFourSeven, ESPG, future apps
4. **You manage everything** from one place (WatchTower)
5. **Real-time sync** keeps everything in perfect harmony

Your users get a seamless experience, and you get a powerful, centralized management system!

## 🚀 Next Steps

1. ✅ Set up environment variables
2. ✅ Update Prisma schema and migrate
3. ✅ Get API token from WatchTower
4. ✅ Register webhook endpoint
5. ✅ Test the integration
6. ✅ Add admin sync interface
7. ✅ Implement authentication flow
8. 🎉 Launch your unified ecosystem! 