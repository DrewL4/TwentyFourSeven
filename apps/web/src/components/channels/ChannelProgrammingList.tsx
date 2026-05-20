"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Film,
  Move,
  Trash2,
  Video,
} from "lucide-react";
import type { ChannelLineup, ChannelShowEpisode } from "@/types/channels";
import {
  buildLineupItems,
  formatDuration,
  type LineupItem,
} from "@/utils/channel-lineup";
import { channelShowEpisodesQueryOptions } from "@/utils/channel-query-helpers";

const EPISODE_ROW_HEIGHT = 52;
const EPISODE_VIRTUALIZE_THRESHOLD = 40;

interface ChannelProgrammingListProps {
  channelId: string;
  lineup: ChannelLineup;
  onLineupDragEnd: (items: LineupItem[]) => void;
  onEpisodeDragEnd: (showId: string, episodes: ChannelShowEpisode[]) => void;
  onRemoveShow: (showId: string) => void;
  onRemoveMovie: (movieId: string) => void;
  isReorderPending?: boolean;
}

function EpisodeRows({
  episodes,
  showId,
  channelId,
  onEpisodeDragEnd,
}: {
  episodes: ChannelShowEpisode[];
  showId: string;
  channelId: string;
  onEpisodeDragEnd: (showId: string, episodes: ChannelShowEpisode[]) => void;
}) {
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    if (sourceIndex === destIndex) return;

    const reordered = Array.from(episodes);
    const [removed] = reordered.splice(sourceIndex, 1);
    reordered.splice(destIndex, 0, removed);
    onEpisodeDragEnd(showId, reordered);
  };

  const renderEpisodeRow = (episode: ChannelShowEpisode, index: number) => (
    <div className="flex items-center gap-2 py-2 px-3 bg-muted/30 rounded border text-sm">
      <Move className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <Badge variant="outline" className="text-xs flex-shrink-0">
        S{episode.seasonNumber}E{episode.episodeNumber}
      </Badge>
      <span className="truncate flex-1">{episode.title}</span>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {formatDuration(episode.duration)}
      </span>
    </div>
  );

  if (episodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 px-3">No episodes found.</p>
    );
  }

  if (episodes.length > EPISODE_VIRTUALIZE_THRESHOLD) {
    return (
      <List
        height={Math.min(320, episodes.length * EPISODE_ROW_HEIGHT)}
        itemCount={episodes.length}
        itemSize={EPISODE_ROW_HEIGHT}
        width="100%"
        className="border rounded"
      >
        {({ index, style }: ListChildComponentProps) => (
          <div style={style} className="px-1">
            {renderEpisodeRow(episodes[index], index)}
          </div>
        )}
      </List>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId={`episodes-${showId}`}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="space-y-1 max-h-80 overflow-y-auto"
          >
            {episodes.map((episode, index) => (
              <Draggable
                key={episode.id}
                draggableId={`${channelId}-${showId}-${episode.id}`}
                index={index}
              >
                {(dragProvided) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                  >
                    {renderEpisodeRow(episode, index)}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function ExpandedShowEpisodes({
  channelId,
  showId,
  onEpisodeDragEnd,
}: {
  channelId: string;
  showId: string;
  onEpisodeDragEnd: (showId: string, episodes: ChannelShowEpisode[]) => void;
}) {
  const episodesQuery = useQuery({
    ...channelShowEpisodesQueryOptions(channelId, showId),
  });

  if (episodesQuery.isLoading) {
    return (
      <div className="py-3 px-3 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-10 bg-muted animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (episodesQuery.error) {
    return (
      <p className="text-sm text-destructive py-2 px-3">Failed to load episodes.</p>
    );
  }

  return (
    <EpisodeRows
      episodes={episodesQuery.data ?? []}
      showId={showId}
      channelId={channelId}
      onEpisodeDragEnd={onEpisodeDragEnd}
    />
  );
}

export function ChannelProgrammingList({
  channelId,
  lineup,
  onLineupDragEnd,
  onEpisodeDragEnd,
  onRemoveShow,
  onRemoveMovie,
  isReorderPending = false,
}: ChannelProgrammingListProps) {
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const lineupItems = useMemo(() => buildLineupItems(lineup), [lineup]);

  useEffect(() => {
    setExpandedShowId(null);
  }, [channelId]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || isReorderPending) return;
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    if (sourceIndex === destIndex) return;

    const reordered = Array.from(lineupItems);
    const [removed] = reordered.splice(sourceIndex, 1);
    reordered.splice(destIndex, 0, removed);
    onLineupDragEnd(reordered);
  };

  const toggleShow = (showId: string) => {
    setExpandedShowId((prev) => (prev === showId ? null : showId));
  };

  if (lineupItems.length === 0) {
    return null;
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId={`lineup-${channelId}`}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="space-y-2"
          >
            {lineupItems.map((item, index) => (
              <Draggable
                key={item.id}
                draggableId={item.id}
                index={index}
                isDragDisabled={isReorderPending}
              >
                {(dragProvided, snapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    className={`bg-background border rounded-lg overflow-hidden transition-shadow ${
                      snapshot.isDragging ? "shadow-lg ring-2 ring-primary/20" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 p-3">
                      <div
                        {...dragProvided.dragHandleProps}
                        className="cursor-grab active:cursor-grabbing touch-manipulation"
                        title="Drag to reorder"
                      >
                        <Move className="w-4 h-4 text-muted-foreground" />
                      </div>

                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {index + 1}
                      </Badge>

                      {item.type === "show" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 flex-shrink-0"
                          onClick={() => toggleShow(item.showId)}
                          aria-expanded={expandedShowId === item.showId}
                        >
                          {expandedShowId === item.showId ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      ) : (
                        <div className="w-8 flex-shrink-0 flex justify-center">
                          <Film className="w-4 h-4 text-orange-500" />
                        </div>
                      )}

                      <img
                        src={item.poster || "/placeholder.png"}
                        alt=""
                        className="w-10 h-14 object-cover rounded border flex-shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{item.title}</h4>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {item.type === "show" ? (
                            <Badge variant="secondary" className="text-xs">
                              <Video className="w-3 h-3 mr-1" />
                              {item.episodeCount} episodes
                            </Badge>
                          ) : (
                            <>
                              <Badge variant="secondary" className="text-xs">
                                {item.year ?? "Movie"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDuration(item.duration)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive flex-shrink-0"
                        onClick={() =>
                          item.type === "show"
                            ? onRemoveShow(item.showId)
                            : onRemoveMovie(item.movieId)
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {item.type === "show" && expandedShowId === item.showId && (
                      <div className="border-t px-3 pb-3 pt-2">
                        <ExpandedShowEpisodes
                          channelId={channelId}
                          showId={item.showId}
                          onEpisodeDragEnd={onEpisodeDragEnd}
                        />
                      </div>
                    )}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
