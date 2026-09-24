"use client"

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, AlertCircle, Loader2, Maximize, Minimize, Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getServerUrl } from '@/utils/server-url';

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
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Stalled playback detection
  const lastPlaybackTimeRef = useRef<number>(0);
  const stalledCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const noProgressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const attemptReconnectRef = useRef<(reason: 'network' | 'stalled' | 'error') => void>(() => {});
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectInFlightRef = useRef(false);
  const sustainedPlayStartedAtRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const isBufferingRef = useRef(false);
  const lastNetworkActivityRef = useRef<number>(0);
  
  // Live TV (Tesla/LTE): buffering is normal. Only hard-reconnect on real
  // network/fatal errors — never because the playhead paused to refill.
  const MAX_RETRIES = channelNumber ? 10 : 3;
  const STALLED_THRESHOLD = channelNumber ? 45000 : 5000;
  const NO_PROGRESS_THRESHOLD = channelNumber ? 90000 : 10000;
  const RECONNECT_DELAY = channelNumber ? 3500 : 2000;
  const CONTROLS_HIDE_MS = 3200;
  const RETRY_RESET_AFTER_MS = 20000;
  const NETWORK_IDLE_BEFORE_RECONNECT_MS = 45000;

  // Build video URL with channel parameter if provided
  const getVideoUrl = useCallback(() => {
    if (channelNumber) {
      const serverUrl = getServerUrl();
      let videoUrl = `${serverUrl}/api/video?channel=${channelNumber}&browser=1`;

      // Catchup mode: append catchup params
      if (isCatchup && catchupTime) {
        videoUrl += `&catchup=true&time=${encodeURIComponent(catchupTime)}`;
      }

      return videoUrl;
    }
    return url;
  }, [url, channelNumber, isCatchup, catchupTime]);

  const withReconnectParam = useCallback((baseUrl: string) => {
    try {
      const absolute = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      absolute.searchParams.delete('_reconnect');
      absolute.searchParams.set('_reconnect', `${Date.now()}`);
      return absolute.toString();
    } catch {
      return getVideoUrl();
    }
  }, [getVideoUrl]);

  const [currentUrl, setCurrentUrl] = useState(channelNumber ? '' : url);

  // Reset on URL or open change
  useEffect(() => {
    if (isOpen) {
      setCurrentUrl(getVideoUrl());
      setRetryCount(0);
      retryCountRef.current = 0;
      setError(null);
      setIsRecovering(false);
      setRecoveryMessage(null);
      lastPlaybackTimeRef.current = Date.now();
      sustainedPlayStartedAtRef.current = 0;
      reconnectInFlightRef.current = false;
      isBufferingRef.current = false;
      lastNetworkActivityRef.current = Date.now();
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
      isBufferingRef.current = false;
      setIsBuffering(false);
      if (sustainedPlayStartedAtRef.current === 0 && video.currentTime > 1) {
        sustainedPlayStartedAtRef.current = Date.now();
      }
      if (
        sustainedPlayStartedAtRef.current > 0 &&
        Date.now() - sustainedPlayStartedAtRef.current >= RETRY_RESET_AFTER_MS &&
        retryCountRef.current > 0
      ) {
        retryCountRef.current = 0;
        setRetryCount(0);
      }
      
      // Clear any stalled timeouts
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
    };

    const handleWaiting = () => {
      isBufferingRef.current = true;
      setIsBuffering(true);
      // Buffering is expected — keep the connection; do not reconnect.
      lastPlaybackTimeRef.current = Date.now();
      if (noProgressTimeoutRef.current) {
        clearTimeout(noProgressTimeoutRef.current);
        noProgressTimeoutRef.current = null;
      }
    };

    const handleCanPlay = () => {
      isBufferingRef.current = false;
      setIsBuffering(false);
      lastPlaybackTimeRef.current = Date.now();
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      setIsRecovering(false);
      setRecoveryMessage(null);
      setError(null);
      reconnectInFlightRef.current = false;
      lastPlaybackTimeRef.current = Date.now();
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
      if (channelNumber) {
        return;
      }
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
  }, [autoPlay, startTime, isLiveTV, channelNumber, onClose]);

  // Stalled playback detection — VOD only. Live keeps one connection and
  // shows buffering instead of tearing the stream down on a quiet playhead.
  useEffect(() => {
    if (!isOpen || !isPlaying || channelNumber) {
      // Clear intervals when not playing / live
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
      if (
        reconnectInFlightRef.current ||
        isBufferingRef.current ||
        video.readyState < 2 ||
        video.currentTime < 0.25
      ) {
        lastPlaybackTimeRef.current = Date.now();
        return;
      }

      const now = Date.now();
      const timeSinceLastProgress = now - lastPlaybackTimeRef.current;
      const currentVideoTime = video.currentTime;

      if (timeSinceLastProgress > STALLED_THRESHOLD) {
        if (Math.abs(currentVideoTime - currentTime) < 0.1) {
          if (!noProgressTimeoutRef.current) {
            noProgressTimeoutRef.current = setTimeout(() => {
              console.warn('Playback stalled - no progress detected');
              attemptReconnectRef.current('stalled');
            }, NO_PROGRESS_THRESHOLD - STALLED_THRESHOLD);
          }
        } else {
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
  }, [isOpen, isPlaying, currentTime, channelNumber, STALLED_THRESHOLD, NO_PROGRESS_THRESHOLD]);

  // Attempt to reconnect/recover playback
  const attemptReconnect = useCallback((reason: 'network' | 'stalled' | 'error') => {
    if (reconnectInFlightRef.current) {
      return;
    }
    if (retryCountRef.current >= MAX_RETRIES) {
      setError(`Failed to recover after ${MAX_RETRIES} attempts. Please refresh the page.`);
      setIsRecovering(false);
      return;
    }

    reconnectInFlightRef.current = true;
    setIsRecovering(true);
    retryCountRef.current += 1;
    setRetryCount(retryCountRef.current);
    sustainedPlayStartedAtRef.current = 0;
    
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
      if (!video) {
        reconnectInFlightRef.current = false;
        return;
      }

      const currentVideoTime = video.currentTime;
      const wasPlaying = !video.paused;
      const baseUrl = channelNumber ? getVideoUrl() : (currentUrl || url);
      if (!baseUrl || baseUrl.startsWith('?')) {
        reconnectInFlightRef.current = false;
        setIsRecovering(false);
        setRecoveryMessage(null);
        setError('Stream URL is missing. Close and try again.');
        return;
      }
      const newUrl = withReconnectParam(baseUrl);
      if (channelNumber) {
        setCurrentUrl(newUrl);
        return;
      }
      
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
              reconnectInFlightRef.current = false;
              setIsRecovering(false);
              setRecoveryMessage(null);
              setError(null);
              lastPlaybackTimeRef.current = Date.now();
            })
            .catch((err) => {
              console.error('Failed to resume playback after reconnect:', err);
              reconnectInFlightRef.current = false;
              setIsRecovering(false);
              setRecoveryMessage(null);
              setError('Failed to resume playback. Please try again.');
            });
        } else {
          reconnectInFlightRef.current = false;
          setIsRecovering(false);
          setRecoveryMessage(null);
        }
      }, { once: true });

      setCurrentUrl(newUrl);
    }, RECONNECT_DELAY);
  }, [currentUrl, url, isLiveTV, channelNumber, getVideoUrl, withReconnectParam, MAX_RETRIES, RECONNECT_DELAY]);

  attemptReconnectRef.current = attemptReconnect;

  // Browsers cannot play video/mp2t on a <video> element. Transmux MPEG-TS
  // in the page and keep the request on this site, not a baked-in localhost URL.
  useEffect(() => {
    if (!isOpen || !channelNumber || !currentUrl || currentUrl.startsWith('?')) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const session = { cancelled: false, player: null as {
      destroy: () => void;
      pause: () => void;
      unload: () => void;
      detachMediaElement: () => void;
    } | null };

    const start = async () => {
      const mpegtsModule = await import('mpegts.js');
      const mpegts = mpegtsModule.default;
      if (session.cancelled) {
        return;
      }
      if (!mpegts.isSupported()) {
        setError('This browser cannot play the live stream.');
        setIsBuffering(false);
        setIsRecovering(false);
        return;
      }

      const live = !currentUrl.includes('catchup=true');
      const player = mpegts.createPlayer(
        { type: 'mse', isLive: live, url: currentUrl },
        {
          enableWorker: false,
          enableStashBuffer: true,
          // Larger stash = longer cushion on LTE before the playhead starves.
          stashInitialSize: 3 * 1024 * 1024,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 90,
          autoCleanupMinBackwardDuration: 30,
          // Do not chase the live edge — keep a buffer cushion instead.
          liveBufferLatencyChasing: false,
          liveSync: false,
        },
      );
      if (session.cancelled) {
        player.destroy();
        return;
      }
      session.player = player;
      lastNetworkActivityRef.current = Date.now();
      player.on(mpegts.Events.STATISTICS_INFO, () => {
        lastNetworkActivityRef.current = Date.now();
      });
      player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
        if (session.cancelled || reconnectInFlightRef.current) {
          return;
        }
        if (
          errorDetail === mpegts.ErrorDetails.MEDIA_CODEC_UNSUPPORTED ||
          errorDetail === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED
        ) {
          setError('Video format not supported');
          setIsBuffering(false);
          setIsRecovering(false);
          return;
        }
        const videoEl = videoRef.current;
        const networkStillAlive =
          Date.now() - lastNetworkActivityRef.current < NETWORK_IDLE_BEFORE_RECONNECT_MS;
        // Soft path: buffering / MSE noise while bytes are still arriving.
        if (
          errorType !== mpegts.ErrorTypes.NETWORK_ERROR ||
          networkStillAlive ||
          (videoEl && !videoEl.paused && videoEl.readyState >= 2 && videoEl.currentTime > 1)
        ) {
          if (errorType !== mpegts.ErrorTypes.NETWORK_ERROR) {
            lastPlaybackTimeRef.current = Date.now();
            isBufferingRef.current = true;
            setIsBuffering(true);
            return;
          }
          if (networkStillAlive) {
            lastPlaybackTimeRef.current = Date.now();
            isBufferingRef.current = true;
            setIsBuffering(true);
            return;
          }
        }
        attemptReconnectRef.current('network');
      });
      player.attachMediaElement(video);
      player.load();
      const played = player.play();
      if (played && typeof played.then === 'function') {
        played.catch(() => {
          setIsBuffering(false);
        });
      }
    };

    void start();

    return () => {
      session.cancelled = true;
      const player = session.player;
      if (!player) {
        return;
      }
      try {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } catch {
        // already destroyed
      }
    };
  }, [isOpen, channelNumber, currentUrl]);

  // Manual retry
  const handleRetry = useCallback(() => {
    retryCountRef.current = 0;
    setRetryCount(0);
    setError(null);
    reconnectInFlightRef.current = false;
    attemptReconnect('error');
  }, [attemptReconnect]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    if (!error && !isRecovering) {
      hideControlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, CONTROLS_HIDE_MS);
    }
  }, [error, isRecovering, CONTROLS_HIDE_MS]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
    revealControls();
  }, [revealControls]);

  const toggleFullscreen = useCallback(async () => {
    const root = containerRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await root.requestFullscreen();
      }
    } catch {
      // fullscreen may be blocked
    }
    revealControls();
  }, [revealControls]);

  useEffect(() => {
    if (!isOpen) return;
    revealControls();
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, [isOpen, revealControls]);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!isOpen) {
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
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      revealControls();

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'Escape':
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            onClose();
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          void toggleFullscreen();
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
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          }
          break;
        case 'ArrowUp': {
          e.preventDefault();
          const next = Math.min(1, volume + 0.1);
          setVolume(next);
          video.volume = next;
          video.muted = false;
          setIsMuted(false);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.max(0, volume - 0.1);
          setVolume(next);
          video.volume = next;
          if (next === 0) {
            video.muted = true;
            setIsMuted(true);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, onClose, volume, isLiveTV, isCatchup, revealControls, togglePlay, toggleFullscreen]);

  if (!isOpen) return null;

  const formatClock = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (!error && !isRecovering && isPlaying) {
          setControlsVisible(false);
        }
      }}
      onClick={(e) => {
        if (e.target === containerRef.current) {
          onClose();
        }
      }}
    >
      <div className="relative w-full h-full flex items-center justify-center">
        <video
          ref={videoRef}
          src={channelNumber ? undefined : currentUrl || undefined}
          poster={posterImage}
          className="w-full h-full object-contain bg-black"
          playsInline
          muted={isMuted}
          autoPlay={autoPlay}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            void toggleFullscreen();
          }}
        />

        {isRecovering && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-20 pointer-events-none">
            <Loader2 className="w-10 h-10 text-white animate-spin mb-3" />
            <p className="text-white text-base mb-1">{recoveryMessage}</p>
            <p className="text-white/60 text-sm">Attempt {retryCount} of {MAX_RETRIES}</p>
          </div>
        )}

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

        {isBuffering && !error && !isRecovering && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="rounded-full bg-black/50 p-4">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            </div>
          </div>
        )}

        <div
          className={cn(
            "absolute inset-0 z-30 transition-opacity duration-300",
            controlsVisible || error || isRecovering ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 pt-4 pb-10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && (
                  <h2 className="text-white text-lg font-semibold truncate drop-shadow">{title}</h2>
                )}
                <div className="mt-1 flex items-center gap-2">
                  {isCatchup ? (
                    <span className="px-2 py-0.5 bg-amber-500 text-white text-[11px] rounded font-semibold tracking-wide">CATCHUP</span>
                  ) : isLiveTV ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-red-600 text-white text-[11px] rounded font-semibold tracking-wide">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      LIVE
                    </span>
                  ) : null}
                  {channelNumber != null && (
                    <span className="text-white/70 text-xs">Ch {channelNumber}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isCatchup && channelNumber && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCurrentUrl(`${getServerUrl()}/api/video?channel=${channelNumber}&browser=1`);
                    }}
                    className="text-white hover:bg-white/15 text-xs"
                  >
                    Jump to Live
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-white hover:bg-white/15"
                  aria-label="Close player"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-4 pt-12">
            {(!isLiveTV || isCatchup) && (
              <div className="mb-3 flex items-center gap-3 text-white text-xs">
                <span className="tabular-nums w-10">{formatClock(currentTime)}</span>
                <div className="flex-1 h-1.5 bg-white/25 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isCatchup ? "bg-amber-400" : "bg-sky-400",
                    )}
                    style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                  />
                </div>
                <span className="tabular-nums w-10 text-right">{formatClock(duration)}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlay}
                className="text-white hover:bg-white/15"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const video = videoRef.current;
                  if (video) {
                    video.muted = !video.muted;
                    setIsMuted(video.muted);
                  }
                  revealControls();
                }}
                className="text-white hover:bg-white/15"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>

              <div className="w-28 flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  aria-label="Volume"
                  onChange={(e) => {
                    const newVolume = parseFloat(e.target.value);
                    setVolume(newVolume);
                    const video = videoRef.current;
                    if (video) {
                      video.volume = newVolume;
                      video.muted = newVolume === 0;
                      setIsMuted(newVolume === 0);
                    }
                    revealControls();
                  }}
                  className="w-full accent-white"
                />
              </div>

              <div className="flex-1" />

              {isLiveTV && !isCatchup && (
                <span className="text-white/60 text-xs hidden sm:inline">Space play · F fullscreen · Esc close</span>
              )}

              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void toggleFullscreen();
                }}
                className="text-white hover:bg-white/15"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
