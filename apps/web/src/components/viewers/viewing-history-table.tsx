"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, RefreshCw, ChevronDown, ChevronRight, UserPlus, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function ViewingHistoryTable() {
  const [ipFilter, setIpFilter] = useState("");
  const [viewerNameFilter, setViewerNameFilter] = useState<string>("__all__");
  const [channelFilter, setChannelFilter] = useState<number | undefined>();
  const [page, setPage] = useState(0);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [assigningIp, setAssigningIp] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState<string>(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const { data: mappings } = useQuery(orpc.viewers.listMappings.queryOptions());
  const { data: users } = useQuery(orpc.viewers.getUsers.queryOptions());
  const viewerNames = Array.from(new Set(mappings?.map(m => m.name) || []));
  const assignIpToUser = useMutation(orpc.viewers.assignIpToUser.mutationOptions());

  const { data: sessionsData, isLoading, refetch } = useQuery(
    orpc.viewers.getViewingSessions.queryOptions({
      input: {
        ipAddress: ipFilter || undefined,
        viewerName: viewerNameFilter && viewerNameFilter !== "__all__" ? viewerNameFilter : undefined,
        channelNumber: channelFilter,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate + 'T23:59:59') : undefined,
        limit: 50,
        offset: page * 50,
      }
    })
  );

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "—";
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

  const toggleSession = (sessionId: string) => {
    const newExpanded = new Set(expandedSessions);
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedSessions(newExpanded);
  };

  const handleSearch = () => {
    setPage(0);
    refetch();
  };

  const handleAssignToUser = async (ipAddress: string, userId: string) => {
    try {
      await assignIpToUser.mutateAsync({ ipAddress, userId });
      toast.success("IP address assigned to user");
      setAssigningIp(null);
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getViewingSessions.queryOptions({ input: {} }).queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to assign IP to user");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex-1">
            <Input
              placeholder="Filter by IP address..."
              value={ipFilter}
              onChange={(e) => setIpFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className="flex-1">
            <Select 
              value={viewerNameFilter} 
              onValueChange={setViewerNameFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by viewer..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All viewers</SelectItem>
                {viewerNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full md:w-48">
            <Input
              type="number"
              placeholder="Channel number..."
              value={channelFilter || ""}
              onChange={(e) => setChannelFilter(e.target.value ? parseInt(e.target.value) : undefined)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4 mr-2" />
              Search
            </Button>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Start Date</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">End Date</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading history...</div>
      ) : !sessionsData?.sessions || sessionsData.sessions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No viewing sessions found</div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Viewer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Programs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionsData.sessions.map((session) => {
                  const isExpanded = expandedSessions.has(session.id);
                  const hasMultiplePrograms = session.history.length > 1;
                  
                  return (
                    <>
                        <TableRow>
                          <TableCell>
                            {hasMultiplePrograms ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0"
                                onClick={() => toggleSession(session.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{session.ipAddress}</TableCell>
                          <TableCell>{session.viewerName || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            {session.channelNumber}
                            {session.channelName && (
                              <span className="text-muted-foreground ml-2">({session.channelName})</span>
                            )}
                          </TableCell>
                          <TableCell>{format(session.sessionStart, "MMM d, HH:mm")}</TableCell>
                          <TableCell>
                            {session.sessionEnd ? format(session.sessionEnd, "MMM d, HH:mm") : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>{formatDuration(session.totalDuration)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{session.programCount}</Badge>
                          </TableCell>
                          <TableCell>
                            {session.history.some(h => h.status === 'failed') ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge variant="destructive">Failed</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="max-w-xs">
                                      {session.history
                                        .filter(h => h.status === 'failed' && h.statusMessage)
                                        .map((h, idx) => (
                                          <div key={idx} className="text-xs mb-1">
                                            {h.statusMessage}
                                          </div>
                                        ))}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : session.history.some(h => h.status === 'active') ? (
                              <Badge variant="secondary">Active</Badge>
                            ) : (
                              <Badge variant="default">Completed</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {assigningIp === session.ipAddress ? (
                              <Select
                                onValueChange={(userId) => {
                                  if (userId && userId !== "__cancel__") {
                                    handleAssignToUser(session.ipAddress, userId);
                                  } else {
                                    setAssigningIp(null);
                                  }
                                }}
                                defaultValue="__cancel__"
                              >
                                <SelectTrigger className="w-40">
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
                                  <Button variant="ghost" size="sm">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setAssigningIp(session.ipAddress)}>
                                    <UserPlus className="w-4 h-4 mr-2" />
                                    Assign to User
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                        {hasMultiplePrograms && isExpanded && (
                          <>
                            {session.history.map((entry) => (
                              <TableRow key={entry.id} className="bg-muted/50">
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {entry.programTitle || "—"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {format(entry.startTime, "HH:mm")}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {entry.endTime ? format(entry.endTime, "HH:mm") : "—"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatDuration(entry.duration)}
                                </TableCell>
                                <TableCell></TableCell>
                                <TableCell>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Badge
                                          variant={
                                            entry.status === 'completed'
                                              ? 'default'
                                              : entry.status === 'failed'
                                              ? 'destructive'
                                              : 'secondary'
                                          }
                                        >
                                          {entry.status}
                                        </Badge>
                                      </TooltipTrigger>
                                      {entry.statusMessage && (
                                        <TooltipContent>
                                          <div className="max-w-xs text-sm">
                                            {entry.statusMessage}
                                          </div>
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                  </TooltipProvider>
                                </TableCell>
                                <TableCell></TableCell>
                              </TableRow>
                            ))}
                          </>
                        )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {page * 50 + 1} - {Math.min((page + 1) * 50, sessionsData.total)} of {sessionsData.total}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * 50 >= sessionsData.total}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
