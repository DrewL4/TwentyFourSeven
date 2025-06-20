"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Info
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, X, ChevronDown, ChevronRight, Filter, User, Calendar, Tag } from "lucide-react";
import { toast } from "sonner";
import { Autocomplete } from "@/components/ui/combobox"
import { MultiSelect } from "@/components/ui/multi-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [ratingFilter, setRatingFilter] = useState("");
  const [autoFilterEnabled, setAutoFilterEnabled] = useState(false);
  const [smartFilteringEnabled, setSmartFilteringEnabled] = useState(false);
  const [keepUpToDate, setKeepUpToDate] = useState(false);
  
  // TV Show episode selection
  const [expandedShows, setExpandedShows] = useState<Set<string>>(new Set());
  const [selectedEpisodes, setSelectedEpisodes] = useState<Record<string, Set<string>>>({}); // showId -> episode IDs
  const [selectedSeasons, setSelectedSeasons] = useState<Record<string, Set<number>>>({}); // showId -> season numbers

  const showsQuery = useQuery(orpc.library.shows.queryOptions({ input: { limit: 10000 } }));
  const moviesQuery = useQuery(orpc.library.movies.queryOptions({ input: { limit: 10000 } }));

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
      ...(showsQuery.data || []).map((show: any) => ({ ...show, type: 'show' })),
      ...(moviesQuery.data || []).map((movie: any) => ({ ...movie, type: 'movie' }))
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
  }, [smartFilteringEnabled, genreFilter, actorFilter, directorFilter, studioFilter, yearFilter, yearRangeStart, yearRangeEnd, ratingFilter, actorSearch, directorSearch, genreSearch, studioSearch, showsQuery.data, moviesQuery.data, actorsQuery.data, directorsQuery.data, genresQuery.data, studiosQuery.data]);

  // Enhanced filter logic
  const filteredShows = (showsQuery.data || []).filter((show: any) => {
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

  const filteredMovies = (moviesQuery.data || []).filter((movie: any) => {
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
      
      if (selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) {
        // Add with specific seasons/episodes
        onAddShows(showId, {
          seasons: Array.from(selectedShowSeasons),
          episodes: Array.from(selectedShowEpisodes)
        }, keepUpToDate);
      } else {
        // Add entire show
        onAddShows(showId, undefined, keepUpToDate);
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
        const seasonEpisodes = show.episodes?.filter((ep: any) => ep.seasonNumber === seasonNumber) || [];
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
        const seasonEpisodes = show.episodes?.filter((ep: any) => ep.seasonNumber === seasonNumber) || [];
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
        const episode = show.episodes?.find((ep: any) => ep.id === episodeId);
        if (episode) {
          const seasonEpisodes = show.episodes?.filter((ep: any) => ep.seasonNumber === episode.seasonNumber) || [];
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
        const episode = show.episodes?.find((ep: any) => ep.id === episodeId);
        if (episode) {
          const seasonEpisodes = show.episodes?.filter((ep: any) => ep.seasonNumber === episode.seasonNumber) || [];
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
    (show.episodes || []).forEach((episode: any) => {
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

  if (!isOpen) return null;

  return (
    <TooltipProvider>
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
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X className="w-4 h-4" />
            </Button>
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
               <Button 
                 variant="outline"
                 onClick={() => setShowFilters(!showFilters)}
                 className="flex items-center gap-2"
               >
                 <Filter className="w-4 h-4" />
                 Advanced Filters
                 {showFilters ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
               </Button>
               <Button 
                 variant="outline" 
                 onClick={clearSelection}
                 disabled={selectedShows.size === 0 && selectedMovies.size === 0}
               >
                 Clear Selection
               </Button>
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
                 <div className="flex items-center justify-between mt-4">
                   <div className="flex items-center gap-4">
                     <div className="flex items-center space-x-2">
                       <Checkbox 
                         id="automation-enabled" 
                         checked={autoFilterEnabled}
                         onCheckedChange={(checked) => setAutoFilterEnabled(checked === true)}
                       />
                       <Label htmlFor="automation-enabled" className="text-sm font-medium flex items-center gap-1">
                         <Zap className="w-3 h-3" />
                         Enable Channel Automation
                         <Tooltip>
                           <TooltipTrigger asChild>
                             <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                           </TooltipTrigger>
                           <TooltipContent side="top" className="max-w-xs">
                             <p>When enabled, new content matching these filters will be automatically added to this channel when synced from your Plex server.</p>
                           </TooltipContent>
                         </Tooltip>
                       </Label>
                     </div>
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
                   </div>
                   <Button variant="outline" size="sm" onClick={clearAllFilters}>
                     Clear All Filters
                   </Button>
                 </div>
               </div>
             )}
           </div>
        </CardHeader>

        <CardContent className="p-0 h-full">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <div className="border-b px-6">
              <TabsList className="grid w-full grid-cols-2">
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
              </TabsList>
            </div>

            <TabsContent value="shows" className="p-6 space-y-4 h-[500px] overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={selectAllShows}
                    disabled={filteredShows.length === 0}
                  >
                    Select All ({filteredShows.length})
                  </Button>
                  {selectedShows.size > 0 && (
                    <Button onClick={handleBulkAddShows}>
                      Add {selectedShows.size} Shows
                    </Button>
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
                               {show.year} • {seasons.length} seasons • {show.episodes?.length || 0} episodes
                             </p>
                             {(selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) && (
                               <Badge variant="secondary" className="text-xs">
                                 {selectedShowSeasons.size}S, {selectedShowEpisodes.size}E selected
                               </Badge>
                             )}
                           </div>
                         </div>
                         <div className="flex items-center gap-2">
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => toggleShowExpansion(show.id)}
                           >
                             {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                             Episodes
                           </Button>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => {
                               const selectedShowSeasons = selectedSeasons[show.id] || new Set();
                               const selectedShowEpisodes = selectedEpisodes[show.id] || new Set();
                               
                               if (selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) {
                                 onAddShows(show.id, {
                                   seasons: Array.from(selectedShowSeasons),
                                   episodes: Array.from(selectedShowEpisodes)
                                 }, keepUpToDate);
                               } else {
                                 onAddShows(show.id, undefined, keepUpToDate);
                               }
                               
                               toggleShowSelection(show.id);
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
                             {(() => {
                               const selectedShowSeasons = selectedSeasons[show.id] || new Set();
                               const selectedShowEpisodes = selectedEpisodes[show.id] || new Set();
                               
                               if (selectedShowSeasons.size > 0 || selectedShowEpisodes.size > 0) {
                                 return `Add Selected (${selectedShowSeasons.size}S, ${selectedShowEpisodes.size}E)`;
                               }
                               return "Add All";
                             })()}
                           </Button>
                         </div>
                       </div>

                       {/* Episode Selection */}
                       {isExpanded && (
                         <div className="border-t bg-muted/20 p-3 space-y-3">
                           <div className="flex items-center justify-between">
                             <h5 className="font-medium text-sm">Select Seasons/Episodes</h5>
                             <Button 
                               size="sm" 
                               variant="outline"
                               onClick={() => selectAllSeasonsForShow(show.id, seasons)}
                             >
                               Select All Seasons
                             </Button>
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
                               <Button 
                                 size="sm"
                                 onClick={() => {
                                   onAddShows(show.id, {
                                     seasons: Array.from(selectedShowSeasons),
                                     episodes: Array.from(selectedShowEpisodes)
                                   }, keepUpToDate);
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
                                 Add Selected ({selectedShowSeasons.size} seasons, {selectedShowEpisodes.size} episodes)
                               </Button>
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
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={selectAllMovies}
                    disabled={filteredMovies.length === 0}
                  >
                    Select All ({filteredMovies.length})
                  </Button>
                  {selectedMovies.size > 0 && (
                    <Button onClick={handleBulkAddMovies}>
                      Add {selectedMovies.size} Movies
                    </Button>
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onAddMovies(movie.id);
                        toggleMovieSelection(movie.id);
                      }}
                    >
                      Add
                    </Button>
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
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={() => {
                  handleBulkAddShows();
                  handleBulkAddMovies();
                  handleClose();
                }}
                disabled={selectedShows.size === 0 && selectedMovies.size === 0}
              >
                Add Selected ({selectedShows.size + selectedMovies.size})
              </Button>
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
  const searchParams = useSearchParams();
  const channelIdFromUrl = searchParams.get('channelId');
  
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channelIdFromUrl);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState({
    number: 1,
    name: "",
    icon: "",
    groupTitle: ""
  });
  const [editChannel, setEditChannel] = useState({
    id: "",
    number: 1,
    name: "",
    icon: "",
    groupTitle: ""
  });
  
  // Programming Rules state
  const [defaultEpisodeOrder, setDefaultEpisodeOrder] = useState("sequential");
  const [respectEpisodeOrder, setRespectEpisodeOrder] = useState(true);
  const [blockShuffle, setBlockShuffle] = useState(false);

  const queryClient = useQueryClient();
  const channelsQuery = useQuery(orpc.channels.list.queryOptions());
  const showsQuery = useQuery(orpc.library.shows.queryOptions({ input: { limit: 10000 } }));
  const moviesQuery = useQuery(orpc.library.movies.queryOptions({ input: { limit: 10000 } }));

  // Function to update URL when channel selection changes
  const updateChannelInUrl = (channelId: string) => {
    const newSearchParams = new URLSearchParams(searchParams.toString());
    newSearchParams.set('channelId', channelId);
    router.replace(`/channels?${newSearchParams.toString()}`, { scroll: false });
  };

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

  // Get selected channel data
  const selectedChannelQuery = useQuery({
    ...orpc.channels.get.queryOptions({ 
      input: { id: selectedChannelId! } 
    }),
    enabled: !!selectedChannelId 
  });

  // Load programming rules when channel changes
  useEffect(() => {
    if (selectedChannelId && selectedChannelQuery.data) {
      // Load the actual channel settings from the database
      setDefaultEpisodeOrder(selectedChannelQuery.data.defaultEpisodeOrder || "sequential");
      setRespectEpisodeOrder(selectedChannelQuery.data.respectEpisodeOrder ?? true);
      setBlockShuffle(selectedChannelQuery.data.blockShuffle || false);
    }
  }, [selectedChannelId, selectedChannelQuery.data]);

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

  // Get channel program schedule (individual episodes/movies)
  const channelProgramsQuery = useQuery({
    ...orpc.guide.channel.queryOptions({
      input: { channelId: selectedChannelId!, hours: 48 }
    }),
    enabled: !!selectedChannelId
  });

  // Fetch complete episode data for shows in the selected channel
  // This ensures we have all episodes, not just the incomplete data from the channel query
  const channelShowIds = selectedChannelQuery.data?.channelShows?.map((cs: any) => cs.showId) || [];
  const completeShowsQuery = useQuery({
    ...orpc.library.shows.queryOptions({ 
      input: { 
        limit: 10000 
      } 
    }),
    queryKey: ['completeShows', channelShowIds],
    enabled: channelShowIds.length > 0,
  });

  const createChannelMutation = useMutation(orpc.channels.create.mutationOptions({
    onSuccess: (data) => {
      // Invalidate and refetch to get the real data from server
      const queryKey = orpc.channels.list.queryOptions().queryKey;
      queryClient.invalidateQueries({ queryKey });
      
      // Clear the form and select the new channel
      const nextChannelNumber = channelsQuery.data ? Math.max(...(channelsQuery.data as any[]).map((ch: any) => ch.number)) + 1 : 1;
      setNewChannel({ number: nextChannelNumber, name: "", icon: "", groupTitle: "" });
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
      const channelsQueryKey = orpc.channels.list.queryOptions().queryKey;
      const selectedChannelQueryKey = orpc.channels.get.queryOptions({ 
        input: { id: variables.id } 
      }).queryKey;
      
      await queryClient.cancelQueries({ queryKey: channelsQueryKey });
      await queryClient.cancelQueries({ queryKey: selectedChannelQueryKey });
      
      const previousChannels = queryClient.getQueryData(channelsQueryKey);
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
      queryClient.setQueryData(selectedChannelQueryKey, (old: any) => {
        return old ? { ...old, ...variables } : old;
      });
      
      return { previousChannels, previousSelectedChannel, channelsQueryKey, selectedChannelQueryKey };
    },
    onError: (err, variables, context) => {
      toast.error("Failed to update channel");
      // Rollback on error
      if (context?.previousChannels && context?.channelsQueryKey) {
        queryClient.setQueryData(context.channelsQueryKey, context.previousChannels);
      }
      if (context?.previousSelectedChannel && context?.selectedChannelQueryKey) {
        queryClient.setQueryData(context.selectedChannelQueryKey, context.previousSelectedChannel);
      }
    },
    onSuccess: (data) => {
      // Invalidate and refetch to get the real data from server
      const queryKey = orpc.channels.list.queryOptions().queryKey;
      queryClient.invalidateQueries({ queryKey });
      
      // Also invalidate the selected channel query
      if (selectedChannelId) {
        queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
      }
      
      // Clear the edit form
      setEditingChannelId(null);
      
      toast.success(`Channel "${data.name}" updated successfully!`);
    }
  }));

  const deleteChannelMutation = useMutation(orpc.channels.delete.mutationOptions({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches - use the same key pattern as orpc query
      const queryKey = orpc.channels.list.queryOptions().queryKey;
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
      const queryKey = orpc.channels.list.queryOptions().queryKey;
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
      await queryClient.invalidateQueries({ queryKey: orpc.channels.list.queryOptions().queryKey });
      
      if (selectedChannelId) {
        await queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
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
      await queryClient.invalidateQueries({ queryKey: orpc.channels.list.queryOptions().queryKey });
      
      if (selectedChannelId) {
        await queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
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
      const channelsQueryKey = orpc.channels.list.queryOptions().queryKey;
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
      await queryClient.invalidateQueries({ queryKey: orpc.channels.list.queryOptions().queryKey });
      if (selectedChannelId) {
        await queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
        
        // The backend automatically regenerates programs, so invalidate guide with delay
        invalidateGuideQueries(800);
      }
    }
  }));

  const removeMovieMutation = useMutation(orpc.channels.removeMovie.mutationOptions({
    onMutate: async (variables) => {
      const channelsQueryKey = orpc.channels.list.queryOptions().queryKey;
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
      await queryClient.invalidateQueries({ queryKey: orpc.channels.list.queryOptions().queryKey });
      if (selectedChannelId) {
        await queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
        
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
      groupTitle: newChannel.groupTitle || undefined
    });
  };

  const handleUpdateChannel = () => {
    if (!editChannel.name || !editChannel.id) return;
    
    updateChannelMutation.mutate({
      id: editChannel.id,
      number: editChannel.number,
      name: editChannel.name,
      icon: editChannel.icon || undefined,
      groupTitle: editChannel.groupTitle || undefined
    });
  };

  const handleAddShow = (showId: string, selections?: { seasons?: number[], episodes?: string[] }, keepUp?: boolean) => {
    if (!selectedChannelId) return;
    const allContent = getChannelConfiguration();
    const nextOrder = allContent.length;
    
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
    const allContent = getChannelConfiguration();
    const nextOrder = allContent.length;
    
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
      const channelQueryKey = orpc.channels.get.queryOptions({ 
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
      await queryClient.invalidateQueries({ 
        queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId! } }).queryKey 
      });
             
       // The backend automatically regenerates programs, so invalidate guide with delay
       if (selectedChannelId) {
         invalidateGuideQueries(800);
       }
    }
  }));

  // Reorder episodes mutation
  const reorderEpisodesMutation = useMutation(orpc.channels.reorderEpisodes.mutationOptions({
    onMutate: async (variables) => {
      const channelQueryKey = orpc.channels.get.queryOptions({ 
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
      await queryClient.invalidateQueries({ 
        queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId! } }).queryKey 
      });
             
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
      const channelQueryKey = orpc.channels.get.queryOptions({ 
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
        await queryClient.invalidateQueries({ 
          queryKey: orpc.channels.get.queryOptions({ input: { id: selectedChannelId } }).queryKey 
        });
        
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
    
    const programs = getAllPrograms();
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
        const yearGroups = programs.reduce((acc: any, program: any) => {
          // For episodes, get year from the show, for movies get from movie
          const year = program.type === 'episode' ? 
            (program.year || program.showYear || 'Unknown') : 
            (program.year || 'Unknown');
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
        
      case 'shuffle-by-type':
        // Group episodes and movies separately, shuffle within groups
        const episodes = programs.filter(p => p.type === 'episode').sort(() => Math.random() - 0.5);
        const movies = programs.filter(p => p.type === 'movie').sort(() => Math.random() - 0.5);
        const shows = programs.filter(p => p.type === 'show').sort(() => Math.random() - 0.5);
        
        // Interleave types randomly
        reorderedPrograms = [...episodes, ...movies, ...shows].sort(() => Math.random() - 0.5);
        break;
        
      case 'shuffle-by-show':
        // Group episodes by show, shuffle episodes within each show, then shuffle shows
        const showGroups = programs.reduce((acc: any, program: any) => {
          const showKey = program.type === 'episode' ? program.title : `${program.type}-${program.title}`;
          if (!acc[showKey]) acc[showKey] = [];
          acc[showKey].push(program);
          return acc;
        }, {});
        
        const shuffledShowGroups = Object.values(showGroups).map((group: any) => 
          group.sort(() => Math.random() - 0.5)
        ).sort(() => Math.random() - 0.5);
        
        reorderedPrograms = shuffledShowGroups.flat();
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
        reorderedPrograms = [...programs].sort((a, b) => {
          // For episodes, sort by episode title; for others, use main title
          const titleA = a.type === 'episode' ? (a.episodeTitle || a.title) : a.title;
          const titleB = b.type === 'episode' ? (b.episodeTitle || b.title) : b.title;
          return titleA.localeCompare(titleB);
        });
        break;
        
      case 'sort-episode-title-desc':
        reorderedPrograms = [...programs].sort((a, b) => {
          const titleA = a.type === 'episode' ? (a.episodeTitle || a.title) : a.title;
          const titleB = b.type === 'episode' ? (b.episodeTitle || b.title) : b.title;
          return titleB.localeCompare(titleA);
        });
        break;
        
      case 'sort-season-episode':
        reorderedPrograms = [...programs].sort((a, b) => {
          // Episodes first, then shows, then movies
          if (a.type !== b.type) {
            const typeOrder = { episode: 0, show: 1, movie: 2 };
            return (typeOrder[a.type as keyof typeof typeOrder] || 3) - (typeOrder[b.type as keyof typeof typeOrder] || 3);
          }
          
          // For episodes, sort by show title, then season, then episode
          if (a.type === 'episode' && b.type === 'episode') {
            const showCompare = a.title.localeCompare(b.title);
            if (showCompare !== 0) return showCompare;
            
            const seasonCompare = (a.seasonNumber || 0) - (b.seasonNumber || 0);
            if (seasonCompare !== 0) return seasonCompare;
            
            return (a.episodeNumber || 0) - (b.episodeNumber || 0);
          }
          
          // For non-episodes, sort by title
          return a.title.localeCompare(b.title);
        });
        break;
        
      case 'sort-year-newest':
        reorderedPrograms = [...programs].sort((a, b) => {
          const yearA = a.type === 'episode' ? (a.year || a.showYear || 0) : (a.year || 0);
          const yearB = b.type === 'episode' ? (b.year || b.showYear || 0) : (b.year || 0);
          return yearB - yearA;
        });
        break;
        
      case 'sort-year-oldest':
        reorderedPrograms = [...programs].sort((a, b) => {
          const yearA = a.type === 'episode' ? (a.year || a.showYear || 0) : (a.year || 0);
          const yearB = b.type === 'episode' ? (b.year || b.showYear || 0) : (b.year || 0);
          return yearA - yearB;
        });
        break;
        
      case 'sort-duration-longest':
        reorderedPrograms = [...programs].sort((a, b) => (b.duration || 0) - (a.duration || 0));
        break;
        
      case 'sort-duration-shortest':
        reorderedPrograms = [...programs].sort((a, b) => (a.duration || 0) - (b.duration || 0));
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
    
    // Convert episode-level reordering to the appropriate backend format
    const episodes = reorderedPrograms
      .filter(program => program.type === 'episode' && program.showId && program.episodeId)
      .map((program, index) => ({
        showId: program.showId,
        episodeId: program.episodeId,
        order: index
      }));

    const movies = reorderedPrograms
      .filter(program => program.type === 'movie' && program.movieId)
      .reduce((acc, program, index) => {
        const key = `movie-${program.movieId}`;
        if (!acc.has(key)) {
          acc.set(key, {
            id: program.movieId,
            type: 'movie' as const,
            order: index
          });
        }
        return acc;
      }, new Map());

    // Save the new order immediately (skip for clear-auto-sort)
    if (type !== 'clear-auto-sort') {
      if (episodes.length > 0) {
        // Use the new episode reordering API
        reorderEpisodesMutation.mutate({
          channelId: selectedChannelId,
          episodes: episodes
        });
      } else if (movies.size > 0) {
        // Fall back to content reordering for movies-only
        reorderContentMutation.mutate({
          channelId: selectedChannelId,
          items: Array.from(movies.values())
        });
      }
    }
    
    // Save or clear sort method for automation
    if (isSortOperation || isShuffleOperation) {
      const filterData: any = {
        id: selectedChannelId,
        autoFilterEnabled: selectedChannelQuery.data?.autoFilterEnabled || false,
        filterType: selectedChannelQuery.data?.filterType || 'both',
        defaultEpisodeOrder: selectedChannelQuery.data?.defaultEpisodeOrder || 'sequential',
        respectEpisodeOrder: selectedChannelQuery.data?.respectEpisodeOrder ?? true,
        blockShuffle: selectedChannelQuery.data?.blockShuffle || false,
        blockShuffleSize: selectedChannelQuery.data?.blockShuffleSize || 1
      };

      // Only include optional fields if they have values
      if (selectedChannelQuery.data?.filterGenres) filterData.filterGenres = selectedChannelQuery.data.filterGenres;
      if (selectedChannelQuery.data?.filterActors) filterData.filterActors = selectedChannelQuery.data.filterActors;
      if (selectedChannelQuery.data?.filterDirectors) filterData.filterDirectors = selectedChannelQuery.data.filterDirectors;
      if (selectedChannelQuery.data?.filterStudios) filterData.filterStudios = selectedChannelQuery.data.filterStudios;
      if (selectedChannelQuery.data?.filterYearStart) filterData.filterYearStart = selectedChannelQuery.data.filterYearStart;
      if (selectedChannelQuery.data?.filterYearEnd) filterData.filterYearEnd = selectedChannelQuery.data.filterYearEnd;
      if (selectedChannelQuery.data?.filterRating) filterData.filterRating = selectedChannelQuery.data.filterRating;
      
      // Handle autoSortMethod: set it for sort operations, clear it for shuffle operations
      if (isSortOperation) {
        filterData.autoSortMethod = type;
      } else if (isShuffleOperation) {
        filterData.autoSortMethod = null; // Explicitly clear it for shuffle operations
      }

      updateFiltersMutation.mutate(filterData);
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

  const onDragEnd = (result: any) => {
    if (!result.destination || !selectedChannelId) return;
    
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    
    if (sourceIndex === destinationIndex) return;
    
    const programs = getAllPrograms();
    const reorderedPrograms = Array.from(programs);
    const [removed] = reorderedPrograms.splice(sourceIndex, 1);
    reorderedPrograms.splice(destinationIndex, 0, removed);
    
    // Convert episode-level reordering to the appropriate backend format
    const episodes = reorderedPrograms
      .filter(program => program.type === 'episode' && program.showId && program.episodeId)
      .map((program, index) => ({
        showId: program.showId,
        episodeId: program.episodeId,
        order: index
      }));

    const movies = reorderedPrograms
      .filter(program => program.type === 'movie' && program.movieId)
      .reduce((acc, program, index) => {
        const key = `movie-${program.movieId}`;
        if (!acc.has(key)) {
          acc.set(key, {
            id: program.movieId,
            type: 'movie' as const,
            order: index
          });
        }
        return acc;
      }, new Map());

    // Save the new order immediately
    if (episodes.length > 0) {
      // Use the new episode reordering API
      reorderEpisodesMutation.mutate({
        channelId: selectedChannelId,
        episodes: episodes
      });
    } else if (movies.size > 0) {
      // Fall back to content reordering for movies-only
      reorderContentMutation.mutate({
        channelId: selectedChannelId,
        items: Array.from(movies.values())
      });
    }
  };

  // Get channel content for display (expanded episodes + movies like TwentyFourSeven)
  const getChannelContent = () => {
    if (!selectedChannelQuery.data) return [];
    
    const channelData = selectedChannelQuery.data as any;
    const content: any[] = [];
    
    // Get the show IDs that are in this channel
    const currentChannelShowIds = channelData.channelShows?.map((cs: any) => cs.showId) || [];
    
    // Get complete episode data from the separate query and filter to channel shows
    const completeShows = (completeShowsQuery.data || []).filter((show: any) => 
      currentChannelShowIds.includes(show.id)
    );
    const completeShowsMap = new Map(completeShows.map((show: any) => [show.id, show]));
    
    // Add all episodes from shows using complete episode data
    (channelData.channelShows || []).forEach((cs: any) => {
      const completeShow = completeShowsMap.get(cs.showId);
      
      if (completeShow?.episodes && completeShow.episodes.length > 0) {
        // Use complete episode data instead of incomplete channel data
        completeShow.episodes.forEach((episode: any) => {
          content.push({
            id: `${cs.id}-${episode.id}`,
            type: 'episode' as const,
            title: completeShow.title,
            episodeTitle: episode.title,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            poster: completeShow.poster,
            duration: episode.duration,
            order: cs.order,
            showId: completeShow.id,
            episodeId: episode.id,
            channelShowId: cs.id
          });
        });
      } else if (cs.show.episodes && cs.show.episodes.length > 0) {
        // Fallback to channel data if complete data not available
        cs.show.episodes.forEach((episode: any) => {
          content.push({
            id: `${cs.id}-${episode.id}`,
            type: 'episode' as const,
            title: cs.show.title,
            episodeTitle: episode.title,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            poster: cs.show.poster,
            duration: episode.duration,
            order: cs.order,
            showId: cs.show.id,
            episodeId: episode.id,
            channelShowId: cs.id
          });
        });
      } else {
        // Show without episodes data - display as placeholder
        content.push({
          id: `${cs.id}-placeholder`,
          type: 'show' as const,
          title: cs.show.title,
          episodeTitle: 'Episodes loading...',
          seasonNumber: 0,
          episodeNumber: 0,
          poster: cs.show.poster,
          duration: 0,
          order: cs.order,
          showId: cs.show.id,
          channelShowId: cs.id
        });
      }
    });
    
    // Add all movies
    (channelData.channelMovies || []).forEach((cm: any) => {
      content.push({
        id: cm.id,
        type: 'movie' as const,
        title: cm.movie.title,
        year: cm.movie.year,
        poster: cm.movie.poster,
        duration: cm.movie.duration,
        order: cm.order,
        movieId: cm.movie.id,
        channelMovieId: cm.id
      });
    });
    
    return content.sort((a, b) => a.order - b.order);
  };

  // Get all individual episodes and movies for reordering
  const getAllPrograms = () => {
    // Show individual episodes and movies so users can reorder them
    return getChannelContent();
  };

  // Get channel configuration (shows/movies added to channel)
  const getChannelConfiguration = () => {
    if (!selectedChannelQuery.data) return [];
    
    const channelData = selectedChannelQuery.data as any;
    
    // Get complete episode data for accurate counts
    const currentChannelShowIds = channelData.channelShows?.map((cs: any) => cs.showId) || [];
    const completeShows = (completeShowsQuery.data || []).filter((show: any) => 
      currentChannelShowIds.includes(show.id)
    );
    const completeShowsMap = new Map(completeShows.map((show: any) => [show.id, show]));
    
    const showsContent = (channelData.channelShows || []).map((cs: any, index: number) => {
      const completeShow = completeShowsMap.get(cs.showId);
      
      const episodeCount = completeShow?.episodes?.length || 
                          cs.show.episodes?.length || 
                          cs.show._count?.episodes || 
                          cs.show.episodeCount ||
                          0;
      
      const totalDuration = completeShow?.episodes?.reduce((acc: number, ep: any) => acc + (ep.duration || 0), 0) || 
                           cs.show.episodes?.reduce((acc: number, ep: any) => acc + (ep.duration || 0), 0) || 
                           cs.show.duration || 
                           0;
      
      return {
        ...cs,
        type: 'show' as const,
        title: cs.show.title,
        year: cs.show.year,
        poster: cs.show.poster,
        duration: totalDuration,
        episodeCount,
        order: cs.order ?? index
      };
    });

    const moviesContent = (channelData.channelMovies || []).map((cm: any, index: number) => ({
      ...cm,
      type: 'movie' as const,
      title: cm.movie.title,
      year: cm.movie.year,
      poster: cm.movie.poster,
      duration: cm.movie.duration,
      episodeCount: 0,
      order: cm.order ?? (channelData.channelShows?.length || 0) + index
    }));

    return [...showsContent, ...moviesContent].sort((a, b) => a.order - b.order);
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
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
          <Button variant="outline" size="sm" asChild>
            <Link href="/media.m3u">
              <span className="hidden sm:inline">Export M3U</span>
              <span className="sm:hidden">M3U</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Mobile Channel Selector */}
      <div className="md:hidden mb-6">
        {channelsQuery.data && channelsQuery.data.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Select Channel</CardTitle>
                <Button 
                  size="sm"
                  onClick={() => {
                    setNewChannel(prev => ({ ...prev, number: getNextChannelNumber() }));
                    setShowCreateForm(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
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
                          {(channel.channelShows?.length || 0) + (channel.channelMovies?.length || 0)} items
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
              <Button 
                size="sm"
                onClick={() => {
                  setNewChannel(prev => ({ ...prev, number: 1 }));
                  setShowCreateForm(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Channel
              </Button>
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
            
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateForm(false)} className="touch-manipulation">
                Cancel
              </Button>
              <Button 
                onClick={handleCreateChannel}
                disabled={!newChannel.name || createChannelMutation.isPending}
                className="touch-manipulation"
              >
                {createChannelMutation.isPending ? "Creating..." : "Create Channel"}
              </Button>
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
            
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingChannelId(null)} className="touch-manipulation">
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateChannel}
                disabled={!editChannel.name || updateChannelMutation.isPending}
                className="touch-manipulation"
              >
                {updateChannelMutation.isPending ? "Updating..." : "Update Channel"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Desktop Channels List - Left Side */}
        <div className="hidden md:block lg:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Channels</CardTitle>
                <Button 
                  size="sm"
                  onClick={() => {
                    setNewChannel(prev => ({ ...prev, number: getNextChannelNumber() }));
                    setShowCreateForm(true);
                  }}
                  className="touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Channel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {channelsQuery.isLoading ? (
                <div className="space-y-2 p-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-12 bg-muted rounded"></div>
                    </div>
                  ))}
                </div>
              ) : channelsQuery.error ? (
                <div className="p-4 text-center">
                  <p className="text-destructive">Error loading channels</p>
                </div>
              ) : !channelsQuery.data || channelsQuery.data.length === 0 ? (
                <div className="p-8 text-center">
                  <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-semibold mb-2">No channels yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first channel to get started
                  </p>
                  <Button 
                    size="sm"
                    onClick={() => {
                      setNewChannel(prev => ({ ...prev, number: 1 }));
                      setShowCreateForm(true);
                    }}
                    className="touch-manipulation"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Channel
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {(channelsQuery.data as any[]).map((channel: any) => (
                   <div
                     key={channel.id}
                     className={`group p-3 border-l-4 transition-colors touch-manipulation ${
                       selectedChannelId === channel.id
                         ? 'bg-accent border-l-primary'
                         : 'hover:bg-muted border-l-transparent'
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
                           onError={(e) => { e.currentTarget.style.display = 'none'; }}
                         />
                       )}
                       <div 
                         className="flex-1 min-w-0 cursor-pointer"
                         onClick={() => {
                           setSelectedChannelId(channel.id);
                           updateChannelInUrl(channel.id);
                         }}
                       >
                         <h4 className="font-medium text-sm truncate">{channel.name}</h4>
                         <p className="text-xs text-muted-foreground">
                           {(channel.channelShows?.length || 0) + (channel.channelMovies?.length || 0)} items
                         </p>
                       </div>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 hover:opacity-100 touch-manipulation"
                         onClick={(e) => {
                           e.stopPropagation();
                           setEditChannel({
                             id: channel.id,
                             number: channel.number,
                             name: channel.name,
                             icon: channel.icon || "",
                             groupTitle: channel.groupTitle || ""
                           });
                           setEditingChannelId(channel.id);
                         }}
                         title="Edit Channel"
                       >
                         <Edit className="w-4 h-4" />
                       </Button>
                     </div>
                   </div>
                 ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

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
          ) : selectedChannelQuery.isLoading ? (
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
          ) : !selectedChannelQuery.data ? (
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
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="text-lg px-3 py-1">
                        {selectedChannelQuery.data.number}
                      </Badge>
                      <div className="flex items-center gap-3">
                        {selectedChannelQuery.data.icon && (
                          <img 
                            src={selectedChannelQuery.data.icon} 
                            alt=""
                            className="w-8 h-8 rounded object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <div>
                          <CardTitle className="text-xl">{selectedChannelQuery.data.name}</CardTitle>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            {selectedChannelQuery.data.groupTitle && (
                              <Badge variant="secondary" className="text-xs">
                                {selectedChannelQuery.data.groupTitle}
                              </Badge>
                            )}
                            {selectedChannelQuery.data.stealth && (
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
                      <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                        <Link href={`/player?channel=${selectedChannelQuery.data.number}`}>
                          <Play className="w-4 h-4 mr-1" />
                          Watch
                        </Link>
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => deleteChannelMutation.mutate({ id: selectedChannelQuery.data!.id })}
                        disabled={deleteChannelMutation.isPending}
                        className="touch-manipulation"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>

                            {/* Programming Content - TwentyFourSeven Style */}
              <Tabs defaultValue="programming" className="space-y-6">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="programming" className="touch-manipulation">Programming</TabsTrigger>
                  <TabsTrigger value="schedule" className="touch-manipulation">Schedule</TabsTrigger>
                  <TabsTrigger value="filler" className="touch-manipulation">Filler</TabsTrigger>
                </TabsList>

                {/* Programming Tab */}
                <TabsContent value="programming">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="flex items-center gap-2">
                          <Video className="w-5 h-5" />
                          Channel Configuration
                        </CardTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleShuffleAllContent}
                            className="touch-manipulation"
                          >
                            <Shuffle className="w-4 h-4 mr-1" />
                            <span className="hidden sm:inline">Shuffle All</span>
                            <span className="sm:hidden">Shuffle</span>
                          </Button>
                          <Button 
                            onClick={() => setShowAddDialog(true)}
                            className="touch-manipulation"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            <span className="hidden sm:inline">Add Content</span>
                            <span className="sm:hidden">Add</span>
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {selectedChannelQuery.isLoading ? (
                        <div className="space-y-4">
                          <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                              <div key={i} className="h-16 bg-muted rounded"></div>
                            ))}
                          </div>
                        </div>
                      ) : getAllPrograms().length === 0 ? (
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
                      ) : (
                        <div className="space-y-4">
                          {/* Program Duration Summary */}
                          <div className="bg-muted/30 p-4 rounded-lg">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                              <div>
                                <p className="text-sm text-muted-foreground">Shows</p>
                                <p className="text-xl sm:text-2xl font-bold">
                                  {getAllPrograms().filter(item => item.type === 'show').length}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Movies</p>
                                <p className="text-xl sm:text-2xl font-bold">
                                  {getAllPrograms().filter(item => item.type === 'movie').length}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Total Items</p>
                                <p className="text-xl sm:text-2xl font-bold">{getAllPrograms().length}</p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Generated Programs</p>
                                <p className="text-xl sm:text-2xl font-bold text-primary">
                                  {channelProgramsQuery.data?.length || 0}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Mobile-Optimized Content List */}
                          <div className="md:hidden space-y-2">
                            {getAllPrograms().map((item: any, index) => (
                              <div
                                key={item.id}
                                className="bg-background border rounded-lg p-4 space-y-3 touch-manipulation"
                              >
                                {/* Content Header */}
                                <div className="flex items-start gap-3">
                                  <Badge variant="outline" className="text-xs px-2 py-1 flex-shrink-0">
                                    {index + 1}
                                  </Badge>
                                  
                                  <img 
                                    src={item.poster || "/placeholder.png"} 
                                    alt={item.title}
                                    className="w-12 h-16 object-cover rounded flex-shrink-0 border"
                                  />
                                  
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <h4 className="font-medium text-sm leading-tight">{item.title}</h4>
                                        {item.type === 'episode' && item.episodeTitle && (
                                          <p className="text-xs text-muted-foreground mt-1 leading-tight">
                                            {item.episodeTitle}
                                          </p>
                                        )}
                                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                                          {item.type === 'episode' ? (
                                            <Badge variant="secondary" className="text-xs">
                                              <Video className="w-3 h-3 mr-1" />
                                              S{item.seasonNumber}E{item.episodeNumber}
                                            </Badge>
                                          ) : (
                                            <Badge variant="secondary" className="text-xs">
                                              <Film className="w-3 h-3 mr-1" />
                                              {item.year && `${item.year}`}
                                            </Badge>
                                          )}
                                          <span className="text-xs text-muted-foreground">
                                            {item.duration > 0 ? (
                                              `${Math.floor(item.duration / 3600000)}:${String(Math.floor((item.duration % 3600000) / 60000)).padStart(2, '0')}`
                                            ) : (
                                              '--:--'
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Mobile Actions */}
                                <div className="flex items-center justify-between pt-2 border-t">
                                  <div className="flex items-center gap-2">
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      className="h-8 px-3 touch-manipulation"
                                      disabled={index === 0}
                                      onClick={() => {
                                        // Move up logic for mobile
                                        const newOrder = [...getAllPrograms()];
                                        const temp = newOrder[index];
                                        newOrder[index] = newOrder[index - 1];
                                        newOrder[index - 1] = temp;
                                        // Handle reorder mutation here
                                      }}
                                    >
                                      ↑
                                    </Button>
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      className="h-8 px-3 touch-manipulation"
                                      disabled={index === getAllPrograms().length - 1}
                                      onClick={() => {
                                        // Move down logic for mobile
                                        const newOrder = [...getAllPrograms()];
                                        const temp = newOrder[index];
                                        newOrder[index] = newOrder[index + 1];
                                        newOrder[index + 1] = temp;
                                        // Handle reorder mutation here
                                      }}
                                    >
                                      ↓
                                    </Button>
                                  </div>
                                  
                                  <Button 
                                    variant="destructive" 
                                    size="sm"
                                    className="h-8 px-3 touch-manipulation"
                                    onClick={() => {
                                      if (item.type === 'movie' && item.channelMovieId) {
                                        handleRemoveMovie(item.movieId);
                                      } else if ((item.type === 'episode' || item.type === 'show') && item.channelShowId) {
                                        handleRemoveShow(item.showId);
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop Drag-and-Drop List */}
                          <div className="hidden md:block">
                            <DragDropContext onDragEnd={onDragEnd}>
                              <Droppable droppableId="programs">
                                {(provided) => (
                                  <div
                                    {...provided.droppableProps}
                                    ref={provided.innerRef}
                                    className="space-y-1"
                                  >
                                    {getAllPrograms().map((item: any, index) => (
                                      <Draggable key={item.id} draggableId={item.id} index={index}>
                                        {(provided, snapshot) => (
                                          <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={`bg-background border rounded-lg overflow-hidden transition-all ${
                                              snapshot.isDragging 
                                                ? 'shadow-lg ring-2 ring-primary/20 rotate-1' 
                                                : 'hover:shadow-sm'
                                            }`}
                                          >
                                            <div className="flex items-center p-2">
                                              {/* Drag Handle */}
                                              <div 
                                                {...provided.dragHandleProps}
                                                className="w-6 flex justify-center mr-2 cursor-grab active:cursor-grabbing"
                                                title="Drag to reorder"
                                              >
                                                <Move className="w-3 h-3 text-muted-foreground" />
                                              </div>

                                              {/* Order Number */}
                                              <div className="w-6 text-center mr-2">
                                                <Badge variant="outline" className="text-xs w-5 h-5 p-0 flex items-center justify-center">
                                                  {index + 1}
                                                </Badge>
                                              </div>

                                              {/* Content Type Icon */}
                                              <div className="w-6 flex justify-center mr-2">
                                                {item.type === 'episode' ? (
                                                  <Video className="w-3 h-3 text-blue-500" />
                                                ) : item.type === 'movie' ? (
                                                  <Film className="w-3 h-3 text-orange-500" />
                                                ) : (
                                                  <Video className="w-3 h-3 text-green-500" />
                                                )}
                                              </div>

                                              {/* Poster */}
                                              <img 
                                                src={item.poster || "/placeholder.png"} 
                                                alt={item.title}
                                                className="w-8 h-10 object-cover rounded mr-3 border flex-shrink-0"
                                              />

                                              {/* Content Info */}
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                  <h4 className="font-medium truncate text-sm">{item.title}</h4>
                                                  {item.type === 'episode' && (
                                                    <Badge variant="secondary" className="text-xs px-1 py-0 h-4 flex-shrink-0">
                                                      S{item.seasonNumber}E{item.episodeNumber}
                                                    </Badge>
                                                  )}
                                                  {item.type === 'movie' && item.year && (
                                                    <Badge variant="secondary" className="text-xs px-1 py-0 h-4 flex-shrink-0">
                                                      {item.year}
                                                    </Badge>
                                                  )}
                                                </div>
                                                
                                                {item.type === 'episode' && item.episodeTitle && (
                                                  <p className="text-xs text-muted-foreground truncate">
                                                    {item.episodeTitle}
                                                  </p>
                                                )}
                                              </div>

                                              {/* Duration */}
                                              <div className="text-right text-xs mr-3 flex-shrink-0">
                                                <div className="font-mono font-medium">
                                                  {item.duration > 0 ? (
                                                    `${Math.floor(item.duration / 3600000)}:${String(Math.floor((item.duration % 3600000) / 60000)).padStart(2, '0')}`
                                                  ) : (
                                                    '--:--'
                                                  )}
                                                </div>
                                              </div>

                                              {/* Actions */}
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                {(item.type === 'movie' && item.channelMovieId) && (
                                                  <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    title="Remove Movie from Channel"
                                                    onClick={() => handleRemoveMovie(item.movieId)}
                                                  >
                                                    <Trash2 className="w-3 h-3 text-destructive" />
                                                  </Button>
                                                )}
                                                {(item.type === 'episode' && item.channelShowId) && (
                                                  <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    title="Remove Show from Channel"
                                                    onClick={() => handleRemoveShow(item.showId)}
                                                  >
                                                    <Trash2 className="w-3 h-3 text-destructive" />
                                                  </Button>
                                                )}
                                                {(item.type === 'show' && item.channelShowId) && (
                                                  <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    title="Remove Show from Channel"
                                                    onClick={() => handleRemoveShow(item.showId)}
                                                  >
                                                    <Trash2 className="w-3 h-3 text-destructive" />
                                                  </Button>
                                                )}
                                                <Button 
                                                  variant="ghost" 
                                                  size="sm"
                                                  className="h-6 w-6 p-0"
                                                  title="View Details"
                                                  disabled
                                                >
                                                  <Settings className="w-3 h-3" />
                                                </Button>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </Draggable>
                                    ))}
                                    {provided.placeholder}
                                  </div>
                                )}
                              </Droppable>
                            </DragDropContext>
                          </div>
                        </div>
                      )}
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
                        <Button variant="outline" disabled className="touch-manipulation">
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Generate Schedule
                        </Button>
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
                        <Button variant="outline" disabled className="touch-manipulation">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Filler
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-8 sm:py-12">
                        <Music className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg sm:text-xl font-semibold mb-2">No filler content</h3>
                        <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                          Add commercials, bumpers, and other filler content to enhance your channel
                        </p>
                        <Button variant="outline" disabled className="touch-manipulation">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Filler Content
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

        {/* Sidebar - Programming Tools */}
        {selectedChannelId && selectedChannelQuery.data && (
          <div className="lg:col-span-1 space-y-6">
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
                    disabled={reorderContentMutation.isPending || getAllPrograms().length === 0}
                  >
                    <Shuffle className="w-4 h-4 mr-2" />
                    {reorderContentMutation.isPending ? "Shuffling..." : "Quick Shuffle"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden md:block space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Schedule Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Shows</p>
                      <p className="text-2xl font-bold">{selectedChannelQuery.data.channelShows?.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Movies</p>
                      <p className="text-2xl font-bold">{selectedChannelQuery.data.channelMovies?.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Filler</p>
                      <p className="text-2xl font-bold">{(selectedChannelQuery.data as any).fillerContent?.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Items</p>
                      <p className="text-2xl font-bold text-primary">
                        {(selectedChannelQuery.data.channelShows?.length || 0) + 
                         (selectedChannelQuery.data.channelMovies?.length || 0) + 
                         ((selectedChannelQuery.data as any).fillerContent?.length || 0)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
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
                  
                  {/* Quick Shuffle Button */}
                  <Button 
                    className="w-full touch-manipulation" 
                    variant="outline"
                    onClick={() => handleSmartShuffle('shuffle-all')}
                    disabled={reorderContentMutation.isPending || getAllPrograms().length === 0}
                  >
                    <Shuffle className="w-4 h-4 mr-2" />
                    {reorderContentMutation.isPending ? "Shuffling..." : "Quick Shuffle"}
                  </Button>
                  
                  {/* Smart Shuffle/Sort Dropdown */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Advanced Reorder</Label>
                      {getAllPrograms().length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {getAllPrograms().length} items
                        </Badge>
                      )}
                    </div>
                    <Select 
                      value={selectedChannelQuery.data?.autoSortMethod || ""}
                      onValueChange={(value) => {
                        if (value && value !== 'placeholder') {
                          handleSmartShuffle(value);
                        }
                      }}
                      disabled={reorderContentMutation.isPending || getAllPrograms().length === 0}
                    >
                      <SelectTrigger className="w-full touch-manipulation">
                        <SelectValue placeholder={
                          reorderContentMutation.isPending 
                            ? "Reordering..." 
                            : getAllPrograms().length === 0
                            ? "No content to sort"
                            : selectedChannelQuery.data?.autoSortMethod 
                            ? `Auto: ${getAutoSortDisplayName(selectedChannelQuery.data.autoSortMethod)}`
                            : "Choose advanced option"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Current Auto-Sort Status */}
                        {selectedChannelQuery.data?.autoSortMethod && (
                          <>
                            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Current Auto-Sort
                            </div>
                            <SelectItem value="clear-auto-sort">
                              <div className="flex items-center gap-2">
                                <X className="w-4 h-4" />
                                <span>Clear Auto-Sort ({getAutoSortDisplayName(selectedChannelQuery.data.autoSortMethod)})</span>
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
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RotateCcw className="w-3 h-3 animate-spin" />
                        <span>Saving new order...</span>
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    className="w-full touch-manipulation" 
                    variant="outline"
                    onClick={handleViewGrid}
                    disabled
                    title="Grid view coming soon"
                  >
                    <Grid3X3 className="w-4 h-4 mr-2" />
                    View Grid
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Programming Rules</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
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
                      <SelectTrigger className="touch-manipulation">
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
                    <Label htmlFor="respect-order">Respect Episode Order</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch 
                      id="block-shuffle" 
                      checked={blockShuffle}
                      onCheckedChange={handleBlockShuffleChange}
                      disabled={updateChannelSettingsMutation.isPending}
                      className="touch-manipulation"
                    />
                    <Label htmlFor="block-shuffle">Block Shuffle</Label>
                  </div>
                </CardContent>
              </Card>
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
          existingShows={selectedChannelQuery.data ? (selectedChannelQuery.data as any).channelShows || [] : []}
          existingMovies={selectedChannelQuery.data ? (selectedChannelQuery.data as any).channelMovies || [] : []}
          existingChannelData={selectedChannelQuery.data}
          onAddShows={handleAddShow}
          onAddMovies={handleAddMovie}
          onSaveAutomation={handleSaveAutomation}
        />
      )}

    </div>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <ChannelsPageContent />
    </Suspense>
  );
}