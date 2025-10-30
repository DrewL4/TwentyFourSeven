"use client";

import { useState, useEffect } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ActiveViewersTable() {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const { data: activeViewers, isLoading, refetch } = useQuery(
    orpc.viewers.getActive.queryOptions()
  );

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      setLastUpdated(new Date());
    }, 30000);

    return () => clearInterval(interval);
  }, [refetch]);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading active viewers...</div>;
  }

  if (!activeViewers || activeViewers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No active viewers at this time</p>
        <p className="text-sm mt-2">
          Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetch(); setLastUpdated(new Date()); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IP Address</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Start Time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeViewers.map((viewer) => (
              <TableRow key={viewer.sessionId}>
                <TableCell className="font-mono text-sm">{viewer.ipAddress}</TableCell>
                <TableCell>{viewer.viewerName || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {viewer.channelNumber}
                  {viewer.channelName && (
                    <span className="text-muted-foreground ml-2">({viewer.channelName})</span>
                  )}
                </TableCell>
                <TableCell className="max-w-xs truncate">
                  {viewer.programTitle || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    {formatDistanceToNow(viewer.startTime, { addSuffix: true })}
                  </div>
                </TableCell>
                <TableCell>{formatDuration(viewer.duration)}</TableCell>
                <TableCell>
                  <Badge variant={viewer.status === 'active' ? 'default' : 'secondary'}>
                    {viewer.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

