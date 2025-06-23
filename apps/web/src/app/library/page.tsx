"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { OptimizedPoster } from "@/components/ui/optimized-poster";
import { Library, Plus, Folder, File, Video, Search, Film, Tv, Music } from "lucide-react";
import { useState } from "react";

export default function LibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLibrary, setSelectedLibrary] = useState<string>("");

  // Fetch servers with libraries
  const serversQuery = useQuery(orpc.servers.list.queryOptions());
  
  // Debug query to see what's actually in the database
  const debugQuery = useQuery(orpc.library.debug.queryOptions());
  
  // Fetch shows and movies
  const showsQuery = useQuery(orpc.library.shows.queryOptions({
    input: {
      search: searchQuery || undefined,
      libraryId: selectedLibrary || undefined,
      limit: 20000 // Large limit to get all content
    }
  }));
  
  const moviesQuery = useQuery(orpc.library.movies.queryOptions({
    input: {
      search: searchQuery || undefined,
      libraryId: selectedLibrary || undefined,
      limit: 10000 // Large limit to get all content
    }
  }));

  // NEW: Fetch collections
  const collectionsQuery = useQuery(orpc.library.collections.queryOptions({
    input: {
      search: searchQuery || undefined,
      limit: 10000
    }
  }));

  // Loading states
  const isLoading = serversQuery.isLoading || showsQuery.isLoading || moviesQuery.isLoading || collectionsQuery.isLoading;
  const hasError = serversQuery.error || showsQuery.error || moviesQuery.error || collectionsQuery.error;

  // Calculate totals
  const servers = serversQuery.data || [];
  const allLibraries = servers.flatMap(server => server.libraries || []);
  const totalShows = showsQuery.data?.length || 0;
  const totalMovies = moviesQuery.data?.length || 0;
  const totalVideos = totalShows + totalMovies;
  const totalCollections = collectionsQuery.data?.length || 0;

  const getLibraryIcon = (type: string) => {
    switch (type) {
      case 'MOVIE': return Film;
      case 'SHOW': return Tv;
      case 'MUSIC': return Music;
      default: return Folder;
    }
  };

  const getLibraryColor = (type: string) => {
    switch (type) {
      case 'MOVIE': return 'bg-blue-600';
      case 'SHOW': return 'bg-green-600';
      case 'MUSIC': return 'bg-purple-600';
      default: return 'bg-gray-600';
    }
  };

  // Show error state
  if (hasError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <Library className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Media Library</h1>
              <p className="text-muted-foreground">Browse your synced Plex libraries and content</p>
            </div>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <Library className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Error Loading Library</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              There was an error loading your media library. Please check your Plex server connection and try again.
            </p>
            <Button onClick={() => {
              serversQuery.refetch();
              showsQuery.refetch();
              moviesQuery.refetch();
            }}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
            <Library className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Media Library</h1>
            <p className="text-muted-foreground">Browse your synced Plex libraries and content</p>
          </div>
        </div>
      </div>

      {/* Library Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="w-5 h-5" />
              Total Content
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVideos}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {totalShows} shows, {totalMovies} movies
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Folder className="w-5 h-5" />
              Libraries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allLibraries.length}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Synced from {servers.filter(s => s.type === 'PLEX').length} Plex servers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <File className="w-5 h-5" />
              Servers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers.filter(s => s.type === 'PLEX' && s.active).length}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Active Plex connections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Folder className="w-5 h-5" />
              Collections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCollections}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Plex collections detected
            </p>
          </CardContent>
        </Card>
      </div>

      {allLibraries.length === 0 ? (
        /* Empty State */
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Library className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Libraries Found</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Connect a Plex server and sync libraries to see your content here. Go to Settings → Plex to get started.
            </p>
            <Button asChild>
              <a href="/settings/plex">
                <Plus className="w-4 h-4 mr-2" />
                Add Plex Server
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Search and Filter */}
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search shows and movies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              value={selectedLibrary}
              onChange={(e) => setSelectedLibrary(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background"
            >
              <option value="">All Libraries</option>
              {allLibraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} ({library.type})
                </option>
              ))}
            </select>
          </div>

          {/* Libraries Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {allLibraries.map((library) => {
              const IconComponent = getLibraryIcon(library.type);
              const colorClass = getLibraryColor(library.type);
              
              return (
                <Card key={library.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <div className={`w-8 h-8 ${colorClass} rounded-lg flex items-center justify-center`}>
                        <IconComponent className="w-4 h-4 text-white" />
                      </div>
                      {library.name}
                    </CardTitle>
                    <CardDescription>
                      <Badge variant="outline">{library.type}</Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      {library.shows?.length || 0} shows, {library.movies?.length || 0} movies
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Content Lists */}
          {isLoading ? (
            <div className="space-y-8">
              {/* Shows Loading Skeleton */}
              <div>
                <div className="h-8 bg-gray-200 rounded w-32 mb-4 animate-pulse"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="aspect-[2/3] bg-gray-200 rounded-md mb-3 animate-pulse"></div>
                        <div className="h-5 bg-gray-200 rounded mb-2 animate-pulse"></div>
                        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2 animate-pulse"></div>
                        <div className="h-6 bg-gray-200 rounded w-16 animate-pulse"></div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              
              {/* Movies Loading Skeleton */}
              <div>
                <div className="h-8 bg-gray-200 rounded w-24 mb-4 animate-pulse"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="aspect-[2/3] bg-gray-200 rounded-md mb-3 animate-pulse"></div>
                        <div className="h-5 bg-gray-200 rounded mb-2 animate-pulse"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2 animate-pulse"></div>
                        <div className="h-6 bg-gray-200 rounded w-16 animate-pulse"></div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {(showsQuery.data && showsQuery.data.length > 0) && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">TV Shows</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                    {showsQuery.data.map((show, index) => (
                      <Card key={show.id} className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                        <CardContent className="p-4">
                          <OptimizedPoster
                            src={show.poster}
                            alt={`${show.title} poster`}
                            title={show.title}
                            type="show"
                            priority={index < 4} // Prioritize first 4 images
                            className="mb-3"
                          />
                          <h3 className="font-semibold line-clamp-1">{show.title}</h3>
                          <p className="text-sm text-muted-foreground">
                            {show.year} • {show.episodes?.length || 0} episodes
                          </p>
                          <Badge variant="outline" className="mt-2">{show.library?.name}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {(moviesQuery.data && moviesQuery.data.length > 0) && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">Movies</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                    {moviesQuery.data.map((movie, index) => (
                      <Card key={movie.id} className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                        <CardContent className="p-4">
                          <OptimizedPoster
                            src={movie.poster}
                            alt={`${movie.title} poster`}
                            title={movie.title}
                            type="movie"
                            priority={index < 4} // Prioritize first 4 images
                            className="mb-3"
                          />
                          <h3 className="font-semibold line-clamp-1">{movie.title}</h3>
                          <p className="text-sm text-muted-foreground">
                            {movie.year}
                          </p>
                          <Badge variant="outline" className="mt-2">{movie.library?.name}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {(collectionsQuery.data && collectionsQuery.data.length > 0) && (
                <div>
                  <h2 className="text-2xl font-bold mb-4">Collections</h2>
                  <div className="flex flex-wrap gap-2">
                    {(collectionsQuery.data as { name: string; count: number }[]).map((col) => (
                      <Badge key={col.name} variant="outline" className="px-3 py-1 text-sm">
                        {col.name} <span className="ml-1 text-muted-foreground">({col.count})</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* No content message */}
              {!isLoading && showsQuery.data?.length === 0 && moviesQuery.data?.length === 0 && allLibraries.length > 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <Video className="w-16 h-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold mb-2">No Content Found</h3>
                    <p className="text-muted-foreground text-center mb-6 max-w-md">
                      {searchQuery || selectedLibrary ? 
                        "No shows or movies match your current search criteria. Try adjusting your filters." :
                        "Your libraries are connected but no content has been synced yet. Check your Plex server settings."
                      }
                    </p>
                    {(searchQuery || selectedLibrary) && (
                      <Button onClick={() => {
                        setSearchQuery("");
                        setSelectedLibrary("");
                      }}>
                        Clear Filters
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
} 