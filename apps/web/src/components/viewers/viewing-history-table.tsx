"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export default function ViewingHistoryTable() {
  const [ipFilter, setIpFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState<number | undefined>();
  const [page, setPage] = useState(0);
  const [startDate, setStartDate] = useState<Date | undefined>(
    new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
  );
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  const { data: historyData, isLoading, refetch } = useQuery(
    orpc.viewers.getHistory.queryOptions({
      input: {
        ipAddress: ipFilter || undefined,
        channelNumber: channelFilter,
        startDate: startDate,
        endDate: endDate,
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

  const handleSearch = () => {
    setPage(0);
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Filter by IP address..."
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
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
        <Button onClick={handleSearch}>
          <Search className="w-4 h-4 mr-2" />
          Search
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading history...</div>
      ) : !historyData?.entries || historyData.entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No viewing history found</div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-sm">{entry.ipAddress}</TableCell>
                    <TableCell>{entry.viewerName || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {entry.channelNumber}
                      {entry.channelName && (
                        <span className="text-muted-foreground ml-2">({entry.channelName})</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {entry.programTitle || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{format(entry.startTime, "MMM d, HH:mm")}</TableCell>
                    <TableCell>
                      {entry.endTime ? format(entry.endTime, "MMM d, HH:mm") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{formatDuration(entry.duration)}</TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {page * 50 + 1} - {Math.min((page + 1) * 50, historyData.total)} of {historyData.total}
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
                disabled={(page + 1) * 50 >= historyData.total}
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

