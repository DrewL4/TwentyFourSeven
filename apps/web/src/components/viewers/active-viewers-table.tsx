"use client";

import { useState, useEffect } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RefreshCw, Clock, UserPlus, MoreVertical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function ActiveViewersTable() {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [assigningIp, setAssigningIp] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: activeViewers, isLoading, refetch } = useQuery(
    orpc.viewers.getActive.queryOptions()
  );

  const { data: users } = useQuery(orpc.viewers.getUsers.queryOptions());
  const assignIpToUser = useMutation(orpc.viewers.assignIpToUser.mutationOptions());

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

  const handleAssignToUser = async (ipAddress: string, userId: string) => {
    try {
      await assignIpToUser.mutateAsync({ ipAddress, userId });
      toast.success("IP address assigned to user");
      setAssigningIp(null);
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getActive.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to assign IP to user");
    }
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
        <div className="text-xs sm:text-sm text-muted-foreground">
          Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => { refetch(); setLastUpdated(new Date()); }}
          className="touch-manipulation w-full sm:w-auto"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">IP Address</TableHead>
                <TableHead className="min-w-[100px]">Name</TableHead>
                <TableHead className="min-w-[100px]">Channel</TableHead>
                <TableHead className="min-w-[150px]">Program</TableHead>
                <TableHead className="min-w-[120px]">Start Time</TableHead>
                <TableHead className="min-w-[80px]">Duration</TableHead>
                <TableHead className="min-w-[80px]">Status</TableHead>
                <TableHead className="min-w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeViewers.map((viewer) => (
                <TableRow key={viewer.sessionId}>
                  <TableCell className="font-mono text-xs sm:text-sm">{viewer.ipAddress}</TableCell>
                  <TableCell className="text-sm">{viewer.viewerName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm">
                    {viewer.channelNumber}
                    {viewer.channelName && (
                      <span className="text-muted-foreground ml-1 sm:ml-2">({viewer.channelName})</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[150px] sm:max-w-xs truncate text-sm">
                    {viewer.programTitle || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="whitespace-nowrap">{formatDistanceToNow(viewer.startTime, { addSuffix: true })}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatDuration(viewer.duration)}</TableCell>
                  <TableCell>
                    <Badge variant={viewer.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {viewer.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {assigningIp === viewer.ipAddress ? (
                      <Select
                        onValueChange={(userId) => {
                          if (userId && userId !== "__cancel__") {
                            handleAssignToUser(viewer.ipAddress, userId);
                          } else {
                            setAssigningIp(null);
                          }
                        }}
                        defaultValue="__cancel__"
                      >
                        <SelectTrigger className="w-full sm:w-40 touch-manipulation">
                          <SelectValue placeholder="Select user..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__cancel__">Cancel</SelectItem>
                          {users?.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="touch-manipulation h-9 w-9 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => setAssigningIp(viewer.ipAddress)}
                            className="touch-manipulation"
                          >
                            <UserPlus className="w-4 h-4 mr-2" />
                            Assign to User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

