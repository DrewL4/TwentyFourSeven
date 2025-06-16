"use client";

import Image from "next/image";
import { useState } from "react";
import { Film, Tv, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptimizedPosterProps {
  src?: string | null;
  alt: string;
  title: string;
  type?: 'movie' | 'show' | 'music';
  className?: string;
  priority?: boolean;
}

export function OptimizedPoster({ 
  src, 
  alt, 
  title, 
  type = 'movie', 
  className,
  priority = false 
}: OptimizedPosterProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const getIcon = () => {
    switch (type) {
      case 'show': return Tv;
      case 'movie': return Film;
      default: return ImageIcon;
    }
  };

  const Icon = getIcon();

  // If no src is provided, show fallback immediately
  if (!src) {
    return (
      <div className={cn(
        "relative w-full aspect-[2/3] bg-muted rounded-md overflow-hidden group border-2 border-dashed border-gray-300 flex flex-col items-center justify-center",
        className
      )}>
        <Icon className="w-12 h-12 text-gray-400 mb-2" />
        <div className="text-xs text-gray-500 text-center px-2">
          No Image Available
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "relative w-full aspect-[2/3] bg-muted rounded-md overflow-hidden group",
      className
    )}>
      {/* Next.js optimized image */}
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        className={cn(
          "object-cover transition-all duration-300 group-hover:scale-105",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={() => {
          setIsLoaded(true);
        }}
        onError={() => {
          setHasError(true);
        }}
        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
        unoptimized={src.includes('plex.direct') || src.includes('192.168') || src.includes('127.0.0.1') || src.includes('localhost')}
      />

      {/* Loading state */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse flex items-center justify-center">
          <div className="text-xs text-gray-500">Loading...</div>
        </div>
      )}

      {/* Error fallback */}
      {hasError && (
        <div className="absolute inset-0 bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center">
          <Icon className="w-12 h-12 text-gray-400 mb-2" />
          <div className="text-xs text-gray-500 text-center px-2">
            Failed to Load Image
          </div>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
} 