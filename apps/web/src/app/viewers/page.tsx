"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdmin } from "@/hooks/use-admin";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import ActiveViewersTable from "@/components/viewers/active-viewers-table";
import ViewingHistoryTable from "@/components/viewers/viewing-history-table";
import IpMappingForm from "@/components/viewers/ip-mapping-form";
import IpMappingList from "@/components/viewers/ip-mapping-list";

export default function ViewersPage() {
  const { isAdmin, isLoading } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/");
    }
  }, [isAdmin, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Viewer Tracking</h1>
        <p className="text-muted-foreground mt-2">
          Monitor active viewers and manage IP address mappings
        </p>
      </div>

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active">Active Viewers</TabsTrigger>
          <TabsTrigger value="history">Viewing History</TabsTrigger>
          <TabsTrigger value="mappings">IP Mappings</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Currently Active Viewers</CardTitle>
              <CardDescription>
                Real-time list of all active video streams
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActiveViewersTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Viewing History</CardTitle>
              <CardDescription>
                Session-based viewing history grouped by channel and viewer
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ViewingHistoryTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mappings" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Add IP Mapping</CardTitle>
                <CardDescription>
                  Assign a name to an IP address for easier identification
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IpMappingForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Existing Mappings</CardTitle>
                <CardDescription>
                  Manage IP address name mappings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IpMappingList />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

