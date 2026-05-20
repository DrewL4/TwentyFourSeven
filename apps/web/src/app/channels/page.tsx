"use client"
import React from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { 
  Plus, 
  Settings, 
  Trash2, 
  Radio, 
  Play, 
  Edit, 
  EyeOff,
  Move,
  Shuffle,
  Clock,
  Video,
  Film,
  Music,
  RotateCcw,
  Grid3X3,
  ArrowLeft,
  SortAsc,
  SortDesc,
  CalendarDays,
  Timer,
  Type,
  Zap,
  Info,
  Folder,
  CheckSquare,
  Square
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, X, ChevronDown, ChevronRight, Filter, User, Calendar, Tag, Rewind } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { Autocomplete } from "@/components/ui/combobox"
import { MultiSelect } from "@/components/ui/multi-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// Dialog components not available; using inline panel instead
import { Separator } from "@/components/ui/separator";
import { ChannelSidebar } from "@/components/channels/ChannelSidebar";
import { ChannelProgrammingList } from "@/components/channels/ChannelProgrammingList";
import type { ChannelSummary, ChannelLineup, ChannelShowEpisode } from "@/types/channels";
import { useChannelSelectionUrl } from "@/hooks/channels/use-channel-selection";
import {
  channelLineupQueryOptions,
  invalidateChannelDetail,
  prefetchChannelLineup,
} from "@/utils/channel-query-helpers";
import { buildLineupItems, type LineupItem } from "@/utils/channel-lineup";

type Channel = {
  id: string;
  number: number;
  name: string;
  icon?: string | null;
  stealth: boolean;
  groupTitle?: string | null;
  programs?: any[];
  channelShows?: ChannelShow[];
  channelMovies?: ChannelMovie[];
  fillerContent?: any[];
  watermarks?: any[];
  // TwentyFourSeven features
  isOnDemand?: boolean;
  episodeMemoryEnabled?: boolean;
  transcodingEnabled?: boolean;
  offlineMode?: string;
  iconWidth?: number;
  iconDuration?: number;
  iconPosition?: string;
  // Automation settings
  autoFilterEnabled?: boolean;
  filterGenres?: string;
  filterActors?: string;
  filterDirectors?: string;
  filterStudios?: string;
  filterCollections?: string;
  filterYearStart?: number;
  filterYearEnd?: number;
  filterRating?: string;
  filterType?: string;
  lastAutoScanAt?: Date;
  // Advanced reorder options for automation
  defaultEpisodeOrder?: string;
  respectEpisodeOrder?: boolean;
  blockShuffle?: boolean;
  blockShuffleSize?: number;
  autoSortMethod?: string;
  // Catchup / Timeshift
  catchupEnabled?: boolean;
  catchupWindowHours?: number;
};

type Show = {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  episodes?: Episode[];
};

type Episode = {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  duration: number;
  thumb?: string;
};

type Movie = {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  duration: number;
};

type ChannelShow = {
  id: string;
  showId: string;
  show: Show;
  order: number;
  shuffle: boolean;
  shuffleOrder: string;
  blockShuffle: boolean;
  blockShuffleSize: number;
  maxConsecutiveEpisodes: number;
  respectEpisodeOrder: boolean;
};

type ChannelMovie = {
  id: string;
  movieId: string;
  movie: Movie;
  order: number;
  shuffle: boolean;
  maxConsecutiveMovies: number;
};

interface AddContentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  existingShows: any[];
  existingMovies: any[];
  existingChannelData?: any; // Add existing channel data
  onAddShows: (showId: string, selections?: { seasons?: number[], episodes?: string[] }, keepUp?: boolean) => void;
  onAddMovies: (movieId: string) => void;
  onSaveAutomation?: (filters: any) => void;
}

function AddContentDialog({ 
  isOpen, 
  onClose, 
  channelId, 
  existingShows, 
  existingMovies, 
  existingChannelData, // Add existing channel data prop
  onAddShows, 
  onAddMovies,
  onSaveAutomation
}: AddContentDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedShows, setSelectedShows] = useState<Set<string>>(new Set());
  const [selectedMovies, setSelectedMovies] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("shows");
  const [showFilters, setShowFilters] = useState(false);
  
  // Advanced filters
  const [yearFilter, setYearFilter] = useState("");
  const [yearRangeStart, setYearRangeStart] = useState("");
  const [yearRangeEnd, setYearRangeEnd] = useState("");
  const [genreFilter, setGenreFilter] = useState<string[]>([]);
  const [actorFilter, setActorFilter] = useState<string[]>([]);
  const [directorFilter, setDirectorFilter] = useState<string[]>([]);
  const [studioFilter, setStudioFilter] = useState<string[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string[]>([]);
  const [ratingFilter, setRatingFilter] = useState("");
  const [autoFilterEnabled, setAutoFilterEnabled] = useState(false);
  const [smartFilteringEnabled, setSmartFilteringEnabled] = useState(false);
  const [keepUpToDate, setKeepUpToDate] = useState(false);
  
  // TV Show episode selection
  const [expandedShows, setExpandedShows] = useState<Set<string>>(new Set());
  const [selectedEpisodes, setSelectedEpisodes] = useState<Record<string, Set<string>>>({}); // showId -> episode IDs
  const [selectedSeasons, setSelectedSeasons] = useState<Record<string, Set<number>>>({}); // showId -> season numbers

  const [debouncedSearch] = useDebounce(searchTerm, 300);

  const showsQuery = useQuery({
    ...orpc.library.shows.queryOptions({ input: { limit: 200, includeEpisodes: true } }),
    enabled: isOpen && debouncedSearch.trim().length < 2,
  });
  const moviesQuery = useQuery({
    ...orpc.library.movies.queryOptions({ input: { limit: 200 } }),
    enabled: isOpen && debouncedSearch.trim().length < 2,
  });
  const librarySearchQuery = useQuery({
    ...orpc.library.search.queryOptions({ input: { query: debouncedSearch, limit: 200 } }),
    enabled: isOpen && debouncedSearch.trim().length >= 2,
  });

  const catalogShows =
    debouncedSearch.trim().length >= 2
      ? (librarySearchQuery.data?.shows ?? [])
      : (showsQuery.data?.items ?? []);
  const catalogMovies =
    debouncedSearch.trim().length >= 2
      ? (librarySearchQuery.data?.movies ?? [])
      : (moviesQuery.data?.items ?? []);

  // Populate form fields with existing channel data when dialog opens
  useEffect(() => {
    if (isOpen && existingChannelData) {
      // Populate automation filters from existing channel data
      setAutoFilterEnabled(existingChannelData.autoFilterEnabled || false);
      
      // Parse JSON filter fields safely
      try {
        setGenreFilter(existingChannelData.filterGenres ? JSON.parse(existingChannelData.filterGenres) : []);
      } catch (e) {
        setGenreFilter([]);
      }
      
      try {
        setActorFilter(existingChannelData.filterActors ? JSON.parse(existingChannelData.filterActors) : []);
      } catch (e) {
        setActorFilter([]);
      }
      
      try {
        setDirectorFilter(existingChannelData.filterDirectors ? JSON.parse(existingChannelData.filterDirectors) : []);
      } catch (e) {
        setDirectorFilter([]);
      }
      
      try {
        setStudioFilter(existingChannelData.filterStudios ? JSON.parse(existingChannelData.filterStudios) : []);
      } catch (e) {
        setStudioFilter([]);
      }
      
      try {
        setCollectionFilter(existingChannelData.filterCollections ? JSON.parse(existingChannelData.filterCollections) : []);
      } catch (e) {
        setCollectionFilter([]);
      }
      
      // Set other filter fields
      setYearRangeStart(existingChannelData.filterYearStart?.toString() || "");
      setYearRangeEnd(existingChannelData.filterYearEnd?.toString() || "");
      setRatingFilter(existingChannelData.filterRating || "");
      
      // Note: Smart filtering is a UI-only feature, not persisted to the database
      // It will default to false each time the dialog opens
    }
  }, [isOpen, existingChannelData]);

  // Metadata queries for autocomplete
  const [actorSearch, setActorSearch] = useState("");
  const [directorSearch, setDirectorSearch] = useState("");
  const [genreSearch, setGenreSearch] = useState("");
  const [studioSearch, setStudioSearch] = useState("");

  const actorsQuery = useQuery(orpc.channels.getActors.queryOptions({ 
    input: { search: actorSearch, limit: 200 } 
  }));
  const directorsQuery = useQuery(orpc.channels.getDirectors.queryOptions({ 
    input: { search: directorSearch, limit: 200 } 
  }));
  const genresQuery = useQuery(orpc.channels.getGenres.queryOptions({ 
    input: { search: genreSearch, limit: 200 } 
  }));
  const studiosQuery = useQuery(orpc.channels.getStudios.queryOptions({ 
    input: { search: studioSearch, limit: 200 } 
  }));

    // Get filtered content for smart filtering context
  const getFilteredContent = (excludeFilter?: 'ratings') => {
    const allContent = [
      ...(catalogShows || []).map((show: any) => ({ ...show, type: 'show' })),
      ...(catalogMovies || []).map((movie: any) => ({ ...movie, type: 'movie' }))
    ];

    return allContent.filter((item: any) => {
      // Apply current filters to get contextual content
      const matchesYear = !yearFilter || item.year?.toString().includes(yearFilter);
      const matchesYearRange = (!yearRangeStart || item.year >= parseInt(yearRangeStart)) &&
                              (!yearRangeEnd || item.year <= parseInt(yearRangeEnd));
      
      // Parse JSON metadata fields
      const genres = item.genres ? JSON.parse(item.genres) : [];
      const actors = item.actors ? JSON.parse(item.actors) : [];
      const directors = item.directors ? JSON.parse(item.directors) : [];
      const studio = item.studio || '';
      
      const matchesGenre = genreFilter.length === 0 || 
        genreFilter.some(selectedGenre => 
          genres.some((g: string) => g.toLowerCase().includes(selectedGenre.toLowerCase()))
        );
      
      const matchesActor = actorFilter.length === 0 || 
        actorFilter.some(selectedActor => 
          actors.some((a: string) => a.toLowerCase().includes(selectedActor.toLowerCase()))
        );
      
      const matchesDirector = directorFilter.length === 0 || 
        directorFilter.some(selectedDirector => 
          directors.some((d: string) => d.toLowerCase().includes(selectedDirector.toLowerCase()))
        );
      
      const matchesStudio = studioFilter.length === 0 || 
        studioFilter.some(selectedStudio => 
          studio.toLowerCase().includes(selectedStudio.toLowerCase())
        );
      
      // Exclude rating filter when calculating contextual ratings to avoid circular dependency
      const matchesRating = excludeFilter === 'ratings' || !ratingFilter || item.contentRating === ratingFilter;
      
      return matchesYear && matchesYearRange && matchesGenre && matchesActor && 
             matchesDirector && matchesStudio && matchesRating;
    });
  };

  // Get contextual options based on current filter selections
  const getContextualOptions = useCallback((type: 'actors' | 'directors' | 'genres' | 'studios' | 'ratings') => {
    if (!smartFilteringEnabled) {
      // Return all options when smart filtering is disabled
      switch (type) {
        case 'actors': return actorsQuery.data || [];
        case 'directors': return directorsQuery.data || [];
        case 'genres': return genresQuery.data || [];
        case 'studios': return studiosQuery.data || [];
        case 'ratings': return ['G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'];
        default: return [];
      }
    }

    const filteredContent = getFilteredContent(type === 'ratings' ? 'ratings' : undefined);
    const optionsSet = new Set<string>();

    filteredContent.forEach((item: any) => {
      try {
        let values: string[] = [];
        
        switch (type) {
          case 'actors':
            values = item.actors ? JSON.parse(item.actors) : [];
            break;
          case 'directors':
            values = item.directors ? JSON.parse(item.directors) : [];
            break;
          case 'genres':
            values = item.genres ? JSON.parse(item.genres) : [];
            break;
          case 'studios':
            values = item.studio ? [item.studio] : [];
            break;
          case 'ratings':
            values = item.contentRating ? [item.contentRating] : [];
            break;
        }
        
        values.forEach(value => {
          if (value && value.trim()) {
            optionsSet.add(value.trim());
          }
        });
      } catch (e) {
        // Skip items with invalid JSON
      }
    });

    // Convert to array and sort, then filter by search term
    const searchTerm = type === 'actors' ? actorSearch : 
                      type === 'directors' ? directorSearch :
                      type === 'genres' ? genreSearch : 
                      type === 'studios' ? studioSearch : '';
    
    return Array.from(optionsSet)
      .sort()
      .filter(option => !searchTerm || option.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [smartFilteringEnabled, genreFilter, actorFilter, directorFilter, studioFilter, yearFilter, yearRangeStart, yearRangeEnd, ratingFilter, actorSearch, directorSearch, genreSearch, studioSearch, catalogShows, catalogMovies, actorsQuery.data, directorsQuery.data, genresQuery.data, studiosQuery.data]);

  // Enhanced filter logic
  const filteredShows = (catalogShows || []).filter((show: any) => {
    const matchesSearch = !searchTerm || 
      show.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      show.summary?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesYear = !yearFilter || show.year?.toString().includes(yearFilter);
    const matchesYearRange = (!yearRangeStart || show.year >= parseInt(yearRangeStart)) &&
                            (!yearRangeEnd || show.year <= parseInt(yearRangeEnd));
    
    // Parse JSON metadata fields
    const genres = show.genres ? JSON.parse(show.genres) : [];
    const actors = show.actors ? JSON.parse(show.actors) : [];
    const directors = show.directors ? JSON.parse(show.directors) : [];
    
    const matchesGenre = genreFilter.length === 0 || 
      genreFilter.some(selectedGenre => 
        genres.some((g: string) => g.toLowerCase().includes(selectedGenre.toLowerCase()))
      );
    
    const matchesActor = actorFilter.length === 0 ||
      actorFilter.some(selectedActor =>
        actors.some((a: string) => a.toLowerCase().includes(selectedActor.toLowerCase()))
      );
    
    const matchesDirector = directorFilter.length === 0 ||
      directorFilter.some(selectedDirector =>
        directors.some((d: string) => d.toLowerCase().includes(selectedDirector.toLowerCase()))
      );
    
    const matchesStudio = studioFilter.length === 0 ||
      studioFilter.some(selectedStudio =>
        show.studio?.toLowerCase().includes(selectedStudio.toLowerCase())
      );
    
    const matchesRating = !ratingFilter || show.contentRating === ratingFilter;
    
    const notAlreadyAdded = !existingShows.some(es => es.showId === show.id);
    
    return matchesSearch && matchesYear && matchesYearRange && matchesGenre && 
           matchesActor && matchesDirector && matchesStudio && matchesRating && notAlreadyAdded;
  });

  const filteredMovies = (catalogMovies || []).filter((movie: any) => {
    const matchesSearch = !searchTerm || 
      movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      movie.summary?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesYear = !yearFilter || movie.year?.toString().includes(yearFilter);
    const matchesYearRange = (!yearRangeStart || movie.year >= parseInt(yearRangeStart)) &&
                            (!yearRangeEnd || movie.year <= parseInt(yearRangeEnd));
    
    // Parse JSON metadata fields
    const genres = movie.genres ? JSON.parse(movie.genres) : [];
    const actors = movie.actors ? JSON.parse(movie.actors) : [];
    const directors = movie.directors ? JSON.parse(movie.directors) : [];
    
    const matchesGenre = genreFilter.length === 0 || 
      genreFilter.some(selectedGenre => 
        genres.some((g: string) => g.toLowerCase().includes(selectedGenre.toLowerCase()))
      );
    
    const matchesActor = actorFilter.length === 0 ||
      actorFilter.some(selectedActor =>
        actors.some((a: string) => a.toLowerCase().includes(selectedActor.toLowerCase()))
      );
    
    const matchesDirector = directorFilter.length === 0 ||
      directorFilter.some(selectedDirector =>
        directors.some((d: string) => d.toLowerCase().includes(selectedDirector.toLowerCase()))
      );
    
    const matchesStudio = studioFilter.length === 0 ||
      studioFilter.some(selectedStudio =>
        movie.studio?.toLowerCase().includes(selectedStudio.toLowerCase())
      );
    
    const matchesRating = !ratingFilter || movie.contentRating === ratingFilter;
    
    const notAlreadyAdded = !existingMovies.some(em => em.movieId === movie.id);
    
    return matchesSearch && matchesYear && matchesYearRange && matchesGenre && 
           matchesActor && matchesDirector && matchesStudio && matchesRating && notAlreadyAdded;
  });

  const handleBulkAddShows = () => {
    selectedShows.forEach(showId => {
      const selectedShowSeasons = selectedSeasons[showId] || new Set();
      const selectedShowEpisodes = selectedEpisodes[showId] || new Set();
      
      // Determine if we should auto-add new episodes:
      // - If automation is enabled AND adding entire shows (not specific episodes) → autoAddNewEpisodes = true
      // - If automation is disabled OR adding specific episodes → autoAddNewEpisodes = false
      const isAddingEntireShow = selectedShowSeasons.size === 0 && selectedShowEpisodes.size === 0;
      const shouldAutoAddNewEpisodes = autoFilterEnabled && isAddingEntireShow;
      
      if (selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) {
        // Add with specific seasons/episodes (no auto-add)
        onAddShows(showId, {
          seasons: Array.from(selectedShowSeasons),
          episodes: Array.from(selectedShowEpisodes)
        }, false);
      } else {
        // Add entire show (use automation setting)
        onAddShows(showId, undefined, shouldAutoAddNewEpisodes);
      }
    });
    
    // Save automation filters if enabled
    if (autoFilterEnabled && onSaveAutomation) {
      const filters = {
        autoFilterEnabled: true,
        filterGenres: genreFilter.length > 0 ? JSON.stringify(genreFilter) : undefined,
        filterActors: actorFilter.length > 0 ? JSON.stringify(actorFilter) : undefined,
        filterDirectors: directorFilter.length > 0 ? JSON.stringify(directorFilter) : undefined,
        filterStudios: studioFilter.length > 0 ? JSON.stringify(studioFilter) : undefined,
        filterCollections: collectionFilter.length > 0 ? JSON.stringify(collectionFilter) : undefined,
        filterYearStart: yearFilter ? parseInt(yearFilter) : (yearRangeStart ? parseInt(yearRangeStart) : undefined),
        filterYearEnd: yearFilter ? parseInt(yearFilter) : (yearRangeEnd ? parseInt(yearRangeEnd) : undefined),
        filterRating: ratingFilter || undefined,
        filterType: 'shows',
        // Include reorder settings from existing channel data
        defaultEpisodeOrder: existingChannelData?.defaultEpisodeOrder || "sequential",
        respectEpisodeOrder: existingChannelData?.respectEpisodeOrder ?? true,
        blockShuffle: existingChannelData?.blockShuffle || false,
        blockShuffleSize: existingChannelData?.blockShuffleSize || 1,
        autoSortMethod: existingChannelData?.autoSortMethod || undefined
      };
      onSaveAutomation(filters);
    }
    
    setSelectedShows(new Set());
    setSelectedSeasons({});
    setSelectedEpisodes({});
    setKeepUpToDate(false);
  };

  const handleBulkAddMovies = () => {
    selectedMovies.forEach(movieId => onAddMovies(movieId));
    
    // Save automation filters if enabled
    if (autoFilterEnabled && onSaveAutomation) {
      const filters = {
        autoFilterEnabled: true,
        filterGenres: genreFilter.length > 0 ? JSON.stringify(genreFilter) : undefined,
        filterActors: actorFilter.length > 0 ? JSON.stringify(actorFilter) : undefined,
        filterDirectors: directorFilter.length > 0 ? JSON.stringify(directorFilter) : undefined,
        filterStudios: studioFilter.length > 0 ? JSON.stringify(studioFilter) : undefined,
        filterCollections: collectionFilter.length > 0 ? JSON.stringify(collectionFilter) : undefined,
        filterYearStart: yearFilter ? parseInt(yearFilter) : (yearRangeStart ? parseInt(yearRangeStart) : undefined),
        filterYearEnd: yearFilter ? parseInt(yearFilter) : (yearRangeEnd ? parseInt(yearRangeEnd) : undefined),
        filterRating: ratingFilter || undefined,
        filterType: 'movies',
        // Include reorder settings from existing channel data
        defaultEpisodeOrder: existingChannelData?.defaultEpisodeOrder || "sequential",
        respectEpisodeOrder: existingChannelData?.respectEpisodeOrder ?? true,
        blockShuffle: existingChannelData?.blockShuffle || false,
        blockShuffleSize: existingChannelData?.blockShuffleSize || 1,
        autoSortMethod: existingChannelData?.autoSortMethod || undefined
      };
      onSaveAutomation(filters);
    }
    
    setSelectedMovies(new Set());
  };

  // Episode/Season management
  const toggleShowExpansion = (showId: string) => {
    const newExpanded = new Set(expandedShows);
    if (newExpanded.has(showId)) {
      newExpanded.delete(showId);
    } else {
      newExpanded.add(showId);
    }
    setExpandedShows(newExpanded);
  };

  const toggleSeasonSelection = (showId: string, seasonNumber: number) => {
    const showSeasons = selectedSeasons[showId] || new Set();
    const newSeasons = new Set(showSeasons);
    
    if (newSeasons.has(seasonNumber)) {
      newSeasons.delete(seasonNumber);
      // Also remove all episodes from this season
      const showEpisodes = selectedEpisodes[showId] || new Set();
      const newEpisodes = new Set(showEpisodes);
      
      // Find episodes in this season and remove them
      const show = filteredShows.find((s: any) => s.id === showId);
      if (show) {
        const seasonEpisodes = (show as any).episodes?.filter((ep: any) => ep.seasonNumber === seasonNumber) || [];
        seasonEpisodes.forEach((ep: any) => newEpisodes.delete(ep.id));
        
        setSelectedEpisodes(prev => ({
          ...prev,
          [showId]: newEpisodes
        }));
      }
    } else {
      newSeasons.add(seasonNumber);
      // Auto-select all episodes in this season
      const showEpisodes = selectedEpisodes[showId] || new Set();
      const newEpisodes = new Set(showEpisodes);
      
      const show = filteredShows.find((s: any) => s.id === showId);
      if (show) {
        const seasonEpisodes = (show as any).episodes?.filter((ep: any) => ep.seasonNumber === seasonNumber) || [];
        seasonEpisodes.forEach((ep: any) => newEpisodes.add(ep.id));
        
        setSelectedEpisodes(prev => ({
          ...prev,
          [showId]: newEpisodes
        }));
      }
    }
    
    setSelectedSeasons(prev => ({
      ...prev,
      [showId]: newSeasons
    }));
  };

  const toggleEpisodeSelection = (showId: string, episodeId: string) => {
    const showEpisodes = selectedEpisodes[showId] || new Set();
    const newEpisodes = new Set(showEpisodes);
    
    if (newEpisodes.has(episodeId)) {
      newEpisodes.delete(episodeId);
      
      // Check if this episode's season should be deselected
      const show = filteredShows.find((s: any) => s.id === showId);
      if (show) {
        const episode = (show as any).episodes?.find((ep: any) => ep.id === episodeId);
        if (episode) {
          const seasonEpisodes = (show as any).episodes?.filter((ep: any) => ep.seasonNumber === episode.seasonNumber) || [];
          const remainingSeasonEpisodes = seasonEpisodes.filter((ep: any) => 
            ep.id !== episodeId && newEpisodes.has(ep.id)
          );
          
          // If no episodes remain selected in this season, deselect the season
          if (remainingSeasonEpisodes.length === 0) {
            const showSeasons = selectedSeasons[showId] || new Set();
            const newSeasons = new Set(showSeasons);
            newSeasons.delete(episode.seasonNumber);
            
            setSelectedSeasons(prev => ({
              ...prev,
              [showId]: newSeasons
            }));
          }
        }
      }
    } else {
      newEpisodes.add(episodeId);
      
      // Check if all episodes in this season are now selected
      const show = filteredShows.find((s: any) => s.id === showId);
      if (show) {
        const episode = (show as any).episodes?.find((ep: any) => ep.id === episodeId);
        if (episode) {
          const seasonEpisodes = (show as any).episodes?.filter((ep: any) => ep.seasonNumber === episode.seasonNumber) || [];
          const selectedSeasonEpisodes = seasonEpisodes.filter((ep: any) => 
            ep.id === episodeId || newEpisodes.has(ep.id)
          );
          
          // If all episodes in season are selected, select the season
          if (selectedSeasonEpisodes.length === seasonEpisodes.length) {
            const showSeasons = selectedSeasons[showId] || new Set();
            const newSeasons = new Set(showSeasons);
            newSeasons.add(episode.seasonNumber);
            
            setSelectedSeasons(prev => ({
              ...prev,
              [showId]: newSeasons
            }));
          }
        }
      }
    }
    
    setSelectedEpisodes(prev => ({
      ...prev,
      [showId]: newEpisodes
    }));
  };

  const selectAllSeasonsForShow = (showId: string, seasons: any[]) => {
    const allSeasonNumbers = seasons.map(s => s.seasonNumber);
    setSelectedSeasons(prev => ({
      ...prev,
      [showId]: new Set(allSeasonNumbers)
    }));
  };

  const getShowSeasons = (show: any) => {
    const seasonMap = new Map();
    ((show as any).episodes || []).forEach((episode: any) => {
      if (!seasonMap.has(episode.seasonNumber)) {
        seasonMap.set(episode.seasonNumber, []);
      }
      seasonMap.get(episode.seasonNumber).push(episode);
    });
    
    return Array.from(seasonMap.entries())
      .map(([seasonNumber, episodes]) => ({
        seasonNumber,
        episodes: episodes.sort((a: any, b: any) => a.episodeNumber - b.episodeNumber)
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
  };

  const toggleShowSelection = (showId: string) => {
    const newSelected = new Set(selectedShows);
    if (newSelected.has(showId)) {
      newSelected.delete(showId);
    } else {
      newSelected.add(showId);
    }
    setSelectedShows(newSelected);
  };

  const toggleMovieSelection = (movieId: string) => {
    const newSelected = new Set(selectedMovies);
    if (newSelected.has(movieId)) {
      newSelected.delete(movieId);
    } else {
      newSelected.add(movieId);
    }
    setSelectedMovies(newSelected);
  };

  const selectAllShows = () => {
    setSelectedShows(new Set(filteredShows.map((show: any) => show.id)));
  };

  const selectAllMovies = () => {
    setSelectedMovies(new Set(filteredMovies.map((movie: any) => movie.id)));
  };

  const clearSelection = () => {
    setSelectedShows(new Set());
    setSelectedMovies(new Set());
    setSelectedEpisodes({});
    setSelectedSeasons({});
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setYearFilter("");
    setYearRangeStart("");
    setYearRangeEnd("");
    setGenreFilter([]);
    setActorFilter([]);
    setDirectorFilter([]);
    setStudioFilter([]);
    setCollectionFilter([]);
    setRatingFilter("");
    setAutoFilterEnabled(false);
    setSmartFilteringEnabled(false);
  };

  const handleClose = () => {
    clearAllFilters();
    clearSelection();
    setExpandedShows(new Set());
    setShowFilters(false);
    onClose();
  };

  // NEW: Collections state
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [addingCollections, setAddingCollections] = useState(false);
  const queryClient = useQueryClient();
  const collectionsQuery = useQuery(orpc.library.collections.queryOptions({ input: { limit: 200 } }));
  const filteredCollections = (collectionsQuery.data || []) as { name: string; count: number }[];

  const toggleCollectionSelection = (name: string) => {
    const newSelected = new Set(selectedCollections);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedCollections(newSelected);
  };

  const selectAllCollections = () => {
    setSelectedCollections(new Set(filteredCollections.map((col) => col.name)));
  };

  const clearCollectionSelection = () => {
    setSelectedCollections(new Set());
  };

  // Helper: get all show/movie IDs already in the channel
  const existingShowIds = new Set(existingShows.map((s: any) => s.showId || s.id));
  const existingMovieIds = new Set(existingMovies.map((m: any) => m.movieId || m.id));

  // Add all content from selected collections
  const handleBulkAddCollections = async () => {
    if (selectedCollections.size === 0) return;
    setAddingCollections(true);
    try {
      // For each collection, fetch all movies and shows in parallel using fetchQuery
      const collectionNames = Array.from(selectedCollections);
      const [allShows, allMovies] = await Promise.all([
        Promise.all(collectionNames.map(name =>
          queryClient.fetchQuery(orpc.library.shows.queryOptions({ input: { collection: name, limit: 200 } }))
        )),
        Promise.all(collectionNames.map(name =>
          queryClient.fetchQuery(orpc.library.movies.queryOptions({ input: { collection: name, limit: 200 } }))
        )),
      ]);
      // Flatten results
      const shows = allShows.flat();
      const movies = allMovies.flat();
      // Add each show/movie if not already in channel
      shows.forEach((show: any) => {
        if (!existingShowIds.has(show.id)) {
          onAddShows(show.id);
          existingShowIds.add(show.id);
        }
      });
      movies.forEach((movie: any) => {
        if (!existingMovieIds.has(movie.id)) {
          onAddMovies(movie.id);
          existingMovieIds.add(movie.id);
        }
      });
    } finally {
      setAddingCollections(false);
      setSelectedCollections(new Set());
    }
  };

  if (!isOpen) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleClose();
          }
        }}
      >
      <Card className="w-full max-w-6xl max-h-[90vh] overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Add Content to Channel</CardTitle>
              <CardDescription>Search and select content to add to your channel</CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  <X className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Close</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
                     {/* Search and Filters */}
           <div className="space-y-4 pt-4">
             <div className="flex items-center gap-4">
               <div className="relative flex-1">
                 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                 <Input
                   placeholder="Search titles, summaries..."
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-10"
                 />
               </div>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button 
                     variant="outline"
                     onClick={() => setShowFilters(!showFilters)}
                     className="flex items-center gap-2"
                   >
                     <Filter className="w-4 h-4 md:mr-1" />
                     <span className="hidden md:inline">Advanced Filters</span>
                     {showFilters ? <ChevronDown className="w-4 h-4 md:ml-1" /> : <ChevronRight className="w-4 h-4 md:ml-1" />}
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent>
                   <p>Advanced Filters</p>
                 </TooltipContent>
               </Tooltip>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button 
                     variant="outline" 
                     onClick={clearSelection}
                     disabled={selectedShows.size === 0 && selectedMovies.size === 0}
                   >
                     <span className="hidden md:inline">Clear Selection</span>
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent>
                   <p>Clear Selection</p>
                 </TooltipContent>
               </Tooltip>
             </div>

             {/* Channel Automation Section */}
             <div className="bg-muted/30 p-3 rounded-lg border">
               <div className="flex items-start gap-3">
                 <div className="flex items-center space-x-2">
                   <Checkbox 
                     id="automation-enabled" 
                     checked={autoFilterEnabled}
                     onCheckedChange={(checked) => setAutoFilterEnabled(checked === true)}
                   />
                   <Label htmlFor="automation-enabled" className="text-sm font-medium flex items-center gap-1">
                     <Zap className="w-4 h-4 text-blue-600" />
                     Enable Channel Automation
                   </Label>
                 </div>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Info className="w-4 h-4 text-muted-foreground cursor-help mt-0.5" />
                   </TooltipTrigger>
                   <TooltipContent side="top" className="max-w-md">
                     <div className="space-y-2">
                       <p className="font-medium">How Automation Works:</p>
                       <p>• <strong>Auto-Update Shows:</strong> Entire shows will automatically get new episodes when they're added to your library</p>
                       <p>• <strong>Find Similar Content:</strong> Finds franchise content and similar shows (e.g., "Young Sheldon" for "Big Bang Theory")</p>
                       <p>• <strong>Filter Matching:</strong> Adds content matching your genre, actor, studio, and year criteria</p>
                       <p>• <strong>Ongoing Sync:</strong> Automatically adds matching content when new media is synced to your library</p>
                       <p className="text-yellow-600 font-medium">Note: Selected episodes/seasons will NOT auto-update</p>
                     </div>
                   </TooltipContent>
                 </Tooltip>
               </div>
               {autoFilterEnabled && (
                 <div className="mt-3 space-y-3">
                   <div className="text-xs text-muted-foreground space-y-1">
                     <p className="flex items-center gap-1">
                       <Info className="w-3 h-3" />
                       <strong>Shows added as "entire show" will automatically get new episodes</strong>
                     </p>
                     {selectedShows.size > 0 || selectedMovies.size > 0 ? (
                       <p className="flex items-center gap-1">
                         <Info className="w-3 h-3" />
                         Will also find franchise content and similar shows/movies based on your selections
                       </p>
                     ) : (
                       <p className="flex items-center gap-1">
                         <Info className="w-3 h-3" />
                         Will use your Advanced Filters to find matching content
                       </p>
                     )}
                   </div>

                 </div>
               )}
             </div>

             {/* Advanced Filters Panel */}
             {showFilters && (
               <div className="bg-muted/50 p-4 rounded-lg space-y-4">
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       <Calendar className="w-3 h-3" />
                       Year
                     </Label>
                     <Input
                       placeholder="e.g. 2023"
                       value={yearFilter}
                       onChange={(e) => setYearFilter(e.target.value)}
                       className="h-8"
                     />
                   </div>
                   <div className="space-y-2">
                     <Label className="text-xs font-medium">Year Range</Label>
                     <div className="flex gap-1">
                       <Input
                         placeholder="From"
                         value={yearRangeStart}
                         onChange={(e) => setYearRangeStart(e.target.value)}
                         className="h-8"
                       />
                       <Input
                         placeholder="To"
                         value={yearRangeEnd}
                         onChange={(e) => setYearRangeEnd(e.target.value)}
                         className="h-8"
                       />
                     </div>
                   </div>
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       <Tag className="w-3 h-3" />
                       Genre
                       {smartFilteringEnabled && (
                         <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                           Smart
                         </Badge>
                       )}
                     </Label>
                     <MultiSelect
                       placeholder="e.g. Comedy, Action"
                       value={genreFilter}
                       onValueChange={setGenreFilter}
                       options={getContextualOptions('genres')}
                       loading={genresQuery.isLoading}
                       onSearch={setGenreSearch}
                       className="h-8"
                       maxItems={10}
                       showCounter={false}
                     />
                   </div>
                                        <div className="space-y-2">
                       <Label className="text-xs font-medium flex items-center gap-1">
                         Rating
                         {smartFilteringEnabled && (
                           <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                             Smart
                           </Badge>
                         )}
                       </Label>
                       <Select value={ratingFilter || "any"} onValueChange={(value) => setRatingFilter(value === "any" ? "" : value)}>
                         <SelectTrigger className="h-8">
                           <SelectValue placeholder="Any" />
                         </SelectTrigger>
                         <SelectContent>
                           <SelectItem value="any">Any</SelectItem>
                           {getContextualOptions('ratings').map((rating) => (
                             <SelectItem key={rating} value={rating}>
                               {rating}
                             </SelectItem>
                           ))}
                         </SelectContent>
                       </Select>
                     </div>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       <User className="w-3 h-3" />
                       Actor
                       {smartFilteringEnabled && (
                         <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                           Smart
                         </Badge>
                       )}
                     </Label>
                     <MultiSelect
                       placeholder="e.g. Tom Hanks, Adam Sandler"
                       value={actorFilter}
                       onValueChange={setActorFilter}
                       options={getContextualOptions('actors')}
                       loading={actorsQuery.isLoading}
                       onSearch={setActorSearch}
                       className="h-8"
                       maxItems={5}
                       showCounter={false}
                     />
                   </div>
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       Director
                       {smartFilteringEnabled && (
                         <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                           Smart
                         </Badge>
                       )}
                     </Label>
                     <MultiSelect
                       placeholder="e.g. Spielberg, Nolan"
                       value={directorFilter}
                       onValueChange={setDirectorFilter}
                       options={getContextualOptions('directors')}
                       loading={directorsQuery.isLoading}
                       onSearch={setDirectorSearch}
                       className="h-8"
                       maxItems={5}
                       showCounter={false}
                     />
                   </div>
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       Studio
                       {smartFilteringEnabled && (
                         <Badge variant="secondary" className="text-xs px-1 py-0 h-4">
                           Smart
                         </Badge>
                       )}
                     </Label>
                     <MultiSelect
                       placeholder="e.g. Disney, Warner Bros"
                       value={studioFilter}
                       onValueChange={setStudioFilter}
                       options={getContextualOptions('studios')}
                       loading={studiosQuery.isLoading}
                       onSearch={setStudioSearch}
                       className="h-8"
                       maxItems={5}
                       showCounter={false}
                     />
                   </div>
                 </div>
                 <div className="grid grid-cols-1 gap-3">
                   <div className="space-y-2">
                     <Label className="text-xs font-medium flex items-center gap-1">
                       <Folder className="w-3 h-3" />
                       Collections
                     </Label>
                     <MultiSelect
                       placeholder="e.g. Marvel, DC Universe"
                       value={collectionFilter}
                       onValueChange={setCollectionFilter}
                       options={collectionsQuery.data?.map((c: any) => c.name) || []}
                       loading={collectionsQuery.isLoading}
                       className="h-8"
                       maxItems={5}
                       showCounter={false}
                     />
                   </div>
                 </div>
                 <div className="flex items-center justify-between mt-4">
                   <div className="flex items-center space-x-2">
                     <Checkbox 
                       id="smart-filtering" 
                       checked={smartFilteringEnabled}
                       onCheckedChange={(checked) => setSmartFilteringEnabled(checked === true)}
                     />
                     <Label htmlFor="smart-filtering" className="text-sm font-medium flex items-center gap-1">
                       <Filter className="w-3 h-3" />
                       Smart Filtering
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                         </TooltipTrigger>
                         <TooltipContent side="top" className="max-w-xs">
                           <p>When enabled, filter options adapt based on your current selections to show only realistic combinations that exist in your library.</p>
                         </TooltipContent>
                       </Tooltip>
                     </Label>
                   </div>
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <Button variant="outline" size="sm" onClick={clearAllFilters}>
                         <span className="hidden md:inline">Clear All Filters</span>
                       </Button>
                     </TooltipTrigger>
                     <TooltipContent>
                       <p>Clear All Filters</p>
                     </TooltipContent>
                   </Tooltip>
                 </div>
               </div>
             )}
           </div>
        </CardHeader>

        <CardContent className="p-0 h-full">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <div className="border-b px-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="shows" className="flex items-center gap-2">
                  <Video className="w-4 h-4" />
                  TV Shows ({filteredShows.length})
                  {selectedShows.size > 0 && (
                    <Badge variant="secondary">{selectedShows.size} selected</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="movies" className="flex items-center gap-2">
                  <Film className="w-4 h-4" />
                  Movies ({filteredMovies.length})
                  {selectedMovies.size > 0 && (
                    <Badge variant="secondary">{selectedMovies.size} selected</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="collections" className="flex items-center gap-2">
                  <Folder className="w-4 h-4" />
                  Collections ({filteredCollections.length})
                  {selectedCollections.size > 0 && (
                    <Badge variant="secondary">{selectedCollections.size} selected</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="shows" className="p-6 space-y-4 h-[500px] overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={selectAllShows}
                        disabled={filteredShows.length === 0}
                      >
                        <span className="hidden md:inline">Select All ({filteredShows.length})</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Select All ({filteredShows.length})</p>
                    </TooltipContent>
                  </Tooltip>
                  {selectedShows.size > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleBulkAddShows}>
                          <span className="hidden md:inline">Add {selectedShows.size} Show{selectedShows.size > 1 ? 's' : ''}</span>
                          {autoFilterEnabled && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-4 h-4 md:ml-2 text-blue-400" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm">
                                <p>✨ <strong>Auto-Update Enabled:</strong> These shows will automatically get new episodes when synced</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add {selectedShows.size} Show{selectedShows.size > 1 ? 's' : ''}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

                             <div className="overflow-y-auto h-full space-y-2">
                 {filteredShows.map((show: any) => {
                   const seasons = getShowSeasons(show);
                   const isExpanded = expandedShows.has(show.id);
                   const selectedShowSeasons = selectedSeasons[show.id] || new Set();
                   const selectedShowEpisodes = selectedEpisodes[show.id] || new Set();
                   
                   return (
                     <div key={show.id} className="border rounded-lg overflow-hidden">
                       {/* Show Header */}
                       <div
                         className={`flex items-center gap-3 p-3 transition-colors ${
                           selectedShows.has(show.id) ? 'bg-accent border-primary' : 'hover:bg-muted'
                         }`}
                       >
                         <Checkbox
                           checked={selectedShows.has(show.id)}
                           onCheckedChange={() => toggleShowSelection(show.id)}
                         />
                         <img 
                           src={show.poster || "/placeholder.png"} 
                           alt={show.title}
                           className="w-8 h-12 object-cover rounded"
                         />
                         <div className="flex-1 min-w-0">
                           <h4 className="font-medium truncate">{show.title}</h4>
                           <div className="flex items-center gap-2">
                             <p className="text-sm text-muted-foreground">
                               {show.year} • {seasons.length} seasons • {(show as any).episodes?.length || 0} episodes
                             </p>
                             {(selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) && (
                               <Badge variant="secondary" className="text-xs">
                                 {selectedShowSeasons.size}S, {selectedShowEpisodes.size}E selected
                               </Badge>
                             )}
                           </div>
                         </div>
                         <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => toggleShowExpansion(show.id)}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4 md:mr-1" /> : <ChevronRight className="w-4 h-4 md:mr-1" />}
                                <span className="hidden md:inline">Episodes</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Episodes</p>
                            </TooltipContent>
                          </Tooltip>
                         </div>
                       </div>

                       {/* Episode Selection */}
                       {isExpanded && (
                         <div className="border-t bg-muted/20 p-3 space-y-3">
                           <div className="flex items-center justify-between">
                             <h5 className="font-medium text-sm">Select Seasons/Episodes</h5>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => selectAllSeasonsForShow(show.id, seasons)}
                                >
                                  <span className="hidden md:inline">Select All Seasons</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Select All Seasons</p>
                              </TooltipContent>
                            </Tooltip>
                           </div>
                           
                                                            <div className="space-y-2 max-h-64 overflow-y-auto">
                             {seasons.map((season) => {
                               const seasonEpisodeIds = season.episodes.map((ep: any) => ep.id);
                               const selectedSeasonEpisodeCount = seasonEpisodeIds.filter((id: string) => 
                                 selectedShowEpisodes.has(id)
                               ).length;
                               const isSeasonFullySelected = selectedSeasonEpisodeCount === season.episodes.length;
                               const isSeasonPartiallySelected = selectedSeasonEpisodeCount > 0 && selectedSeasonEpisodeCount < season.episodes.length;
                               
                               return (
                                 <div key={season.seasonNumber} className="border rounded p-2 bg-background">
                                   <div className="flex items-center justify-between mb-2">
                                     <div className="flex items-center gap-2">
                                       <Checkbox
                                         checked={selectedShowSeasons.has(season.seasonNumber)}
                                         // @ts-ignore - indeterminate is a valid prop but not in types
                                         indeterminate={isSeasonPartiallySelected}
                                         onCheckedChange={() => toggleSeasonSelection(show.id, season.seasonNumber)}
                                       />
                                       <span className="font-medium text-sm">
                                         Season {season.seasonNumber} ({season.episodes.length} episodes)
                                         {isSeasonPartiallySelected && (
                                           <span className="text-muted-foreground ml-1">
                                             ({selectedSeasonEpisodeCount} selected)
                                           </span>
                                         )}
                                       </span>
                                     </div>
                                   </div>
                                 
                                 {selectedShowSeasons.has(season.seasonNumber) && (
                                   <div className="ml-6 space-y-1 max-h-32 overflow-y-auto">
                                     {season.episodes.map((episode: any) => (
                                       <div key={episode.id} className="flex items-center gap-2 text-sm">
                                         <Checkbox
                                           checked={selectedShowEpisodes.has(episode.id)}
                                           onCheckedChange={() => toggleEpisodeSelection(show.id, episode.id)}
                                         />
                                         <span className="truncate">
                                           {episode.episodeNumber}. {episode.title}
                                         </span>
                                         <span className="text-muted-foreground text-xs ml-auto">
                                           {Math.floor(episode.duration / 60000)}m
                                         </span>
                                       </div>
                                     ))}
                                   </div>
                                 )}
                               </div>
                                 );
                               })}
                           </div>
                           
                           {(selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) && (
                             <div className="flex justify-end pt-2 border-t">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    size="sm"
                                    onClick={() => {
                                      // Selected episodes/seasons never auto-update
                                      onAddShows(show.id, {
                                        seasons: Array.from(selectedShowSeasons),
                                        episodes: Array.from(selectedShowEpisodes)
                                      }, false);
                                      // Clear selections for this show
                                      setSelectedSeasons(prev => {
                                        const updated = { ...prev };
                                        delete updated[show.id];
                                        return updated;
                                      });
                                      setSelectedEpisodes(prev => {
                                        const updated = { ...prev };
                                        delete updated[show.id];
                                        return updated;
                                      });
                                    }}
                                  >
                                    <span className="hidden md:inline">Add Selected ({selectedShowSeasons.size} seasons, {selectedShowEpisodes.size} episodes)</span>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-4 h-4 md:ml-2 text-muted-foreground" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-sm">
                                        <p><strong>Note:</strong> Selected episodes/seasons will NOT auto-update with new content</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Add Selected ({selectedShowSeasons.size} seasons, {selectedShowEpisodes.size} episodes)</p>
                                </TooltipContent>
                              </Tooltip>
                              </div>
                           )}
                         </div>
                       )}
                     </div>
                   );
                 })}
                {filteredShows.length === 0 && (
                  <div className="text-center py-12">
                    <Video className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No shows found</h3>
                    <p className="text-muted-foreground">
                      {searchTerm ? "Try adjusting your search terms" : "No shows available to add"}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="movies" className="p-6 space-y-4 h-[500px] overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={selectAllMovies}
                        disabled={filteredMovies.length === 0}
                      >
                        <span className="hidden md:inline">Select All ({filteredMovies.length})</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Select All ({filteredMovies.length})</p>
                    </TooltipContent>
                  </Tooltip>
                  {selectedMovies.size > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleBulkAddMovies}>
                          <span className="hidden md:inline">Add {selectedMovies.size} Movies</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add {selectedMovies.size} Movies</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              <div className="overflow-y-auto h-full space-y-2">
                {filteredMovies.map((movie: any) => (
                  <div
                    key={movie.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      selectedMovies.has(movie.id) ? 'bg-accent border-primary' : 'hover:bg-muted'
                    }`}
                  >
                    <Checkbox
                      checked={selectedMovies.has(movie.id)}
                      onCheckedChange={() => toggleMovieSelection(movie.id)}
                    />
                    <img 
                      src={movie.poster || "/placeholder.png"} 
                      alt={movie.title}
                      className="w-8 h-12 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{movie.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {movie.year} • {Math.floor(movie.duration / 60000)} min
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onAddMovies(movie.id);
                            toggleMovieSelection(movie.id);
                          }}
                        >
                          <span className="hidden md:inline">Add</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
                {filteredMovies.length === 0 && (
                  <div className="text-center py-12">
                    <Film className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No movies found</h3>
                    <p className="text-muted-foreground">
                      {searchTerm ? "Try adjusting your search terms" : "No movies available to add"}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="collections" className="p-6 space-y-4 h-[500px] overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={selectAllCollections}
                        disabled={filteredCollections.length === 0 || addingCollections}
                      >
                        <span className="hidden md:inline">Select All ({filteredCollections.length})</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Select All ({filteredCollections.length})</p>
                    </TooltipContent>
                  </Tooltip>
                  {selectedCollections.size > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleBulkAddCollections} disabled={addingCollections}>
                          {addingCollections ? (
                            <span className="hidden md:inline">Adding...</span>
                          ) : (
                            <span className="hidden md:inline">Add {selectedCollections.size} Collections</span>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{addingCollections ? "Adding..." : `Add ${selectedCollections.size} Collections`}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className="overflow-y-auto h-full space-y-2">
                {filteredCollections.map((col) => (
                  <div
                    key={col.name}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      selectedCollections.has(col.name) ? 'bg-accent border-primary' : 'hover:bg-muted'
                    }`}
                  >
                    <Checkbox
                      checked={selectedCollections.has(col.name)}
                      onCheckedChange={() => toggleCollectionSelection(col.name)}
                      disabled={addingCollections}
                    />
                    <Folder className="w-8 h-8 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{col.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {col.count} items
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleCollectionSelection(col.name)}
                          disabled={addingCollections}
                        >
                          <span className="hidden md:inline">Add</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
                {filteredCollections.length === 0 && (
                  <div className="text-center py-12">
                    <Folder className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No collections found</h3>
                    <p className="text-muted-foreground">
                      {searchTerm ? "Try adjusting your search terms" : "No collections available to add"}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>


        </CardContent>

        <div className="border-t p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedShows.size + selectedMovies.size > 0 && (
                <span>{selectedShows.size + selectedMovies.size} items selected</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={handleClose}>
                    <span className="hidden md:inline">Cancel</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Cancel</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => {
                      handleBulkAddShows();
                      handleBulkAddMovies();
                      handleBulkAddCollections();
                      handleClose();
                    }}
                    disabled={selectedShows.size === 0 && selectedMovies.size === 0}
                  >
                    <span className="hidden md:inline">Add Selected ({selectedShows.size + selectedMovies.size + selectedCollections.size})</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add Selected ({selectedShows.size + selectedMovies.size + selectedCollections.size})</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </Card>
    </div>
    </TooltipProvider>
  );
}

function ChannelsPageContent() {
  const router = useRouter();
  const { channelIdFromUrl, updateChannelInUrl } = useChannelSelectionUrl();
  
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channelIdFromUrl);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState({
    number: 1,
    name: "",
    icon: "",
    groupTitle: "",
    catchupEnabled: true,
    catchupWindowHours: 24,
  });
  const [editChannel, setEditChannel] = useState({
    id: "",
    number: 1,
    name: "",
    icon: "",
    groupTitle: "",
    catchupEnabled: true,
    catchupWindowHours: 24,
  });
  
  // Programming Rules state
  const [defaultEpisodeOrder, setDefaultEpisodeOrder] = useState("sequential");
  const [respectEpisodeOrder, setRespectEpisodeOrder] = useState(true);
  const [blockShuffle, setBlockShuffle] = useState(false);

  const queryClient = useQueryClient();
  const channelsQuery = useQuery(orpc.channels.listSummary.queryOptions());

  const prefetchChannel = useCallback(
    (channelId: string) => {
      void prefetchChannelLineup(queryClient, channelId);
    },
    [queryClient],
  );

  // Function to update URL when channel selection changes — from useChannelSelectionUrl

  // Centralized function to invalidate guide queries after program generation
  const invalidateGuideQueries = async (delay: number = 800) => {
    setTimeout(async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.guide.current.queryOptions().queryKey });
      await queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'guide' 
      });
    }, delay);
  };

  // Auto-select channel from URL or first channel when channels load
  useEffect(() => {
    if (channelsQuery.data && channelsQuery.data.length > 0) {
      // If there's a channel ID from URL, try to select it
      if (channelIdFromUrl) {
        const channelExists = channelsQuery.data.some((ch: any) => ch.id === channelIdFromUrl);
        if (channelExists) {
          setSelectedChannelId(channelIdFromUrl);
          return;
        }
      }
      
      // Otherwise, select the first channel if none is selected
      if (!selectedChannelId) {
        const firstChannelId = channelsQuery.data[0].id;
        setSelectedChannelId(firstChannelId);
        updateChannelInUrl(firstChannelId);
      }
    }
  }, [channelsQuery.data, channelIdFromUrl, selectedChannelId]);

  // Get selected channel lineup (slim, single RPC)
  const lineupQuery = useQuery({
    ...channelLineupQueryOptions(selectedChannelId!),
    enabled: !!selectedChannelId,
    placeholderData: keepPreviousData,
  });

  const selectedSummary = useMemo(
    () =>
      (channelsQuery.data as ChannelSummary[] | undefined)?.find(
        (ch) => ch.id === selectedChannelId,
      ),
    [channelsQuery.data, selectedChannelId],
  );

  const lineup = lineupQuery.data as ChannelLineup | null | undefined;
  const lineupItems = useMemo(() => buildLineupItems(lineup), [lineup]);
  const lineupReady = lineup?.id === selectedChannelId;

  // Load programming rules when channel changes
  useEffect(() => {
    if (selectedChannelId && lineupReady && lineup) {
      setDefaultEpisodeOrder(lineup.defaultEpisodeOrder || "sequential");
      setRespectEpisodeOrder(lineup.respectEpisodeOrder ?? true);
      setBlockShuffle(lineup.blockShuffle || false);
    }
  }, [selectedChannelId, lineupReady, lineup]);

  // Get existing group titles for dropdown
  const existingGroups = useMemo(() => {
    if (!channelsQuery.data) return [];
    
    const groups = new Set<string>();
    (channelsQuery.data as any[]).forEach((channel: any) => {
      if (channel.groupTitle && channel.groupTitle.trim()) {
        groups.add(channel.groupTitle.trim());
      }
    });
    
    return Array.from(groups).sort();
  }, [channelsQuery.data]);

  const createChannelMutation = useMutation(orpc.channels.create.mutationOptions({
    onSuccess: (data) => {
      // Invalidate and refetch to get the real data from server
      const queryKey = orpc.channels.listSummary.queryOptions().queryKey;
      queryClient.invalidateQueries({ queryKey });
      
      // Clear the form and select the new channel
      const nextChannelNumber = channelsQuery.data ? Math.max(...(channelsQuery.data as any[]).map((ch: any) => ch.number)) + 1 : 1;
      setNewChannel({ number: nextChannelNumber, name: "", icon: "", groupTitle: "", catchupEnabled: true, catchupWindowHours: 24 });
      setSelectedChannelId(data.id);
      updateChannelInUrl(data.id);
      setShowCreateForm(false);
      
      toast.success(`Channel "${data.name}" created successfully!`);
    },
    onError: (error) => {
      toast.error("Failed to create channel");
    }
  }));

  const updateChannelMutation = useMutation(orpc.channels.update.mutationOptions({
    onMutate: async (variables) => {
      const channelsQueryKey = orpc.channels.listSummary.queryOptions().queryKey;
      const lineupQueryKey = orpc.channels.getLineup.queryOptions({
        input: { id: variables.id },
      }).queryKey;
      const selectedChannelQueryKey = orpc.channels.get.queryOptions({ 
        input: { id: variables.id } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelsQueryKey });
      await queryClient.cancelQueries({ queryKey: lineupQueryKey });
      await queryClient.cancelQueries({ queryKey: selectedChannelQueryKey });
      
      const previousChannels = queryClient.getQueryData(channelsQueryKey);
      const previousLineup = queryClient.getQueryData(lineupQueryKey);
      const previousSelectedChannel = queryClient.getQueryData(selectedChannelQueryKey);
      
      // Optimistically update channels list
      queryClient.setQueryData(channelsQueryKey, (old: any) => {
        return old?.map((channel: any) => 
          channel.id === variables.id 
            ? { ...channel, ...variables }
            : channel
        );
      });

      // Optimistically update selected channel
      queryClient.setQueryData(lineupQueryKey, (old: any) => {
        return old ? { ...old, ...variables } : old;
      });

      queryClient.setQueryData(selectedChannelQueryKey, (old: any) => {
        return old ? { ...old, ...variables } : old;
      });
      
      return { previousChannels, previousLineup, previousSelectedChannel, channelsQueryKey, lineupQueryKey, selectedChannelQueryKey };
    },
    onError: (err, variables, context) => {
      toast.error("Failed to update channel");
      // Rollback on error
      if (context?.previousChannels && context?.channelsQueryKey) {
        queryClient.setQueryData(context.channelsQueryKey, context.previousChannels);
      }
      if (context?.previousLineup && context?.lineupQueryKey) {
        queryClient.setQueryData(context.lineupQueryKey, context.previousLineup);
      }
      if (context?.previousSelectedChannel && context?.selectedChannelQueryKey) {
        queryClient.setQueryData(context.selectedChannelQueryKey, context.previousSelectedChannel);
      }
    },
    onSuccess: (data) => {
      // Invalidate and refetch to get the real data from server
      const queryKey = orpc.channels.listSummary.queryOptions().queryKey;
      queryClient.invalidateQueries({ queryKey });
      
      // Also invalidate the selected channel query
      if (selectedChannelId) {
        void invalidateChannelDetail(queryClient, selectedChannelId);
      }
      
      // Clear the edit form
      setEditingChannelId(null);
      
      toast.success(`Channel "${data.name}" updated successfully!`);
    }
  }));

  const deleteChannelMutation = useMutation(orpc.channels.delete.mutationOptions({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches - use the same key pattern as orpc query
      const queryKey = orpc.channels.listSummary.queryOptions().queryKey;
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousChannels = queryClient.getQueryData(queryKey);
      
      // Optimistically remove the channel
      queryClient.setQueryData(queryKey, (old: any) => 
        old ? old.filter((channel: any) => channel.id !== variables.id) : []
      );
      
      return { previousChannels, queryKey };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousChannels && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousChannels);
      }
    },
    onSuccess: () => {
      const queryKey = orpc.channels.listSummary.queryOptions().queryKey;
      queryClient.invalidateQueries({ queryKey });
      if (selectedChannelId) {
        setSelectedChannelId(null);
        // Clear channel from URL when deleted
        router.replace('/channels', { scroll: false });
      }
    }
  }));

  const addShowMutation = useMutation(orpc.channels.addShow.mutationOptions({
    onMutate: async (variables) => {
      toast.loading("Adding show and generating programs...", { id: `add-show-${variables.showId}` });
    },
    onSuccess: async (data, variables) => {
      toast.success("Show added! Programming schedule updated.", { id: `add-show-${variables.showId}` });
      
      // Invalidate queries to get fresh data from server
      // Use more specific invalidation to ensure guide updates
      await queryClient.invalidateQueries({ queryKey: orpc.channels.listSummary.queryOptions().queryKey });
      
      if (selectedChannelId) {
        await invalidateChannelDetail(queryClient, selectedChannelId);
      }
      
      // Invalidate all guide-related queries with a small delay to ensure backend program generation completes
      invalidateGuideQueries(800);
    },
    onError: (error, variables) => {
      toast.error("Failed to add show", { id: `add-show-${variables.showId}` });
    }
  }));

  const addMovieMutation = useMutation(orpc.channels.addMovie.mutationOptions({
    onMutate: async (variables) => {
      toast.loading("Adding movie and generating programs...", { id: `add-movie-${variables.movieId}` });
    },
    onSuccess: async (data, variables) => {
      toast.success("Movie added! Programming schedule updated.", { id: `add-movie-${variables.movieId}` });
      
      // Invalidate queries to get fresh data from server
      // Use more specific invalidation to ensure guide updates
      await queryClient.invalidateQueries({ queryKey: orpc.channels.listSummary.queryOptions().queryKey });
      
      if (selectedChannelId) {
        await invalidateChannelDetail(queryClient, selectedChannelId);
      }
      
      // Invalidate all guide-related queries with a small delay to ensure backend program generation completes
      invalidateGuideQueries(800);
    },
    onError: (error, variables) => {
      toast.error("Failed to add movie", { id: `add-movie-${variables.movieId}` });
    }
  }));

  const removeShowMutation = useMutation(orpc.channels.removeShow.mutationOptions({
    onMutate: async (variables) => {
      const channelsQueryKey = orpc.channels.listSummary.queryOptions().queryKey;
      const selectedChannelQueryKey = orpc.channels.get.queryOptions({ 
        input: { id: variables.channelId } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelsQueryKey });
      await queryClient.cancelQueries({ queryKey: selectedChannelQueryKey });
      
      const previousChannels = queryClient.getQueryData(channelsQueryKey);
      const previousSelectedChannel = queryClient.getQueryData(selectedChannelQueryKey);
      
      // Update channels list cache
      queryClient.setQueryData(channelsQueryKey, (old: any) => {
        return old?.map((channel: any) => {
          if (channel.id === variables.channelId) {
            return {
              ...channel,
              channelShows: channel.channelShows?.filter((cs: any) => cs.showId !== variables.showId) || []
            };
          }
          return channel;
        });
      });

      // Update selected channel detail cache
      queryClient.setQueryData(selectedChannelQueryKey, (old: any) => {
        if (old) {
          return {
            ...old,
            channelShows: old.channelShows?.filter((cs: any) => cs.showId !== variables.showId) || []
          };
        }
        return old;
      });
      
      return { previousChannels, previousSelectedChannel, channelsQueryKey, selectedChannelQueryKey };
    },
    onError: (err, variables, context) => {
      if (context?.previousChannels && context?.channelsQueryKey) {
        queryClient.setQueryData(context.channelsQueryKey, context.previousChannels);
      }
      if (context?.previousSelectedChannel && context?.selectedChannelQueryKey) {
        queryClient.setQueryData(context.selectedChannelQueryKey, context.previousSelectedChannel);
      }
    },
    onSuccess: async () => {
      toast.success("Show removed! Programming schedule updated.");
      await queryClient.invalidateQueries({ queryKey: orpc.channels.listSummary.queryOptions().queryKey });
      if (selectedChannelId) {
        await invalidateChannelDetail(queryClient, selectedChannelId);
        
        // The backend automatically regenerates programs, so invalidate guide with delay
        invalidateGuideQueries(800);
      }
    }
  }));

  const removeMovieMutation = useMutation(orpc.channels.removeMovie.mutationOptions({
    onMutate: async (variables) => {
      const channelsQueryKey = orpc.channels.listSummary.queryOptions().queryKey;
      const selectedChannelQueryKey = orpc.channels.get.queryOptions({ 
        input: { id: variables.channelId } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelsQueryKey });
      await queryClient.cancelQueries({ queryKey: selectedChannelQueryKey });
      
      const previousChannels = queryClient.getQueryData(channelsQueryKey);
      const previousSelectedChannel = queryClient.getQueryData(selectedChannelQueryKey);
      
      // Update channels list cache
      queryClient.setQueryData(channelsQueryKey, (old: any) => {
        return old?.map((channel: any) => {
          if (channel.id === variables.channelId) {
            return {
              ...channel,
              channelMovies: channel.channelMovies?.filter((cm: any) => cm.movieId !== variables.movieId) || []
            };
          }
          return channel;
        });
      });

      // Update selected channel detail cache
      queryClient.setQueryData(selectedChannelQueryKey, (old: any) => {
        if (old) {
          return {
            ...old,
            channelMovies: old.channelMovies?.filter((cm: any) => cm.movieId !== variables.movieId) || []
          };
        }
        return old;
      });
      
      return { previousChannels, previousSelectedChannel, channelsQueryKey, selectedChannelQueryKey };
    },
    onError: (err, variables, context) => {
      if (context?.previousChannels && context?.channelsQueryKey) {
        queryClient.setQueryData(context.channelsQueryKey, context.previousChannels);
      }
      if (context?.previousSelectedChannel && context?.selectedChannelQueryKey) {
        queryClient.setQueryData(context.selectedChannelQueryKey, context.previousSelectedChannel);
      }
    },
    onSuccess: async () => {
      toast.success("Movie removed! Programming schedule updated.");
      await queryClient.invalidateQueries({ queryKey: orpc.channels.listSummary.queryOptions().queryKey });
      if (selectedChannelId) {
        await invalidateChannelDetail(queryClient, selectedChannelId);
        
        // The backend automatically regenerates programs, so invalidate guide with delay
        invalidateGuideQueries(800);
      }
    }
  }));

  const handleCreateChannel = () => {
    if (!newChannel.name) return;
    
    createChannelMutation.mutate({
      number: newChannel.number,
      name: newChannel.name,
      icon: newChannel.icon || undefined,
      groupTitle: newChannel.groupTitle || undefined,
      catchupEnabled: newChannel.catchupEnabled,
      catchupWindowHours: newChannel.catchupWindowHours,
    });
  };

  const handleUpdateChannel = () => {
    if (!editChannel.name || !editChannel.id) return;
    
    updateChannelMutation.mutate({
      id: editChannel.id,
      number: editChannel.number,
      name: editChannel.name,
      icon: editChannel.icon || undefined,
      groupTitle: editChannel.groupTitle || undefined,
      catchupEnabled: editChannel.catchupEnabled,
      catchupWindowHours: editChannel.catchupWindowHours,
    });
  };

  const handleAddShow = (showId: string, selections?: { seasons?: number[], episodes?: string[] }, keepUp?: boolean) => {
    if (!selectedChannelId) return;
    const nextOrder = lineupItems.length;
    
    // For now, we'll add the entire show regardless of selections
    // TODO: Implement backend support for adding specific seasons/episodes
    addShowMutation.mutate({
      channelId: selectedChannelId,
      showId,
      order: nextOrder,
      autoAddNewEpisodes: !!keepUp
    } as any);
  };

  const handleAddMovie = (movieId: string) => {
    if (!selectedChannelId) return;
    const nextOrder = lineupItems.length;
    
    addMovieMutation.mutate({
      channelId: selectedChannelId,
      movieId,
      order: nextOrder
    });
  };

  const handleRemoveShow = (showId: string) => {
    if (!selectedChannelId) return;
    removeShowMutation.mutate({ channelId: selectedChannelId, showId });
  };

  const handleRemoveMovie = (movieId: string) => {
    if (!selectedChannelId) return;
    removeMovieMutation.mutate({ channelId: selectedChannelId, movieId });
  };

  // Channel automation mutation
  const updateFiltersMutation = useMutation(orpc.channels.updateFilters.mutationOptions({
    onSuccess: () => {
      toast.success("Channel automation settings saved!");
    },
    onError: (error) => {
      console.error("Failed to save automation settings:", error);
      toast.error("Failed to save automation settings");
    }
  }));

  const handleSaveAutomation = (filters: any) => {
    if (!selectedChannelId) return;
    updateFiltersMutation.mutate({ 
      id: selectedChannelId, 
      ...filters 
    });
  };

  const getNextChannelNumber = () => {
    if (!channelsQuery.data || channelsQuery.data.length === 0) return 1;
    const maxNumber = Math.max(...(channelsQuery.data as any[]).map((ch: any) => ch.number));
    return maxNumber + 1;
  };

  // Reorder content mutation
  const reorderContentMutation = useMutation(orpc.channels.reorderContent.mutationOptions({
    onMutate: async (variables) => {
      const channelQueryKey = orpc.channels.getLineup.queryOptions({ 
        input: { id: variables.channelId } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelQueryKey });
      const previousData = queryClient.getQueryData(channelQueryKey);
      
      // Optimistically update the local cache
      queryClient.setQueryData(channelQueryKey, (old: any) => {
        if (!old) return old;
        
        // Update the order for all items
        const updatedChannelShows = old.channelShows?.map((cs: any) => {
          const updateItem = variables.items.find(item => item.id === cs.showId && item.type === 'show');
          return updateItem ? { ...cs, order: updateItem.order } : cs;
        }) || [];
        
        const updatedChannelMovies = old.channelMovies?.map((cm: any) => {
          const updateItem = variables.items.find(item => item.id === cm.movieId && item.type === 'movie');
          return updateItem ? { ...cm, order: updateItem.order } : cm;
        }) || [];
        
        return {
          ...old,
          channelShows: updatedChannelShows,
          channelMovies: updatedChannelMovies
        };
      });
      
      return { previousData, channelQueryKey };
    },
    onError: (err, variables, context) => {
      toast.error("Failed to reorder content");
      // Rollback on error
      if (context?.previousData && context?.channelQueryKey) {
        queryClient.setQueryData(context.channelQueryKey, context.previousData);
      }
    },
    onSuccess: async (data) => {
      toast.success(`Reordered ${data.updated} items - programs regenerated!`);
      
      // Refetch to ensure we have the latest data
      await invalidateChannelDetail(queryClient, selectedChannelId!);
             
       // The backend automatically regenerates programs, so invalidate guide with delay
       if (selectedChannelId) {
         invalidateGuideQueries(800);
       }
    }
  }));

  // Reorder episodes mutation
  const reorderEpisodesMutation = useMutation(orpc.channels.reorderEpisodes.mutationOptions({
    onMutate: async (variables) => {
      const channelQueryKey = orpc.channels.getLineup.queryOptions({ 
        input: { id: variables.channelId } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelQueryKey });
      const previousData = queryClient.getQueryData(channelQueryKey);
      
      return { previousData, channelQueryKey };
    },
    onError: (err, variables, context) => {
      toast.error("Failed to reorder episodes");
      // Rollback on error
      if (context?.previousData && context?.channelQueryKey) {
        queryClient.setQueryData(context.channelQueryKey, context.previousData);
      }
    },
    onSuccess: async (data) => {
      toast.success(`Reordered ${data.updated} episodes - programs regenerated!`);
      
      // Refetch to ensure we have the latest data
      await invalidateChannelDetail(queryClient, selectedChannelId!);
             
       // The backend automatically regenerates programs, so invalidate guide with delay
       if (selectedChannelId) {
         invalidateGuideQueries(800);
       }
    }
  }));

  // Quick Actions mutations
  const regenerateScheduleMutation = useMutation(orpc.channels.regenerateSchedule.mutationOptions({
    onSuccess: async () => {
      toast.success("Schedule regenerated successfully!");
      // Invalidate guide queries to show updated schedule  
      invalidateGuideQueries(500);
    },
    onError: (error) => {
      console.error("Failed to regenerate schedule:", error);
      toast.error("Failed to regenerate schedule");
    }
  }));

  const shuffleAllContentMutation = useMutation(orpc.channels.shuffleAllContent.mutationOptions({
    onMutate: async (variables) => {
      const channelQueryKey = orpc.channels.getLineup.queryOptions({ 
        input: { id: variables.channelId } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelQueryKey });
      const previousData = queryClient.getQueryData(channelQueryKey);
      
      return { previousData, channelQueryKey };
    },
    onError: (err, variables, context) => {
      console.error("Failed to shuffle content:", err);
      toast.error("Failed to shuffle content");
      if (context?.previousData && context?.channelQueryKey) {
        queryClient.setQueryData(context.channelQueryKey, context.previousData);
      }
    },
    onSuccess: async (data) => {
      toast.success(`Successfully shuffled ${data.shuffled} items! Programs regenerated.`);
      if (selectedChannelId) {
        await invalidateChannelDetail(queryClient, selectedChannelId);
        
        // The backend automatically regenerates programs, so invalidate guide
        invalidateGuideQueries(800);
      }
    }
  }));

  // Programming Rules mutations
  const updateChannelSettingsMutation = useMutation(orpc.channels.updateChannelSettings.mutationOptions({
    onSuccess: () => {
      console.log("Channel settings updated");
    },
    onError: (error) => {
      console.error("Failed to update channel settings:", error);
    }
  }));

  const generateForChannelMutation = useMutation(orpc.channels.generatePrograms.mutationOptions({
    onSuccess: () => {
      // Don't show success toast here since it's used internally
      console.log("Channel programs generated");
    },
    onError: (error) => {
      console.error("Failed to generate channel programs:", error);
    }
  }));

  // Quick Actions handlers
  const handleRegenerateSchedule = () => {
    if (!selectedChannelId) return;
    regenerateScheduleMutation.mutate({ channelId: selectedChannelId });
  };

  const handleShuffleAllContent = () => {
    if (!selectedChannelId) return;
    
    const confirmed = window.confirm(
      "This will randomly reorder all shows and movies in this channel. This action cannot be undone. Are you sure you want to continue?"
    );
    
    if (confirmed) {
      shuffleAllContentMutation.mutate({ channelId: selectedChannelId });
    }
  };

  // Smart shuffle/sort handlers
  const handleSmartShuffle = (type: string) => {
    if (!selectedChannelId) return;
    
    const programs = lineupItems;
    if (programs.length === 0) return;
    
    let reorderedPrograms: any[] = [];
    
    // Check if this is a sort operation that should be saved for automation
    const sortMethods = [
      'sort-title-asc', 'sort-title-desc', 'sort-episode-title-asc', 'sort-episode-title-desc',
      'sort-season-episode', 'sort-year-newest', 'sort-year-oldest', 
      'sort-duration-longest', 'sort-duration-shortest'
    ];
    const isSortOperation = sortMethods.includes(type);
    
    // Check if this is a shuffle operation that should clear the sort method
    const shuffleMethods = [
      'shuffle-all', 'shuffle-by-year', 'shuffle-by-type', 'shuffle-by-show', 
      'shuffle-by-duration', 'reverse', 'clear-auto-sort'
    ];
    const isShuffleOperation = shuffleMethods.includes(type);
    
    switch (type) {
      case 'shuffle-all':
        reorderedPrograms = [...programs].sort(() => Math.random() - 0.5);
        break;
        
      case 'shuffle-by-year':
        // Group by year, shuffle within groups, then sort groups by year
        const yearGroups = programs.reduce((acc: Record<string, LineupItem[]>, program) => {
          const year = String(program.year ?? "Unknown");
          if (!acc[year]) acc[year] = [];
          acc[year].push(program);
          return acc;
        }, {});
        
        // Sort years chronologically and shuffle content within each year
        const sortedYearGroups = Object.entries(yearGroups)
          .sort(([yearA], [yearB]) => {
            // Handle 'Unknown' years by putting them at the end
            if (yearA === 'Unknown' && yearB === 'Unknown') return 0;
            if (yearA === 'Unknown') return 1;
            if (yearB === 'Unknown') return -1;
            return parseInt(yearA) - parseInt(yearB);
          })
          .map(([year, group]: [string, any]) => 
            group.sort(() => Math.random() - 0.5)
          );
        
        reorderedPrograms = sortedYearGroups.flat();
        break;
        
      case 'shuffle-by-type': {
        const showItems = programs.filter((p) => p.type === "show").sort(() => Math.random() - 0.5);
        const movieItems = programs.filter((p) => p.type === "movie").sort(() => Math.random() - 0.5);
        reorderedPrograms = [...showItems, ...movieItems].sort(() => Math.random() - 0.5);
        break;
      }

      case 'shuffle-by-show':
        reorderedPrograms = [...programs].sort(() => Math.random() - 0.5);
        break;
        
      case 'shuffle-by-duration':
        // Group by duration ranges, shuffle within groups
        const durationGroups = programs.reduce((acc: any, program: any) => {
          const duration = program.duration || 0;
          let group = 'unknown';
          if (duration < 1800000) group = 'short'; // < 30 min
          else if (duration < 3600000) group = 'medium'; // 30-60 min
          else group = 'long'; // > 60 min
          
          if (!acc[group]) acc[group] = [];
          acc[group].push(program);
          return acc;
        }, {});
        
        const shuffledDurationGroups = Object.values(durationGroups).map((group: any) => 
          group.sort(() => Math.random() - 0.5)
        ).sort(() => Math.random() - 0.5);
        
        reorderedPrograms = shuffledDurationGroups.flat();
        break;
        
      case 'sort-title-asc':
        reorderedPrograms = [...programs].sort((a, b) => a.title.localeCompare(b.title));
        break;
        
      case 'sort-title-desc':
        reorderedPrograms = [...programs].sort((a, b) => b.title.localeCompare(a.title));
        break;
        
      case 'sort-episode-title-asc':
      case 'sort-season-episode':
        reorderedPrograms = [...programs].sort((a, b) => a.title.localeCompare(b.title));
        break;

      case 'sort-episode-title-desc':
        reorderedPrograms = [...programs].sort((a, b) => b.title.localeCompare(a.title));
        break;
        
      case 'sort-year-newest':
        reorderedPrograms = [...programs].sort(
          (a, b) => (b.year ?? 0) - (a.year ?? 0),
        );
        break;

      case 'sort-year-oldest':
        reorderedPrograms = [...programs].sort(
          (a, b) => (a.year ?? 0) - (b.year ?? 0),
        );
        break;

      case 'sort-duration-longest':
        reorderedPrograms = [...programs].sort((a, b) => {
          const durA = a.type === "movie" ? (a.duration ?? 0) : 0;
          const durB = b.type === "movie" ? (b.duration ?? 0) : 0;
          return durB - durA;
        });
        break;

      case 'sort-duration-shortest':
        reorderedPrograms = [...programs].sort((a, b) => {
          const durA = a.type === "movie" ? (a.duration ?? 0) : 0;
          const durB = b.type === "movie" ? (b.duration ?? 0) : 0;
          return durA - durB;
        });
        break;
        
      case 'reverse':
        reorderedPrograms = [...programs].reverse();
        break;
        
      case 'clear-auto-sort':
        // Don't reorder content, just clear the auto-sort method
        reorderedPrograms = programs;
        break;
        
      default:
        return;
    }
    
    if (type !== "clear-auto-sort") {
      reorderContentMutation.mutate({
        channelId: selectedChannelId,
        items: (reorderedPrograms as LineupItem[]).map((item, index) => ({
          id: item.type === "show" ? item.showId : item.movieId,
          type: item.type,
          order: index,
        })),
      });
    }

    if (isSortOperation || isShuffleOperation) {
      let autoSortMethod: string | null | undefined;
      if (isSortOperation) {
        autoSortMethod = type;
      } else if (isShuffleOperation) {
        autoSortMethod = null;
      }

      updateFiltersMutation.mutate({
        id: selectedChannelId,
        autoFilterEnabled: lineup?.autoFilterEnabled || false,
        filterType: lineup?.filterType || "both",
        defaultEpisodeOrder: lineup?.defaultEpisodeOrder || "sequential",
        respectEpisodeOrder: lineup?.respectEpisodeOrder ?? true,
        blockShuffle: lineup?.blockShuffle || false,
        blockShuffleSize: lineup?.blockShuffleSize || 1,
        ...(lineup?.filterGenres ? { filterGenres: lineup.filterGenres } : {}),
        ...(lineup?.filterActors ? { filterActors: lineup.filterActors } : {}),
        ...(lineup?.filterDirectors ? { filterDirectors: lineup.filterDirectors } : {}),
        ...(lineup?.filterStudios ? { filterStudios: lineup.filterStudios } : {}),
        ...(lineup?.filterYearStart != null ? { filterYearStart: lineup.filterYearStart } : {}),
        ...(lineup?.filterYearEnd != null ? { filterYearEnd: lineup.filterYearEnd } : {}),
        ...(lineup?.filterRating ? { filterRating: lineup.filterRating } : {}),
        ...(autoSortMethod !== undefined ? { autoSortMethod } : {}),
      });
    }
    
    // Show toast feedback for smart actions
    if (type === 'clear-auto-sort') {
      toast.success(`Auto-sort method cleared! New content will use default ordering.`, { duration: 4000 });
    } else {
      const actionName = type.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      toast.success(`Applied "${actionName}" - programs regenerated!`);
      
      // Additional feedback for sort operations that will be saved for automation
      if (isSortOperation) {
        toast.success(`Sort method saved! New content will automatically follow "${actionName}" order.`, { duration: 4000 });
      } else if (isShuffleOperation) {
        toast.success(`Shuffle applied! Auto-sort method cleared - new content will use default ordering.`, { duration: 4000 });
      }
    }
  };

  const handleViewGrid = () => {
    // Placeholder for grid view functionality
    console.log("Grid view not yet implemented");
  };

  // Helper function to get display name for auto-sort method
  const getAutoSortDisplayName = (method: string | null | undefined): string | null => {
    if (!method) return null;
    
    const displayNames: Record<string, string> = {
      'sort-title-asc': 'Title A → Z',
      'sort-title-desc': 'Title Z → A',
      'sort-episode-title-asc': 'Episode Title A → Z',
      'sort-episode-title-desc': 'Episode Title Z → A',
      'sort-season-episode': 'Season & Episode Order',
      'sort-year-newest': 'Newest First',
      'sort-year-oldest': 'Oldest First',
      'sort-duration-longest': 'Longest First',
      'sort-duration-shortest': 'Shortest First'
    };
    
    return displayNames[method] || null;
  };

  // Programming Rules handlers
  const handleEpisodeOrderChange = (value: string) => {
    setDefaultEpisodeOrder(value);
    if (selectedChannelId) {
      updateChannelSettingsMutation.mutate({
        channelId: selectedChannelId,
        settings: { defaultEpisodeOrder: value as 'sequential' | 'random' | 'shuffle' }
      });
    }
  };

  const handleRespectEpisodeOrderChange = (checked: boolean) => {
    setRespectEpisodeOrder(checked);
    if (selectedChannelId) {
      updateChannelSettingsMutation.mutate({
        channelId: selectedChannelId,
        settings: { respectEpisodeOrder: checked }
      });
    }
  };

  const handleBlockShuffleChange = (checked: boolean) => {
    setBlockShuffle(checked);
    if (selectedChannelId) {
      updateChannelSettingsMutation.mutate({
        channelId: selectedChannelId,
        settings: { blockShuffle: checked }
      });
    }
  };

  const handleLineupDragEnd = useCallback(
    (items: LineupItem[]) => {
      if (!selectedChannelId) return;
      reorderContentMutation.mutate({
        channelId: selectedChannelId,
        items: items.map((item, index) => ({
          id: item.type === "show" ? item.showId : item.movieId,
          type: item.type,
          order: index,
        })),
      });
    },
    [selectedChannelId, reorderContentMutation],
  );

  const handleEpisodeDragEnd = useCallback(
    (showId: string, episodes: ChannelShowEpisode[]) => {
      if (!selectedChannelId) return;
      reorderEpisodesMutation.mutate({
        channelId: selectedChannelId,
        episodes: episodes.map((ep, index) => ({
          showId,
          episodeId: ep.id,
          order: index,
        })),
      });
    },
    [selectedChannelId, reorderEpisodesMutation],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Radio className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
            TV Channels
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Manage your live TV channels and their programming
          </p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" asChild>
                <Link href="/media.m3u">
                  <span className="hidden md:inline">Export M3U</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Export M3U</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Mobile Channel Selector */}
      <div className="md:hidden mb-6">
        {channelsQuery.data && channelsQuery.data.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Select Channel</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="sm"
                      onClick={() => {
                        setNewChannel(prev => ({ ...prev, number: getNextChannelNumber() }));
                        setShowCreateForm(true);
                      }}
                    >
                      <Plus className="w-4 h-4 md:mr-1" />
                      <span className="hidden md:inline">Add</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Add Channel</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Select 
                value={selectedChannelId || ""} 
                onValueChange={(value) => {
                  setSelectedChannelId(value);
                  updateChannelInUrl(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a channel">
                    {selectedChannelId && channelsQuery.data ? (
                      (() => {
                        const channel = (channelsQuery.data as any[]).find(ch => ch.id === selectedChannelId);
                        return channel ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs px-2 py-1">
                              {channel.number}
                            </Badge>
                            {channel.icon && (
                              <img 
                                src={channel.icon} 
                                alt=""
                                className="w-4 h-4 rounded object-cover"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            )}
                            <span className="truncate">{channel.name}</span>
                          </div>
                        ) : "Select channel";
                      })()
                    ) : "Select channel"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(channelsQuery.data as any[]).map((channel: any) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      <div className="flex items-center gap-2 w-full">
                        <Badge variant="outline" className="text-xs px-2 py-1">
                          {channel.number}
                        </Badge>
                        {channel.icon && (
                          <img 
                            src={channel.icon} 
                            alt=""
                            className="w-4 h-4 rounded object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <span className="truncate">{channel.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {(channel.channelShowCount ?? 0) + (channel.channelMovieCount ?? 0)} items
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center">
              <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-2">No channels yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first channel to get started
              </p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm"
                    onClick={() => {
                      setNewChannel(prev => ({ ...prev, number: 1 }));
                      setShowCreateForm(true);
                    }}
                  >
                    <Plus className="w-4 h-4 md:mr-2" />
                    <span className="hidden md:inline">Create Channel</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Create Channel</p>
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Channel Form */}
      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Channel</CardTitle>
            <CardDescription>Configure a new TV channel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="single">
              <TabsList className="mb-4">
                <TabsTrigger value="single">Single Channel</TabsTrigger>
                <TabsTrigger value="collections">From Collections</TabsTrigger>
              </TabsList>
              <TabsContent value="single">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="number">Channel Number</Label>
                <Input
                  id="number"
                  type="number"
                  value={newChannel.number}
                  onChange={(e) => setNewChannel(prev => ({ ...prev, number: parseInt(e.target.value) || 1 }))}
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Channel Name</Label>
                <Input
                  id="name"
                  value={newChannel.name}
                  onChange={(e) => setNewChannel(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="My TV Channel"
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="icon">Icon URL (optional)</Label>
                <Input
                  id="icon"
                  value={newChannel.icon}
                  onChange={(e) => setNewChannel(prev => ({ ...prev, icon: e.target.value }))}
                  placeholder="https://example.com/icon.png"
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="groupTitle">Group Title (optional)</Label>
                {existingGroups.length > 0 ? (
                  <Select 
                    value={newChannel.groupTitle || "custom"} 
                    onValueChange={(value) => {
                      if (value === "custom") {
                        setNewChannel(prev => ({ ...prev, groupTitle: "" }));
                      } else {
                        setNewChannel(prev => ({ ...prev, groupTitle: value }));
                      }
                    }}
                  >
                    <SelectTrigger className="touch-manipulation">
                      <SelectValue placeholder="Select existing group or create new" />
                    </SelectTrigger>
                    <SelectContent>
                      {existingGroups.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        <span className="text-muted-foreground italic">+ Create new group</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="groupTitle"
                    value={newChannel.groupTitle}
                    onChange={(e) => setNewChannel(prev => ({ ...prev, groupTitle: e.target.value }))}
                    placeholder="Entertainment"
                    className="touch-manipulation"
                  />
                )}
                {existingGroups.length > 0 && (newChannel.groupTitle === "" || !existingGroups.includes(newChannel.groupTitle)) && (
                  <Input
                    placeholder="Enter custom group name"
                    value={newChannel.groupTitle}
                    onChange={(e) => setNewChannel(prev => ({ ...prev, groupTitle: e.target.value }))}
                    className="mt-2 touch-manipulation"
                  />
                )}
              </div>
            </div>
            
              </TabsContent>
              <TabsContent value="collections">
                <BulkCreateFromCollections />
              </TabsContent>
            </Tabs>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={() => setShowCreateForm(false)} className="touch-manipulation">
                    <span className="hidden md:inline">Cancel</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Cancel</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={handleCreateChannel}
                    disabled={!newChannel.name || createChannelMutation.isPending}
                    className="touch-manipulation"
                  >
                    {createChannelMutation.isPending ? (
                      <span className="hidden md:inline">Creating...</span>
                    ) : (
                      <>
                        <span className="hidden md:inline">Create Channel</span>
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{createChannelMutation.isPending ? "Creating..." : "Create Channel"}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Channel Form */}
      {editingChannelId && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Edit Channel</CardTitle>
            <CardDescription>Update channel information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-number">Channel Number</Label>
                <Input
                  id="edit-number"
                  type="number"
                  value={editChannel.number}
                  onChange={(e) => setEditChannel(prev => ({ ...prev, number: parseInt(e.target.value) || 1 }))}
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Channel Name</Label>
                <Input
                  id="edit-name"
                  value={editChannel.name}
                  onChange={(e) => setEditChannel(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="My TV Channel"
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-icon">Icon URL (optional)</Label>
                <Input
                  id="edit-icon"
                  value={editChannel.icon}
                  onChange={(e) => setEditChannel(prev => ({ ...prev, icon: e.target.value }))}
                  placeholder="https://example.com/icon.png"
                  className="touch-manipulation"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-groupTitle">Group Title (optional)</Label>
                {existingGroups.length > 0 ? (
                  <Select 
                    value={editChannel.groupTitle || "custom"} 
                    onValueChange={(value) => {
                      if (value === "custom") {
                        setEditChannel(prev => ({ ...prev, groupTitle: "" }));
                      } else {
                        setEditChannel(prev => ({ ...prev, groupTitle: value }));
                      }
                    }}
                  >
                    <SelectTrigger className="touch-manipulation">
                      <SelectValue placeholder="Select existing group or create new" />
                    </SelectTrigger>
                    <SelectContent>
                      {existingGroups.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        <span className="text-muted-foreground italic">+ Create new group</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="edit-groupTitle"
                    value={editChannel.groupTitle}
                    onChange={(e) => setEditChannel(prev => ({ ...prev, groupTitle: e.target.value }))}
                    placeholder="Entertainment"
                    className="touch-manipulation"
                  />
                )}
                {existingGroups.length > 0 && (editChannel.groupTitle === "" || !existingGroups.includes(editChannel.groupTitle)) && (
                  <Input
                    placeholder="Enter custom group name"
                    value={editChannel.groupTitle}
                    onChange={(e) => setEditChannel(prev => ({ ...prev, groupTitle: e.target.value }))}
                    className="mt-2 touch-manipulation"
                  />
                )}
              </div>
            </div>

            {/* Catchup / Timeshift Settings */}
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Rewind className="w-4 h-4" />
                Catchup / Timeshift
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Enable Catchup</Label>
                    <p className="text-xs text-muted-foreground">
                      Allow viewers to watch previously aired programs
                    </p>
                  </div>
                  <Switch
                    checked={editChannel.catchupEnabled ?? true}
                    onCheckedChange={(checked) => setEditChannel(prev => ({ ...prev, catchupEnabled: checked }))}
                  />
                </div>
                {(editChannel.catchupEnabled ?? true) && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-catchupWindowHours">Catchup Window (hours)</Label>
                    <Select
                      value={String(editChannel.catchupWindowHours ?? 24)}
                      onValueChange={(value) => setEditChannel(prev => ({ ...prev, catchupWindowHours: parseInt(value) }))}
                    >
                      <SelectTrigger className="touch-manipulation">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">6 hours</SelectItem>
                        <SelectItem value="12">12 hours</SelectItem>
                        <SelectItem value="24">24 hours (1 day)</SelectItem>
                        <SelectItem value="48">48 hours (2 days)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      How far back viewers can go to watch past programs
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={() => setEditingChannelId(null)} className="touch-manipulation">
                    <span className="hidden md:inline">Cancel</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Cancel</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={handleUpdateChannel}
                    disabled={!editChannel.name || updateChannelMutation.isPending}
                    className="touch-manipulation"
                  >
                    {updateChannelMutation.isPending ? (
                      <span className="hidden md:inline">Updating...</span>
                    ) : (
                      <span className="hidden md:inline">Update Channel</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{updateChannelMutation.isPending ? "Updating..." : "Update Channel"}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:items-start">
        <ChannelSidebar
          channels={(channelsQuery.data as ChannelSummary[]) ?? []}
          selectedChannelId={selectedChannelId}
          isLoading={channelsQuery.isLoading}
          error={channelsQuery.error ?? null}
          onSelect={(id) => {
            setSelectedChannelId(id);
            updateChannelInUrl(id);
          }}
          onEdit={(channel) => {
            setEditChannel({
              id: channel.id,
              number: channel.number,
              name: channel.name,
              icon: channel.icon || "",
              groupTitle: channel.groupTitle || "",
              catchupEnabled: channel.catchupEnabled ?? true,
              catchupWindowHours: channel.catchupWindowHours ?? 24,
            });
            setEditingChannelId(channel.id);
          }}
          onAddChannel={() => {
            setNewChannel((prev) => ({ ...prev, number: getNextChannelNumber() }));
            setShowCreateForm(true);
          }}
          onPrefetch={prefetchChannel}
        />

        {/* Channel Content - Main Area */}
        <div className="lg:col-span-2">
          {!selectedChannelId ? (
            <Card>
              <CardContent className="p-8 sm:p-12 text-center">
                <Radio className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg sm:text-xl font-semibold mb-2">Select a channel</h3>
                <p className="text-muted-foreground text-sm sm:text-base">
                  Choose a channel from the list to view and manage its programming
                </p>
              </CardContent>
            </Card>
          ) : channelsQuery.isLoading && !selectedSummary ? (
            <Card>
              <CardContent className="p-8">
                <div className="animate-pulse space-y-4">
                  <div className="h-8 bg-muted rounded w-1/3"></div>
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-20 bg-muted rounded"></div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : !selectedSummary ? (
            <Card>
              <CardContent className="p-8 sm:p-12 text-center">
                <h3 className="text-lg sm:text-xl font-semibold mb-2">Channel not found</h3>
                <Button 
                  onClick={() => {
                    setSelectedChannelId(null);
                    router.replace('/channels', { scroll: false });
                  }}
                  className="touch-manipulation"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Channels
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Channel Header */}
              <Card className="flex-shrink-0">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="text-lg px-3 py-1">
                        {selectedSummary!.number}
                      </Badge>
                      <div className="flex items-center gap-3">
                        {selectedSummary!.icon && (
                          <img 
                            src={selectedSummary!.icon!} 
                            alt=""
                            className="w-8 h-8 rounded object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <div>
                          <CardTitle className="text-xl">{selectedSummary!.name}</CardTitle>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            {selectedSummary!.groupTitle && (
                              <Badge variant="secondary" className="text-xs">
                                {selectedSummary!.groupTitle}
                              </Badge>
                            )}
                            {selectedSummary!.stealth && (
                              <Badge variant="outline" className="text-xs">
                                <EyeOff className="w-3 h-3 mr-1" />
                                Stealth
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                            <Link href={`/player?channel=${selectedSummary!.number}`}>
                              <Play className="w-4 h-4 md:mr-1" />
                              <span className="hidden md:inline">Watch</span>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Watch</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => deleteChannelMutation.mutate({ id: selectedSummary!.id })}
                            disabled={deleteChannelMutation.isPending}
                            className="touch-manipulation"
                          >
                            <Trash2 className="w-4 h-4 md:mr-1" />
                            <span className="hidden md:inline">Delete</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Delete</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
              </Card>

                            {/* Programming Content - TwentyFourSeven Style */}
              <Tabs defaultValue="programming" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="programming" className="touch-manipulation">Programming</TabsTrigger>
                  <TabsTrigger value="schedule" className="touch-manipulation">Schedule</TabsTrigger>
                  <TabsTrigger value="filler" className="touch-manipulation">Filler</TabsTrigger>
                </TabsList>

                {/* Programming Tab */}
                <TabsContent value="programming" className="mt-0">
                  <Card>
                    <CardHeader className="flex-shrink-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="flex items-center gap-2">
                          <Video className="w-5 h-5" />
                          Channel Configuration
                        </CardTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleShuffleAllContent}
                                className="touch-manipulation"
                              >
                                <Shuffle className="w-4 h-4 md:mr-1" />
                                <span className="hidden md:inline">Shuffle All</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Shuffle All</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                onClick={() => setShowAddDialog(true)}
                                className="touch-manipulation"
                              >
                                <Plus className="w-4 h-4 md:mr-2" />
                                <span className="hidden md:inline">Add Content</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Add Content</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {lineupQuery.isFetching && !lineupReady && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                          <RotateCcw className="w-4 h-4 animate-spin" />
                          Loading channel…
                        </div>
                      )}
                      {!lineupReady && lineupQuery.isLoading ? (
                        <div className="space-y-4">
                          <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                              <div key={i} className="h-16 bg-muted rounded"></div>
                            ))}
                          </div>
                        </div>
                      ) : lineupReady && lineupItems.length === 0 ? (
                        <div className="text-center py-8 sm:py-12">
                          <Video className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
                          <h3 className="text-lg sm:text-xl font-semibold mb-2">No content in channel</h3>
                          <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                            Add TV shows and movies to your channel configuration. Programs will be auto-generated for the guide.
                          </p>
                          <div className="flex items-center gap-2 justify-center">
                            <Button 
                              onClick={() => setShowAddDialog(true)}
                              className="touch-manipulation"
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Add Content
                            </Button>
                          </div>
                        </div>
                      ) : lineupReady && lineup ? (
                        <div className="space-y-4">
                          <div className="bg-muted/30 p-4 rounded-lg flex-shrink-0">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                              <div>
                                <p className="text-sm text-muted-foreground">Shows</p>
                                <p className="text-xl sm:text-2xl font-bold">
                                  {lineup.channelShows?.length ?? 0}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Movies</p>
                                <p className="text-xl sm:text-2xl font-bold">
                                  {lineup.channelMovies?.length ?? 0}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Total Items</p>
                                <p className="text-xl sm:text-2xl font-bold">{lineupItems.length}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Generated Programs</p>
                                <p className="text-xl sm:text-2xl font-bold text-primary">
                                  {selectedSummary?.programCount ?? 0}
                                </p>
                              </div>
                            </div>
                          </div>

                          <ChannelProgrammingList
                            channelId={selectedChannelId!}
                            lineup={lineup}
                            onLineupDragEnd={handleLineupDragEnd}
                            onEpisodeDragEnd={handleEpisodeDragEnd}
                            onRemoveShow={handleRemoveShow}
                            onRemoveMovie={handleRemoveMovie}
                            isReorderPending={reorderContentMutation.isPending || reorderEpisodesMutation.isPending}
                          />
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Schedule Tab */}
                <TabsContent value="schedule">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="w-5 h-5" />
                        Program Schedule
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-8 sm:py-12">
                        <Clock className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg sm:text-xl font-semibold mb-2">Schedule View</h3>
                        <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                          Visual timeline of your channel programming (Coming Soon)
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" disabled className="touch-manipulation">
                              <RotateCcw className="w-4 h-4 md:mr-2" />
                              <span className="hidden md:inline">Generate Schedule</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Generate Schedule</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Filler Tab */}
                <TabsContent value="filler">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="flex items-center gap-2">
                          <Music className="w-5 h-5" />
                          Filler Content
                        </CardTitle>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" disabled className="touch-manipulation">
                              <Plus className="w-4 h-4 md:mr-2" />
                              <span className="hidden md:inline">Add Filler</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Add Filler</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-8 sm:py-12">
                        <Music className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg sm:text-xl font-semibold mb-2">No filler content</h3>
                        <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                          Add commercials, bumpers, and other filler content to enhance your channel
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" disabled className="touch-manipulation">
                              <Plus className="w-4 h-4 md:mr-2" />
                              <span className="hidden md:inline">Add Filler Content</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Add Filler Content</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

        {/* Sidebar - Programming Tools */}
        {selectedChannelId && selectedSummary && (
          <div className="lg:col-span-1">
            <div className="space-y-4 lg:sticky lg:top-0 pb-4">
            {/* Mobile Collapsible Quick Actions */}
            <div className="md:hidden">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button 
                    className="w-full touch-manipulation" 
                    variant="outline"
                    onClick={handleRegenerateSchedule}
                    disabled={regenerateScheduleMutation.isPending}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {regenerateScheduleMutation.isPending ? "Regenerating..." : "Regenerate Schedule"}
                  </Button>
                  
                  <Button 
                    className="w-full touch-manipulation" 
                    variant="outline"
                    onClick={() => handleSmartShuffle('shuffle-all')}
                    disabled={reorderContentMutation.isPending || lineupItems.length === 0}
                  >
                    <Shuffle className="w-4 h-4 mr-2" />
                    {reorderContentMutation.isPending ? "Shuffling..." : "Quick Shuffle"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden md:block space-y-4">
              {/* Quick Actions Dropdown */}
              <Card>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Quick Actions</Label>
                    <Select 
                      value=""
                      onValueChange={(value) => {
                        if (value === "regenerate") {
                          handleRegenerateSchedule();
                        } else if (value === "shuffle-all") {
                          handleSmartShuffle('shuffle-all');
                        } else if (value && value !== 'placeholder') {
                          handleSmartShuffle(value);
                        }
                      }}
                      disabled={regenerateScheduleMutation.isPending || reorderContentMutation.isPending || lineupItems.length === 0}
                    >
                      <SelectTrigger className="w-full touch-manipulation">
                        <SelectValue placeholder={
                          regenerateScheduleMutation.isPending 
                            ? "Regenerating..." 
                            : reorderContentMutation.isPending
                            ? "Shuffling..."
                            : "Choose action..."
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regenerate">
                          <div className="flex items-center gap-2">
                            <RotateCcw className="w-4 h-4" />
                            <span>Regenerate Schedule</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="shuffle-all">
                          <div className="flex items-center gap-2">
                            <Shuffle className="w-4 h-4" />
                            <span>Quick Shuffle</span>
                          </div>
                        </SelectItem>
                        
                        {/* Current Auto-Sort Status */}
                        {lineup?.autoSortMethod && (
                          <>
                            <div className="border-t my-1"></div>
                            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Current Auto-Sort
                            </div>
                            <SelectItem value="clear-auto-sort">
                              <div className="flex items-center gap-2">
                                <X className="w-4 h-4" />
                                <span>Clear Auto-Sort ({getAutoSortDisplayName(lineup!.autoSortMethod)})</span>
                              </div>
                            </SelectItem>
                            <div className="border-t my-1"></div>
                          </>
                        )}
                        
                        {/* Smart Shuffle Options */}
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Smart Shuffle
                        </div>
                        <SelectItem value="shuffle-by-year">
                          <div className="flex items-center gap-2">
                            <CalendarDays className="w-4 h-4" />
                            <span>Shuffle by Year</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="shuffle-by-type">
                          <div className="flex items-center gap-2">
                            <Video className="w-4 h-4" />
                            <span>Shuffle by Type</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="shuffle-by-show">
                          <div className="flex items-center gap-2">
                            <Film className="w-4 h-4" />
                            <span>Shuffle by Show</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="shuffle-by-duration">
                          <div className="flex items-center gap-2">
                            <Timer className="w-4 h-4" />
                            <span>Shuffle by Duration</span>
                          </div>
                        </SelectItem>
                        
                        {/* Sort Options */}
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t mt-1 pt-2">
                          Sort
                        </div>
                        <SelectItem value="sort-title-asc">
                          <div className="flex items-center gap-2">
                            <SortAsc className="w-4 h-4" />
                            <span>Title A → Z</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-title-desc">
                          <div className="flex items-center gap-2">
                            <SortDesc className="w-4 h-4" />
                            <span>Title Z → A</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-episode-title-asc">
                          <div className="flex items-center gap-2">
                            <SortAsc className="w-4 h-4" />
                            <span>Episode Title A → Z</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-episode-title-desc">
                          <div className="flex items-center gap-2">
                            <SortDesc className="w-4 h-4" />
                            <span>Episode Title Z → A</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-season-episode">
                          <div className="flex items-center gap-2">
                            <Video className="w-4 h-4" />
                            <span>Season & Episode Order</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-year-newest">
                          <div className="flex items-center gap-2">
                            <CalendarDays className="w-4 h-4" />
                            <span>Newest First</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-year-oldest">
                          <div className="flex items-center gap-2">
                            <CalendarDays className="w-4 h-4" />
                            <span>Oldest First</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-duration-longest">
                          <div className="flex items-center gap-2">
                            <Timer className="w-4 h-4" />
                            <span>Longest First</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sort-duration-shortest">
                          <div className="flex items-center gap-2">
                            <Timer className="w-4 h-4" />
                            <span>Shortest First</span>
                          </div>
                        </SelectItem>
                        
                        {/* Utility Options */}
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t mt-1 pt-2">
                          Utility
                        </div>
                        <SelectItem value="reverse">
                          <div className="flex items-center gap-2">
                            <RotateCcw className="w-4 h-4" />
                            <span>Reverse Order</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {reorderContentMutation.isPending && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <RotateCcw className="w-3 h-3 animate-spin" />
                        <span>Saving...</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Programming Rules Dropdown */}
              <Card>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Programming Rules</Label>
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5 text-xs">
                          Default Episode Order
                          {updateChannelSettingsMutation.isPending && (
                            <RotateCcw className="w-3 h-3 animate-spin" />
                          )}
                        </Label>
                        <Select 
                          value={defaultEpisodeOrder} 
                          onValueChange={handleEpisodeOrderChange}
                          disabled={updateChannelSettingsMutation.isPending}
                        >
                          <SelectTrigger className="touch-manipulation h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sequential">Sequential</SelectItem>
                            <SelectItem value="random">Random</SelectItem>
                            <SelectItem value="shuffle">Shuffle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="respect-order" 
                          checked={respectEpisodeOrder}
                          onCheckedChange={handleRespectEpisodeOrderChange}
                          disabled={updateChannelSettingsMutation.isPending}
                          className="touch-manipulation"
                        />
                        <Label htmlFor="respect-order" className="text-xs">Respect Episode Order</Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="block-shuffle" 
                          checked={blockShuffle}
                          onCheckedChange={handleBlockShuffleChange}
                          disabled={updateChannelSettingsMutation.isPending}
                          className="touch-manipulation"
                        />
                        <Label htmlFor="block-shuffle" className="text-xs">Block Shuffle</Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Content Dialog */}
      {showAddDialog && selectedChannelId && (
        <AddContentDialog
          isOpen={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          channelId={selectedChannelId}
          existingShows={lineup?.channelShows || []}
          existingMovies={lineup?.channelMovies || []}
          existingChannelData={lineup ?? undefined}
          onAddShows={handleAddShow}
          onAddMovies={handleAddMovie}
          onSaveAutomation={handleSaveAutomation}
        />
      )}



      </div>
    </TooltipProvider>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <ChannelsPageContent />
    </Suspense>
  );
}

function InlineBulkCreateFromCollections() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <div className="flex justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="sm" className="touch-manipulation" onClick={() => setOpen(o => !o)}>
              {open ? (
                <>
                  <X className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Close</span>
                </>
              ) : (
                <>
                  <Folder className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Create from Collections</span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{open ? 'Close' : 'Create from Collections'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {open && (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Create Channels from Collections</CardTitle>
          </CardHeader>
          <CardContent>
            <BulkCreateFromCollections />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BulkCreateFromCollections() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const [groupTitle, setGroupTitle] = useState("");
  const collectionsQuery = useQuery(orpc.library.collections.queryOptions({ input: { search, limit: 200, offset: 0 } }));
  const channelsForMerge = useQuery(orpc.channels.listSummary.queryOptions());
  const [previewPlan, setPreviewPlan] = useState<any[] | null>(null);
  const [conflicts, setConflicts] = useState<any[] | null>(null);
  const [showResolve, setShowResolve] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, { action: 'rename'|'merge'|'skip'|'create'; newName?: string; targetChannelId?: string }>>({});

  const previewMutation = useMutation(orpc.channels.createFromCollections.mutationOptions({
    onSuccess: (data: any) => {
      setPreviewPlan(data.plan || []);
      setConflicts(data.conflicts || []);
      if ((data.conflicts || []).length > 0) {
        setShowResolve(true);
      }
    },
    onError: () => toast.error("Preview failed")
  }));

  const executeMutation = useMutation(orpc.channels.createFromCollections.mutationOptions({
    onSuccess: async () => {
      toast.success("Bulk creation complete");
      setPreviewPlan(null);
      setConflicts(null);
      setShowResolve(false);
      await qc.invalidateQueries();
    },
    onError: () => toast.error("Bulk creation failed")
  }));

  const handlePreview = () => {
    previewMutation.mutate({ collections: selected.length ? selected : undefined, groupTitle: groupTitle || undefined, preview: true });
  };
  const handleExecute = () => {
    // If conflicts exist, require resolutions
    if (conflicts && conflicts.length > 0) {
      setShowResolve(true);
      toast.error('Resolve conflicts before creating');
      return;
    }
    executeMutation.mutate({ collections: selected.length ? selected : undefined, groupTitle: groupTitle || undefined, preview: false });
  };

  // Live preview on selection changes
  useEffect(() => {
    if (selected.length === 0) {
      setPreviewPlan(null);
      setConflicts(null);
      return;
    }
    previewMutation.mutate({ collections: selected, groupTitle: groupTitle || undefined, preview: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(selected), groupTitle]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <div className="space-y-2">
          <Label>Group Title (optional)</Label>
          <Input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="e.g. Collections" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Select Collections (optional)</Label>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search collections" />
        <div className="flex items-center justify-between py-1">
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => setSelected((collectionsQuery.data || []).map((c:any)=> c.name))}>
                  <CheckSquare className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Select All</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Select All</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => setSelected([])}>
                  <Square className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Select None</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Select None</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Badge variant="outline">{selected.length} selected</Badge>
        </div>
        <div className="max-h-56 overflow-auto border rounded p-2 space-y-1">
          {(collectionsQuery.data || []).map((c: any) => {
            const checked = selected.includes(c.name);
            return (
              <label key={c.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setSelected(prev => e.target.checked ? [...prev, c.name] : prev.filter(x => x !== c.name));
                  }}
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-muted-foreground">{c.count}</span>
              </label>
            );
          })}
        </div>
      </div>
      {/* Live Preview */}
      <div className="border rounded p-3 text-sm">
        <div className="font-medium mb-2">Live Preview</div>
        {previewPlan && previewPlan.length > 0 ? (
          <ul className="space-y-1 max-h-40 overflow-auto">
            {previewPlan.map((p: any, idx: number) => (
              <li key={idx} className="flex gap-2">
                <Badge>{p.proposedNumber}</Badge>
                <span className="truncate">{p.proposedName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground">No channels will be created</div>
        )}
        {conflicts && conflicts.length > 0 && (
          <div className="mt-3 p-2 border rounded bg-amber-50">
            <div className="font-medium mb-1">Conflicts detected</div>
            <div className="text-xs text-muted-foreground">Resolve before creating.</div>
          </div>
        )}
      </div>
      <Separator />
      <div className="flex gap-2 justify-end">
        <Button onClick={() => setShowResolve(true)} variant="outline" disabled={!conflicts || conflicts.length === 0}>Resolve</Button>
        <Button onClick={handleExecute} disabled={executeMutation.isPending || !!(conflicts && conflicts.length > 0)}>Create</Button>
      </div>
      {/* Resolve Conflicts Modal (simple inline card) */}
      {showResolve && conflicts && conflicts.length > 0 && (
        <Card className="border-2 border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Resolve Conflicts</CardTitle>
            <CardDescription>Fix duplicate or similar names before creating channels</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {conflicts.map((c, idx) => {
              const r = resolutions[c.original] || { action: 'rename' as const, newName: `${c.original} (2)` };
              return (
                <div key={idx} className="p-2 border rounded">
                  <div className="font-medium">{c.original}</div>
                  <div className="text-xs text-muted-foreground mb-2">Matches: {[...c.exactMatches, ...c.closeMatches].map((m:any)=>m.name).join(', ')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                    <div className="space-y-1">
                      <Label>Action</Label>
                      <Select value={r.action} onValueChange={(v:any)=> setResolutions(prev=>({ ...prev, [c.original]: { ...prev[c.original], action: v }}))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rename">Rename and create</SelectItem>
                          <SelectItem value="merge">Merge into existing</SelectItem>
                          <SelectItem value="skip">Skip</SelectItem>
                          <SelectItem value="create">Create as-is</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(r.action === 'rename' || r.action === 'create') && (
                      <div className="space-y-1">
                        <Label>Channel Name</Label>
                        <Input value={r.newName || c.original} onChange={(e)=> setResolutions(prev=>({ ...prev, [c.original]: { ...prev[c.original], newName: e.target.value }}))} />
                      </div>
                    )}
                    {r.action === 'merge' && (
                      <div className="space-y-1">
                        <Label>Target Channel</Label>
                        <Select value={r.targetChannelId} onValueChange={(v)=> setResolutions(prev=>({ ...prev, [c.original]: { ...prev[c.original], targetChannelId: v }}))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(channelsForMerge.data || []).map((ch:any)=> (
                              <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={()=> setShowResolve(false)}>Close</Button>
              <Button onClick={()=> {
                // Convert resolutions map to API shape and call execute with resolutions
                const payload = Object.entries(resolutions).map(([original, r]) => ({ original, ...(r as any) }));
                executeMutation.mutate({ collections: selected.length ? selected : undefined, groupTitle: groupTitle || undefined, preview: false, conflictResolutions: payload });
              }}>Apply and Create</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
