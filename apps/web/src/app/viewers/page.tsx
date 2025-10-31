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
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Viewer Tracking</h1>
        <p className="text-muted-foreground mt-2 text-sm md:text-base">
          Monitor active viewers and manage IP address mappings
        </p>
      </div>

      <Tabs defaultValue="active" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="w-full md:w-auto min-w-max md:min-w-0">
            <TabsTrigger value="active" className="touch-manipulation whitespace-nowrap">Active Viewers</TabsTrigger>
            <TabsTrigger value="history" className="touch-manipulation whitespace-nowrap">Viewing History</TabsTrigger>
            <TabsTrigger value="mappings" className="touch-manipulation whitespace-nowrap">IP Mappings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Currently Active Viewers</CardTitle>
              <CardDescription className="text-sm">
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
              <CardTitle className="text-lg md:text-xl">Viewing History</CardTitle>
              <CardDescription className="text-sm">
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
                <CardTitle className="text-lg md:text-xl">Add IP Mapping</CardTitle>
                <CardDescription className="text-sm">
                  Assign a name to an IP address for easier identification
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IpMappingForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Existing Mappings</CardTitle>
                <CardDescription className="text-sm">
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

