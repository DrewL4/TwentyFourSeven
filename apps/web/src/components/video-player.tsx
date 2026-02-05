"use client"

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface VideoPlayerProps {
  url: string;
  title?: string;
  isOpen: boolean;
  onClose: () => void;
  posterImage?: string;
  autoPlay?: boolean;
  startTime?: number;
  isLiveTV?: boolean;
  channelNumber?: number;
  /** Catchup/timeshift mode: play a past programme */
  isCatchup?: boolean;
  /** ISO-8601 time of the programme to catch up to */
  catchupTime?: string;
  /** Program ID for catchup (alternative to time) */
  catchupProgramId?: string;
}

export default function VideoPlayer({
  url,
  title,
  isOpen,
  onClose,
  posterImage,
  autoPlay = true,
  startTime = 0,
  isLiveTV = false,
  channelNumber,
  isCatchup = false,
  catchupTime,
  catchupProgramId,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  
  // Stalled playback detection
  const lastPlaybackTimeRef = useRef<number>(0);
  const stalledCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const noProgressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Configuration
  const MAX_RETRIES = 3;
  const STALLED_THRESHOLD = 5000; // 5 seconds without progress
  const NO_PROGRESS_THRESHOLD = 10000; // 10 seconds without any progress
  const RECONNECT_DELAY = 2000; // 2 seconds before reconnecting

  // Build video URL with channel parameter if provided
  const getVideoUrl = useCallback(() => {
    if (channelNumber) {
      const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
      let videoUrl = `${serverUrl}/api/video?channel=${channelNumber}`;

      // Catchup mode: append catchup params
      if (isCatchup && catchupTime) {
        videoUrl += `&catchup=true&time=${encodeURIComponent(catchupTime)}`;
      }

      return videoUrl;
    }
    return url;
  }, [url, channelNumber, isCatchup, catchupTime]);

  const [currentUrl, setCurrentUrl] = useState(getVideoUrl());

  // Reset on URL or open change
  useEffect(() => {
    if (isOpen) {
      setCurrentUrl(getVideoUrl());
      setRetryCount(0);
      setError(null);
      setIsRecovering(false);
      setRecoveryMessage(null);
    }
  }, [isOpen, getVideoUrl]);

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setIsBuffering(false);
      video.volume = volume;
      if (startTime > 0 && !isLiveTV) {
        video.currentTime = startTime;
      }
      if (autoPlay) {
        video.play().catch((err) => {
          console.error('Autoplay failed:', err);
          setError('Autoplay blocked. Please click play to start.');
        });
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      lastPlaybackTimeRef.current = Date.now();
      setIsBuffering(false);
      
      // Clear any stalled timeouts
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
    };

    const handleWaiting = () => {
      setIsBuffering(true);
    };

    const handleCanPlay = () => {
      setIsBuffering(false);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (!isLiveTV) {
        onClose();
      }
    };

    const handleError = (e: Event) => {
      const errorElement = e.target as HTMLVideoElement;
      const errorCode = errorElement.error;
      let errorMessage = 'Unknown error occurred';

      if (errorCode) {
        switch (errorCode.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = 'Video playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = 'Network error. Attempting to reconnect...';
            attemptReconnect('network');
            return;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = 'Video decode error';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Video format not supported';
            break;
        }
      }

      console.error('Video error:', errorCode, errorMessage);
      setError(errorMessage);
      
      // Attempt recovery for network errors
      if (errorCode?.code === MediaError.MEDIA_ERR_NETWORK) {
        attemptReconnect('network');
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [autoPlay, startTime, isLiveTV, onClose]);

  // Stalled playback detection
  useEffect(() => {
    if (!isOpen || !isPlaying) {
      // Clear intervals when not playing
      if (stalledCheckIntervalRef.current) {
        clearInterval(stalledCheckIntervalRef.current);
        stalledCheckIntervalRef.current = null;
      }
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
      return;
    }

    // Check for stalled playback periodically
    stalledCheckIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;

      const now = Date.now();
      const timeSinceLastProgress = now - lastPlaybackTimeRef.current;
      const currentVideoTime = video.currentTime;

      // Check if video time hasn't progressed
      if (timeSinceLastProgress > STALLED_THRESHOLD) {
        // Video might be stalled - check if currentTime changed
        if (Math.abs(currentVideoTime - currentTime) < 0.1) {
          // No progress detected
          if (!noProgressTimeoutRef.current) {
            noProgressTimeoutRef.current = setTimeout(() => {
              console.warn('Playback stalled - no progress detected');
              attemptReconnect('stalled');
            }, NO_PROGRESS_THRESHOLD - STALLED_THRESHOLD);
          }
        } else {
          // Progress detected, clear timeout
          if (noProgressTimeoutRef.current) {
            clearTimeout(noProgressTimeoutRef.current);
            noProgressTimeoutRef.current = null;
          }
          lastPlaybackTimeRef.current = now;
        }
      }
    }, 1000); // Check every second

    return () => {
      if (stalledCheckIntervalRef.current) {
        clearInterval(stalledCheckIntervalRef.current);
        stalledCheckIntervalRef.current = null;
      }
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
    };
  }, [isOpen, isPlaying, currentTime]);

  // Attempt to reconnect/recover playback
  const attemptReconnect = useCallback((reason: 'network' | 'stalled' | 'error') => {
    if (retryCount >= MAX_RETRIES) {
      setError(`Failed to recover after ${MAX_RETRIES} attempts. Please refresh the page.`);
      setIsRecovering(false);
      return;
    }

    setIsRecovering(true);
    setRetryCount((prev) => prev + 1);
    
    const messages = {
      network: 'Network error detected. Reconnecting...',
      stalled: 'Playback stalled. Reconnecting...',
      error: 'Error detected. Attempting to recover...',
    };
    setRecoveryMessage(messages[reason] || 'Reconnecting...');

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Wait before reconnecting
    reconnectTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;

      const currentVideoTime = video.currentTime;
      const wasPlaying = !video.paused;

      // Create new URL with timestamp to force reload
      const separator = currentUrl.includes('?') ? '&' : '?';
      const newUrl = `${currentUrl}${separator}_reconnect=${Date.now()}`;
      
      // Save state
      const savedVolume = video.volume;
      const savedMuted = video.muted;

      // Reload video source
      video.src = newUrl;
      video.load();

      // Restore state after loading
      video.addEventListener('loadedmetadata', () => {
        if (wasPlaying && !isLiveTV) {
          video.currentTime = currentVideoTime;
        }
        video.volume = savedVolume;
        video.muted = savedMuted;
        
        if (wasPlaying) {
          video.play()
            .then(() => {
              setIsRecovering(false);
              setRecoveryMessage(null);
              setError(null);
              lastPlaybackTimeRef.current = Date.now();
            })
            .catch((err) => {
              console.error('Failed to resume playback after reconnect:', err);
              setIsRecovering(false);
              setRecoveryMessage(null);
              setError('Failed to resume playback. Please try again.');
            });
        } else {
          setIsRecovering(false);
          setRecoveryMessage(null);
        }
      }, { once: true });

      setCurrentUrl(newUrl);
    }, RECONNECT_DELAY);
  }, [retryCount, currentUrl, isLiveTV, MAX_RETRIES, RECONNECT_DELAY]);

  // Manual retry
  const handleRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    attemptReconnect('error');
  }, [attemptReconnect]);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!isOpen) {
      // Clear all intervals and timeouts
      if (stalledCheckIntervalRef.current) {
        clearInterval(stalledCheckIntervalRef.current);
        stalledCheckIntervalRef.current = null;
      }
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case ' ':
          e.preventDefault();
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
          break;
        case 'm':
        case 'M':
          video.muted = !video.muted;
          setIsMuted(video.muted);
          break;
        case 'ArrowLeft':
          if (!isLiveTV || isCatchup) {
            video.currentTime = Math.max(0, video.currentTime - 10);
          }
          break;
        case 'ArrowRight':
          if (!isLiveTV || isCatchup) {
            video.currentTime = Math.min(video.duration, video.currentTime + 10);
          }
          break;
        case 'ArrowUp':
          setVolume(Math.min(1, volume + 0.1));
          video.volume = Math.min(1, volume + 0.1);
          break;
        case 'ArrowDown':
          setVolume(Math.max(0, volume - 0.1));
          video.volume = Math.max(0, volume - 0.1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, onClose, volume, isLiveTV]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={(e) => {
        if (e.target === containerRef.current) {
          onClose();
        }
      }}
    >
      {/* Video Element */}
      <div className="relative w-full h-full flex items-center justify-center">
        <video
          ref={videoRef}
          src={currentUrl}
          poster={posterImage}
          className="max-w-full max-h-full"
          playsInline
          muted={isMuted}
          autoPlay={autoPlay}
        />

        {/* Recovery Overlay */}
        {isRecovering && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20">
            <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
            <p className="text-white text-lg mb-2">{recoveryMessage}</p>
            <p className="text-white/70 text-sm">Attempt {retryCount} of {MAX_RETRIES}</p>
          </div>
        )}

        {/* Error Overlay */}
        {error && !isRecovering && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <p className="text-white text-lg mb-4">{error}</p>
            {retryCount < MAX_RETRIES && (
              <Button onClick={handleRetry} variant="default" className="mb-2">
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Connection
              </Button>
            )}
          </div>
        )}

        {/* Buffering Overlay */}
        {isBuffering && !error && !isRecovering && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
            <div className="flex flex-col items-center">
              <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
              <p className="text-white text-sm">Buffering...</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {title && (
                <h2 className="text-white text-lg font-semibold truncate">{title}</h2>
              )}
              {isCatchup ? (
                <span className="px-2 py-1 bg-amber-500 text-white text-xs rounded font-medium">CATCHUP</span>
              ) : isLiveTV ? (
                <span className="px-2 py-1 bg-red-500 text-white text-xs rounded">LIVE</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {/* Jump to Live button (only in catchup mode) */}
              {isCatchup && channelNumber && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Switch from catchup to live by reloading without catchup params
                    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
                    const liveUrl = `${serverUrl}/api/video?channel=${channelNumber}`;
                    const video = videoRef.current;
                    if (video) {
                      video.src = liveUrl;
                      video.load();
                      video.play().catch(() => {});
                    }
                    setCurrentUrl(liveUrl);
                  }}
                  className="text-white hover:bg-white/20 text-xs"
                >
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Jump to Live
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-white hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-30">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  if (video.paused) {
                    video.play();
                  } else {
                    video.pause();
                  }
                }
              }}
              className="text-white hover:bg-white/20"
            >
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
            </Button>

            {(!isLiveTV || isCatchup) && (
              <div className="flex items-center gap-2 text-white text-sm flex-1">
                <span>{Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(0).padStart(2, '0')}</span>
                <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isCatchup ? "bg-amber-400" : "bg-white"
                    )}
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
                <span>{Math.floor(duration / 60)}:{(duration % 60).toFixed(0).padStart(2, '0')}</span>
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  video.muted = !video.muted;
                  setIsMuted(video.muted);
                }
              }}
              className="text-white hover:bg-white/20"
            >
              {isMuted ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </Button>

            <div className="w-24 flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={(e) => {
                  const newVolume = parseFloat(e.target.value);
                  setVolume(newVolume);
                  const video = videoRef.current;
                  if (video) {
                    video.volume = newVolume;
                    video.muted = newVolume === 0;
                    setIsMuted(newVolume === 0);
                  }
                }}
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

