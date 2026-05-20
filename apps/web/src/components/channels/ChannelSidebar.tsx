"use client";

import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChannelSummary } from "@/types/channels";
import { Edit, Plus, Radio } from "lucide-react";
import { useMemo } from "react";

const ROW_HEIGHT = 72;
const VIRTUALIZE_THRESHOLD = 30;

export type ChannelSidebarProps = {
  channels: ChannelSummary[];
  selectedChannelId: string | null;
  isLoading: boolean;
  error: Error | null;
  onSelect: (channelId: string) => void;
  onEdit: (channel: ChannelSummary) => void;
  onAddChannel: () => void;
  onPrefetch?: (channelId: string) => void;
};

function ChannelRow({
  channel,
  selectedChannelId,
  onSelect,
  onEdit,
  onPrefetch,
  style,
}: {
  channel: ChannelSummary;
  selectedChannelId: string | null;
  onSelect: (id: string) => void;
  onEdit: (channel: ChannelSummary) => void;
  onPrefetch?: (id: string) => void;
  style?: React.CSSProperties;
}) {
  const itemCount =
    (channel.channelShowCount ?? 0) + (channel.channelMovieCount ?? 0);

  return (
    <div style={style} className="px-2">
      <div
        className={`group p-3 border-l-4 transition-colors touch-manipulation ${
          selectedChannelId === channel.id
            ? "bg-accent border-l-primary"
            : "hover:bg-muted border-l-transparent"
        }`}
      >
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs px-2 py-1">
            {channel.number}
          </Badge>
          {channel.icon && (
            <img
              src={channel.icon}
              alt=""
              className="w-6 h-6 rounded object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onSelect(channel.id)}
            onMouseEnter={() => onPrefetch?.(channel.id)}
            onFocus={() => onPrefetch?.(channel.id)}
          >
            <h4 className="font-medium text-sm truncate">{channel.name}</h4>
            <p className="text-xs text-muted-foreground">{itemCount} items</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 hover:opacity-100 touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(channel);
                }}
              >
                <Edit className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Edit channel</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function VirtualRow({
  index,
  style,
  data,
}: ListChildComponentProps<{
  channels: ChannelSummary[];
  selectedChannelId: string | null;
  onSelect: (id: string) => void;
  onEdit: (channel: ChannelSummary) => void;
  onPrefetch?: (id: string) => void;
}>) {
  const channel = data.channels[index];
  return (
    <ChannelRow
      channel={channel}
      selectedChannelId={data.selectedChannelId}
      onSelect={data.onSelect}
      onEdit={data.onEdit}
      onPrefetch={data.onPrefetch}
      style={style}
    />
  );
}

export function ChannelSidebar({
  channels,
  selectedChannelId,
  isLoading,
  error,
  onSelect,
  onEdit,
  onAddChannel,
  onPrefetch,
}: ChannelSidebarProps) {
  const listData = useMemo(
    () => ({ channels, selectedChannelId, onSelect, onEdit, onPrefetch }),
    [channels, selectedChannelId, onSelect, onEdit, onPrefetch],
  );

  return (
    <div className="hidden md:block lg:col-span-1">
      <Card>
        <CardHeader className="flex-shrink-0 pb-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg flex-shrink-0">Channels</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={onAddChannel}
                  className="touch-manipulation flex-shrink-0"
                >
                  <Plus className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Add Channel</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add Channel</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-6">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-12 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-destructive">Error loading channels</p>
            </div>
          ) : channels.length === 0 ? (
            <div className="p-8 text-center">
              <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-2">No channels yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first channel to get started
              </p>
              <Button size="sm" onClick={onAddChannel} className="touch-manipulation">
                <Plus className="w-4 h-4 mr-2" />
                Create Channel
              </Button>
            </div>
          ) : channels.length > VIRTUALIZE_THRESHOLD ? (
            <List
              height={480}
              itemCount={channels.length}
              itemSize={ROW_HEIGHT}
              width="100%"
              itemData={listData}
              className="flex-1"
            >
              {VirtualRow}
            </List>
          ) : (
            <div className="max-h-[min(70vh,520px)] overflow-y-auto space-y-1 p-2">
              {channels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  selectedChannelId={selectedChannelId}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
