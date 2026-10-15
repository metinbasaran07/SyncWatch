import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Tv,
  Youtube,
  Link as LinkIcon,
  MonitorUp,
  Sparkles,
  Radio,
  Film,
  Eye,
  EyeOff,
  LayoutGrid,
  Columns,
  Rows,
} from 'lucide-react';
import { VideoState, EmojiReaction, RoomUser } from '../types';

interface CinemaStageProps {
  videoState: VideoState;
  onUpdateVideo: (update: Partial<VideoState>) => void;
  isHost: boolean;
  screenStream: MediaStream | null;
  onStartScreenShare: () => Promise<void>;
  onStopScreenShare: () => void;
  isSharingScreen: boolean;
  reactions: EmojiReaction[];
  onTriggerReaction: (emoji: string) => void;
  onOpenDiscovery?: () => void;
  users?: RoomUser[];
  localStream?: MediaStream | null;
  remoteStreams?: Map<string, MediaStream>;
  currentUserId?: string;
  hasCamera?: boolean;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export const CinemaStage: React.FC<CinemaStageProps> = ({
  videoState,
  onUpdateVideo,
  isHost,
  screenStream,
  onStartScreenShare,
  onStopScreenShare,
  isSharingScreen,
  reactions,
  onTriggerReaction,
  onOpenDiscovery,
  users = [],
  localStream = null,
  remoteStreams = new Map(),
  currentUserId = '',
  hasCamera = false,
}) => {
  const [volume, setVolume] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [screenAudioBlocked, setScreenAudioBlocked] = useState<boolean>(false);
  const [playbackTime, setPlaybackTime] = useState<number>(videoState.currentTime || 0);
  const [duration, setDuration] = useState<number>(videoState.duration || 600);
  const [showSourceModal, setShowSourceModal] = useState<boolean>(false);
  const [sourceInput, setSourceInput] = useState<string>('');
  const [sourceTypeSelect, setSourceTypeSelect] = useState<'youtube' | 'direct'>('youtube');
  
  // Fullscreen, position & Auto-hide controls
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isControlsVisible, setIsControlsVisible] = useState<boolean>(true);
  const [showFullscreenCameras, setShowFullscreenCameras] = useState<boolean>(true);
  const [fullscreenCameraPosition, setFullscreenCameraPosition] = useState<'bottom' | 'right'>('bottom');

  const containerRef = useRef<HTMLDivElement>(null);
  const htmlVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const isInternalChangeRef = useRef<boolean>(false);
  const hideControlsTimerRef = useRef<any>(null);
  const fullscreenLocalVideoRef = useRef<HTMLVideoElement>(null);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement);
      setIsFullscreen(isFull);
      if (isFull) {
        setIsControlsVisible(true);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Bind local stream to fullscreen local video element
  useEffect(() => {
    if (fullscreenLocalVideoRef.current && localStream) {
      fullscreenLocalVideoRef.current.srcObject = localStream;
      fullscreenLocalVideoRef.current.play().catch(() => {});
    }
  }, [localStream, isFullscreen, showFullscreenCameras, hasCamera]);

  // YouTube-like auto hide controls logic
  const triggerControlsActivity = useCallback(() => {
    setIsControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }

    if (videoState.isPlaying || isFullscreen) {
      hideControlsTimerRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 2500);
    }
  }, [videoState.isPlaying, isFullscreen]);

  const handleMouseMove = () => {
    triggerControlsActivity();
  };

  const handleMouseLeave = () => {
    if (videoState.isPlaying || isFullscreen) {
      setIsControlsVisible(false);
    }
  };

  const extractYouTubeId = (url: string): string => {
    if (!url) return '';
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : url;
  };

  // 1. YouTube API Initialization
  useEffect(() => {
    if (videoState.sourceType !== 'youtube' || !videoState.sourceUrl) {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
      return;
    }

    const loadYT = () => {
      const videoId = extractYouTubeId(videoState.sourceUrl);
      if (!videoId) return;

      if (window.YT && window.YT.Player) {
        if (ytPlayerRef.current) {
          try {
            ytPlayerRef.current.loadVideoById(videoId, videoState.currentTime);
          } catch (e) {}
        } else if (ytContainerRef.current) {
          ytPlayerRef.current = new window.YT.Player(ytContainerRef.current, {
            videoId,
            playerVars: {
              autoplay: videoState.isPlaying ? 1 : 0,
              controls: 0,
              rel: 0,
              modestbranding: 1,
              disablekb: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: (event: any) => {
                const p = event.target;
                p.seekTo(videoState.currentTime, true);
                if (videoState.isPlaying) p.playVideo();
                setDuration(p.getDuration() || 600);
              },
              onStateChange: (event: any) => {
                if (isInternalChangeRef.current) return;
                if (event.data === 1) {
                  onUpdateVideo({
                    isPlaying: true,
                    currentTime: ytPlayerRef.current?.getCurrentTime() || 0,
                  });
                } else if (event.data === 2) {
                  onUpdateVideo({
                    isPlaying: false,
                    currentTime: ytPlayerRef.current?.getCurrentTime() || 0,
                  });
                }
              },
            },
          });
        }
      }
    };

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      window.onYouTubeIframeAPIReady = loadYT;
    } else {
      loadYT();
    }

    return () => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
    };
  }, [videoState.sourceType, videoState.sourceUrl]);

  // 2. YouTube External Sync Listener
  useEffect(() => {
    if (videoState.sourceType !== 'youtube' || !ytPlayerRef.current) return;

    try {
      const yt = ytPlayerRef.current;
      const currentYtTime = yt.getCurrentTime ? yt.getCurrentTime() : 0;
      const drift = Math.abs(currentYtTime - videoState.currentTime);

      isInternalChangeRef.current = true;
      if (drift > 0.8) {
        yt.seekTo(videoState.currentTime, true);
      }

      if (videoState.isPlaying && yt.getPlayerState && yt.getPlayerState() !== 1) {
        yt.playVideo();
      } else if (!videoState.isPlaying && yt.getPlayerState && yt.getPlayerState() === 1) {
        yt.pauseVideo();
      }

      setTimeout(() => {
        isInternalChangeRef.current = false;
      }, 250);
    } catch (e) {}
  }, [videoState.isPlaying, videoState.currentTime]);

  // 3. HTML5 Direct Video External Sync Listener
  useEffect(() => {
    if (videoState.sourceType !== 'direct' || !htmlVideoRef.current || !videoState.sourceUrl) return;

    const vid = htmlVideoRef.current;
    const drift = Math.abs(vid.currentTime - videoState.currentTime);

    isInternalChangeRef.current = true;
    if (drift > 0.7) {
      vid.currentTime = videoState.currentTime;
    }

    if (videoState.isPlaying && vid.paused) {
      vid.play().catch(() => {});
    } else if (!videoState.isPlaying && !vid.paused) {
      vid.pause();
    }

    setTimeout(() => {
      isInternalChangeRef.current = false;
    }, 200);
  }, [videoState.isPlaying, videoState.currentTime, videoState.sourceType]);

  // 4. Resolve Active Screen Share Stream (Local or Remote from other participant)
  const sharingUser = users.find((u) => u.isSharingScreen && u.id !== currentUserId);

  const getActiveScreenStream = (): MediaStream | null => {
    // If local user is currently sharing screen
    if (isSharingScreen && screenStream) {
      return screenStream;
    }
    // If a remote peer is sharing screen (Netflix/tab)
    if (sharingUser) {
      const stream = remoteStreams.get(sharingUser.id);
      if (stream && stream.getVideoTracks().length > 0) {
        return stream;
      }
    }
    // Fallback: if videoState says screenshare and another user updated it
    if (videoState.sourceType === 'screenshare' && videoState.updatedBy && videoState.updatedBy !== currentUserId) {
      const stream = remoteStreams.get(videoState.updatedBy);
      if (stream && stream.getVideoTracks().length > 0) {
        return stream;
      }
    }
    return null;
  };

  const activeScreenStream = getActiveScreenStream();

  useEffect(() => {
    if (videoState.sourceType === 'screenshare' && screenVideoRef.current) {
      const vid = screenVideoRef.current;
      if (activeScreenStream) {
        if (vid.srcObject !== activeScreenStream) {
          vid.srcObject = activeScreenStream;
        }

        // Avoid echo on the sharing device; un-mute on receiving devices
        if (isSharingScreen) {
          vid.muted = true;
          vid.volume = 0;
        } else {
          vid.muted = isMuted;
          vid.volume = volume;
        }

        vid.play()
          .then(() => setScreenAudioBlocked(false))
          .catch((err) => {
            console.warn('Screen share video play policy:', err);
            if (!isSharingScreen) {
              setScreenAudioBlocked(true);
            }
          });
      }
    }
  }, [videoState.sourceType, activeScreenStream, isSharingScreen, isMuted, volume]);

  const handleUnlockScreenAudio = () => {
    if (screenVideoRef.current) {
      screenVideoRef.current.muted = false;
      screenVideoRef.current.volume = volume;
      screenVideoRef.current.play()
        .then(() => {
          setScreenAudioBlocked(false);
          setIsMuted(false);
        })
        .catch(() => {});
    }
  };

  // 5. Time ticker for progress bar
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoState.sourceType === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
        const t = ytPlayerRef.current.getCurrentTime();
        setPlaybackTime(t);
        const d = ytPlayerRef.current.getDuration();
        if (d && d > 0) setDuration(d);
      } else if (videoState.sourceType === 'direct' && htmlVideoRef.current) {
        setPlaybackTime(htmlVideoRef.current.currentTime);
        if (htmlVideoRef.current.duration) {
          setDuration(htmlVideoRef.current.duration);
        }
      }
    }, 400);

    return () => clearInterval(interval);
  }, [videoState.sourceType]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const hours = Math.floor(m / 60);
    if (hours > 0) {
      const remM = m % 60;
      return `${hours}:${remM < 10 ? '0' : ''}${remM}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleTogglePlay = () => {
    if (!videoState.sourceUrl && videoState.sourceType !== 'screenshare') {
      setShowSourceModal(true);
      return;
    }

    const nextState = !videoState.isPlaying;
    let currTime = playbackTime;
    if (videoState.sourceType === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
      currTime = ytPlayerRef.current.getCurrentTime();
    } else if (videoState.sourceType === 'direct' && htmlVideoRef.current) {
      currTime = htmlVideoRef.current.currentTime;
    }

    onUpdateVideo({
      isPlaying: nextState,
      currentTime: currTime,
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    setPlaybackTime(targetTime);
    onUpdateVideo({
      currentTime: targetTime,
    });

    if (videoState.sourceType === 'youtube' && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(targetTime, true);
    } else if (videoState.sourceType === 'direct' && htmlVideoRef.current) {
      htmlVideoRef.current.currentTime = targetTime;
    }
  };

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleApplySource = () => {
    if (!sourceInput.trim()) return;
    const url = sourceInput.trim();
    let title = 'Özel Video';
    if (sourceTypeSelect === 'youtube') {
      title = 'YouTube Senkronize Video';
    } else {
      title = url.split('/').pop()?.split('?')[0] || 'Doğrudan Akış';
    }

    onUpdateVideo({
      sourceType: sourceTypeSelect,
      sourceUrl: url,
      sourceTitle: title,
      currentTime: 0,
      isPlaying: true,
    });

    setShowSourceModal(false);
    setSourceInput('');
  };

  const loadPreset = (type: 'youtube' | 'direct', url: string, title: string) => {
    onUpdateVideo({
      sourceType: type,
      sourceUrl: url,
      sourceTitle: title,
      currentTime: 0,
      isPlaying: true,
    });
    setShowSourceModal(false);
  };

  const isVideoEmpty = !videoState.sourceUrl && videoState.sourceType !== 'screenshare';

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={triggerControlsActivity}
      onMouseLeave={handleMouseLeave}
      className={`relative w-full bg-black rounded-xl overflow-hidden border border-slate-800/80 shadow-2xl flex flex-col group select-none ${
        isFullscreen && !isControlsVisible ? 'cursor-none' : ''
      }`}
    >
      {/* 1. TOP MEDIA BAR (Auto-hides like YouTube) */}
      <div
        className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-2.5 sm:p-3.5 bg-gradient-to-b from-black/90 via-black/50 to-transparent transition-all duration-300 ${
          isControlsVisible || !videoState.isPlaying || isVideoEmpty
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2">
          {videoState.sourceType === 'screenshare' ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded bg-rose-600/90 text-white font-medium text-[11px] sm:text-xs shadow-sm">
              <Radio className="w-3 h-3 animate-pulse" />
              1080p60 Canlı Yayın
            </span>
          ) : videoState.sourceType === 'youtube' && videoState.sourceUrl ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded bg-red-600/90 text-white font-medium text-[11px] sm:text-xs shadow-sm">
              <Youtube className="w-3 h-3" />
              YouTube
            </span>
          ) : videoState.sourceUrl ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded bg-blue-600/90 text-white font-medium text-[11px] sm:text-xs shadow-sm">
              <Tv className="w-3 h-3" />
              Medya
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded bg-slate-800 text-slate-300 font-medium text-[11px] sm:text-xs border border-slate-700">
              <Film className="w-3 h-3 text-rose-500" />
              Sinema
            </span>
          )}

          <span className="text-[11px] sm:text-xs font-semibold text-slate-200 truncate max-w-[130px] sm:max-w-xs md:max-w-md">
            {videoState.sourceTitle || 'İçerik Seçilmedi'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Fullscreen Camera Controls: Toggle & Position (Alt / Sağ) */}
          {isFullscreen && (
            <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm p-1 rounded-lg border border-slate-700/60">
              <button
                onClick={() => setShowFullscreenCameras(!showFullscreenCameras)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 rounded transition-colors whitespace-nowrap"
                title="Tam ekranda kameraları aç/kapat"
              >
                {showFullscreenCameras ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5 text-emerald-400" />}
                <span className="hidden sm:inline">{showFullscreenCameras ? 'Kameraları Gizle' : 'Kameraları Göster'}</span>
              </button>

              {showFullscreenCameras && (
                <button
                  onClick={() => setFullscreenCameraPosition(fullscreenCameraPosition === 'bottom' ? 'right' : 'bottom')}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
                  title="Kameraları Alt veya Sağ Tarafına Sabitle"
                >
                  {fullscreenCameraPosition === 'bottom' ? <Columns className="w-3.5 h-3.5 text-rose-400" /> : <Rows className="w-3.5 h-3.5 text-rose-400" />}
                  <span className="hidden sm:inline">{fullscreenCameraPosition === 'bottom' ? 'Sağa Sabitle' : 'Alta Sabitle'}</span>
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => setShowSourceModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium text-slate-200 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap shadow-sm"
          >
            <LinkIcon className="w-3 h-3 text-rose-400" />
            <span>{isVideoEmpty ? 'Video Ekle' : 'Değiştir'}</span>
          </button>

          {isSharingScreen ? (
            <button
              onClick={onStopScreenShare}
              className="flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium text-white bg-rose-700 hover:bg-rose-600 rounded-lg transition-colors whitespace-nowrap shadow-sm"
            >
              <span>Durdur</span>
            </button>
          ) : (
            <button
              onClick={onStartScreenShare}
              className="flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap shadow-sm"
              title="Netflix veya film açtığınız sekme/ekranı 1080p60 kalitesinde aktarın"
            >
              <MonitorUp className="w-3 h-3 text-emerald-400" />
              <span className="hidden sm:inline">Sekme Paylaş</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. FLOATING REACTION EMOJIS */}
      <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="absolute bottom-16 text-3xl md:text-5xl animate-bounce transition-all duration-1000 ease-out"
            style={{
              left: `${r.xOffset}%`,
              animation: 'floatUp 2.5s ease-out forwards',
            }}
          >
            <div className="flex flex-col items-center">
              <span>{r.emoji}</span>
              <span className="text-[10px] text-white/80 bg-black/60 px-1.5 rounded font-mono">
                {r.senderName}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 3. FULLSCREEN CAMERAS: FIXED TO RIGHT OR BOTTOM */}
      {isFullscreen && showFullscreenCameras && (
        <div
          className={`absolute z-40 p-2 bg-black/75 backdrop-blur-md rounded-xl border border-slate-700/80 shadow-2xl pointer-events-auto transition-all ${
            fullscreenCameraPosition === 'right'
              ? 'top-16 bottom-16 right-4 flex flex-col gap-2 max-h-[calc(100vh-120px)] w-48 overflow-y-auto scrollbar-thin'
              : 'bottom-16 left-4 right-4 flex flex-row gap-2 overflow-x-auto scrollbar-thin max-w-full justify-center sm:justify-start'
          }`}
        >
          {/* Local camera in fullscreen PIP */}
          <div className="relative w-36 h-24 sm:w-40 sm:h-28 bg-slate-950 rounded-lg overflow-hidden border border-slate-700 flex items-center justify-center shrink-0">
            {localStream && localStream.getVideoTracks().length > 0 ? (
              <video
                ref={(el) => {
                  fullscreenLocalVideoRef.current = el;
                  if (el && localStream && el.srcObject !== localStream) {
                    el.srcObject = localStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-[10px] text-slate-400 p-2 text-center">
                <div className="w-8 h-8 rounded-full bg-rose-600/30 text-rose-300 flex items-center justify-center font-bold text-xs mb-1">
                  Sen
                </div>
                <span>Kamera Kapalı</span>
              </div>
            )}
            <div className="absolute bottom-1 left-1 bg-black/70 text-[9px] px-1.5 py-0.5 rounded text-white font-medium">
              Sen
            </div>
          </div>

          {/* Remote camera tiles in fullscreen */}
          {users
            .filter((u) => u.id !== currentUserId)
            .map((user) => {
              const remoteStream = remoteStreams.get(user.id);
              // Ensure screen shares are never rendered inside this small camera tile
              const hasRemoteVideo = Boolean(
                remoteStream &&
                remoteStream.getVideoTracks().length > 0 &&
                remoteStream.getVideoTracks()[0].enabled &&
                !user.isSharingScreen
              );

              return (
                <div
                  key={user.id}
                  className="relative w-36 h-24 sm:w-40 sm:h-28 bg-slate-950 rounded-lg overflow-hidden border border-slate-700 flex items-center justify-center shrink-0"
                >
                  <video
                    ref={(el) => {
                      if (el && remoteStream && el.srcObject !== remoteStream) {
                        el.srcObject = remoteStream;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    className={`w-full h-full object-cover ${hasRemoteVideo ? 'block' : 'hidden'}`}
                  />
                  {!hasRemoteVideo && (
                    <div className="flex flex-col items-center justify-center text-[10px] text-slate-400 p-2 text-center">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white mb-1 shadow-sm"
                        style={{ backgroundColor: user.avatarColor || '#3b82f6' }}
                      >
                        {user.name.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="truncate max-w-[100px]">{user.name}</span>
                      {user.isSharingScreen && (
                        <span className="text-[9px] text-emerald-400 font-semibold mt-0.5">Ekran Paylaşıyor</span>
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 bg-black/70 text-[9px] px-1.5 py-0.5 rounded text-white truncate max-w-[100px] font-medium">
                    {user.name}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* 4. MAIN VIDEO VIEWPORT */}
      <div className="relative w-full aspect-video bg-[#05070d] flex items-center justify-center overflow-hidden">
        {/* EMPTY STATE: When player is empty on initial site opening */}
        {isVideoEmpty ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-gradient-to-b from-[#0e1629] via-[#090d16] to-[#05070d]">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-rose-600/10 border border-rose-500/20 text-rose-500 flex items-center justify-center mb-2.5 sm:mb-3 shadow-inner">
              <Film className="w-6 h-6 sm:w-8 sm:h-8" />
            </div>

            <h3 className="text-base sm:text-lg md:text-xl font-bold text-white tracking-tight mb-1">
              Sinema Sahnesi Hazır
            </h3>
            <p className="text-[11px] sm:text-xs md:text-sm text-slate-400 max-w-md mb-4 sm:mb-6">
              Birlikte izlemek için bir film sekmesi paylaşın veya YouTube bağlantısı girin.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full max-w-xl">
              <button
                onClick={onStartScreenShare}
                className="flex sm:flex-col items-center text-left sm:text-center p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/50 transition-all group/btn shadow-md gap-3 sm:gap-0"
              >
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center sm:mb-2 group-hover/btn:scale-110 transition-transform shrink-0">
                  <MonitorUp className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-white block mb-0.5">Netflix & Siteler</span>
                  <span className="text-[10px] text-slate-400 block">1080p60 Sesli Sekme Yayını</span>
                </div>
              </button>

              <button
                onClick={() => {
                  setSourceTypeSelect('youtube');
                  setShowSourceModal(true);
                }}
                className="flex sm:flex-col items-center text-left sm:text-center p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-red-500/50 transition-all group/btn shadow-md gap-3 sm:gap-0"
              >
                <div className="w-9 h-9 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center sm:mb-2 group-hover/btn:scale-110 transition-transform shrink-0">
                  <Youtube className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-white block mb-0.5">YouTube Bağlantısı</span>
                  <span className="text-[10px] text-slate-400 block">Video & Fragman Senkronu</span>
                </div>
              </button>

              <button
                onClick={() => onOpenDiscovery && onOpenDiscovery()}
                className="flex sm:flex-col items-center text-left sm:text-center p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-rose-500/50 transition-all group/btn shadow-md gap-3 sm:gap-0"
              >
                <div className="w-9 h-9 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center sm:mb-2 group-hover/btn:scale-110 transition-transform shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-white block mb-0.5">Film Önerisi Al</span>
                  <span className="text-[10px] text-slate-400 block">Gemini ile Film Keşfet & Oyla</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <>
            {videoState.sourceType === 'screenshare' && (
              <div className="relative w-full h-full flex items-center justify-center bg-black">
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />

                {/* If audio autoplay was blocked by browser, provide 1-click sound unlock */}
                {screenAudioBlocked && (
                  <button
                    onClick={handleUnlockScreenAudio}
                    className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-xl animate-pulse cursor-pointer border border-rose-400 transition-all hover:scale-105"
                    title="Mobil veya masaüstü tarayıcınız sesi engelledi. Sesi duymak için dokunun."
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Film Sesini Açmak İçin Dokunun</span>
                  </button>
                )}

                {/* Waiting indicator if stream is initializing */}
                {!activeScreenStream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-950/80">
                    <Radio className="w-10 h-10 text-rose-500 animate-pulse mb-2" />
                    <span className="text-sm font-semibold text-white">Canlı Yayın Bekleniyor</span>
                    <span className="text-xs text-slate-400 mt-1">Ekran görüntüsü ve ses akışı bağlanıyor...</span>
                  </div>
                )}
              </div>
            )}

            {videoState.sourceType === 'youtube' && (
              <div className="w-full h-full pointer-events-auto">
                <div ref={ytContainerRef} className="w-full h-full" />
              </div>
            )}

            {videoState.sourceType === 'direct' && (
              <video
                ref={htmlVideoRef}
                src={videoState.sourceUrl}
                playsInline
                className="w-full h-full object-contain bg-black"
                onTimeUpdate={() => {
                  if (htmlVideoRef.current && !isInternalChangeRef.current) {
                    setPlaybackTime(htmlVideoRef.current.currentTime);
                  }
                }}
                onLoadedMetadata={() => {
                  if (htmlVideoRef.current) {
                    setDuration(htmlVideoRef.current.duration || 600);
                  }
                }}
                onPlay={() => {
                  if (!isInternalChangeRef.current) {
                    onUpdateVideo({
                      isPlaying: true,
                      currentTime: htmlVideoRef.current?.currentTime || 0,
                    });
                  }
                }}
                onPause={() => {
                  if (!isInternalChangeRef.current) {
                    onUpdateVideo({
                      isPlaying: false,
                      currentTime: htmlVideoRef.current?.currentTime || 0,
                    });
                  }
                }}
              />
            )}

            {videoState.sourceType !== 'youtube' && videoState.sourceType !== 'screenshare' && (
              <button
                onClick={handleTogglePlay}
                className="absolute inset-0 w-full h-full flex items-center justify-center bg-black/10 hover:bg-black/30 transition-colors group/overlay"
              >
                {!videoState.isPlaying && (
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-lg group-hover/overlay:scale-110 transition-transform">
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 ml-1" />
                  </div>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* 5. BOTTOM CINEMA CONTROLS BAR (Auto-hides like YouTube) */}
      <div
        className={`relative z-30 bg-slate-950/95 border-t border-slate-800/80 px-3 py-2 sm:px-4 sm:py-2.5 flex flex-col gap-1.5 sm:gap-2 transition-all duration-300 ${
          isControlsVisible || !videoState.isPlaying || isVideoEmpty
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {!isVideoEmpty && videoState.sourceType !== 'screenshare' && (
          <div className="flex items-center gap-3 w-full">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.5}
              value={playbackTime}
              onChange={handleSeek}
              className="w-full h-1 sm:h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-600 hover:h-2 transition-all"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleTogglePlay}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors shadow-sm shrink-0"
              title={videoState.isPlaying ? 'Durdur' : 'Oynat'}
            >
              {videoState.isPlaying ? (
                <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              ) : (
                <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5" />
              )}
            </button>

            {!isVideoEmpty && videoState.sourceType !== 'screenshare' && (
              <button
                onClick={() => {
                  onUpdateVideo({ currentTime: 0, isPlaying: true });
                  if (videoState.sourceType === 'youtube' && ytPlayerRef.current) {
                    ytPlayerRef.current.seekTo(0, true);
                  } else if (htmlVideoRef.current) {
                    htmlVideoRef.current.currentTime = 0;
                  }
                }}
                className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-200 transition-colors rounded"
                title="Başa Sar"
              >
                <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            )}

            {!isVideoEmpty && videoState.sourceType !== 'screenshare' ? (
              <div className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-400">
                <span className="text-slate-200 font-semibold">{formatTime(playbackTime)}</span>
                <span className="text-slate-600 mx-1">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            ) : videoState.sourceType === 'screenshare' ? (
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-rose-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>Canlı Yayın</span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                <span>İçerik bekleniyor</span>
              </div>
            )}
          </div>

          {/* Quick Floating Reaction Buttons */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
            {['🍿', '😂', '🔥', '❤️', '😱', '👏'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => onTriggerReaction(emoji)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 text-sm hover:scale-125 transition-transform"
                title={`${emoji} tepkisi gönder`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {(videoState.sourceType === 'direct' || videoState.sourceType === 'screenshare') && (
              <div className="hidden sm:flex items-center gap-2 group/vol">
                <button
                  onClick={() => {
                    const nextMute = !isMuted;
                    setIsMuted(nextMute);
                    if (htmlVideoRef.current) htmlVideoRef.current.muted = nextMute;
                    if (screenVideoRef.current && !isSharingScreen) screenVideoRef.current.muted = nextMute;
                  }}
                  className="text-slate-400 hover:text-white transition-colors"
                  title={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setVolume(val);
                    setIsMuted(false);
                    if (htmlVideoRef.current) {
                      htmlVideoRef.current.volume = val;
                      htmlVideoRef.current.muted = false;
                    }
                    if (screenVideoRef.current && !isSharingScreen) {
                      screenVideoRef.current.volume = val;
                      screenVideoRef.current.muted = false;
                    }
                  }}
                  className="w-14 sm:w-16 h-1 bg-slate-800 rounded accent-rose-500 cursor-pointer"
                  title={`Ses Seviyesi: ${Math.round(volume * 100)}%`}
                />
              </div>
            )}

            <button
              onClick={handleToggleFullscreen}
              className="p-1 sm:p-1.5 text-slate-400 hover:text-white transition-colors rounded"
              title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Video Source Picker Modal */}
      {showSourceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 pointer-events-auto">
          <div className="bg-[#111827] border border-slate-700/80 rounded-xl p-5 sm:p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-sm sm:text-base font-bold text-white mb-1">Video Kaynağını Belirleyin</h3>
            <p className="text-[11px] sm:text-xs text-slate-400 mb-3.5">
              YouTube bağlantısı yapıştırın veya doğrudan bir video bağlantısı (MP4) ekleyin.
            </p>

            <div className="flex items-center gap-1.5 mb-3.5 p-1 bg-slate-900 rounded-lg">
              <button
                type="button"
                onClick={() => setSourceTypeSelect('youtube')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  sourceTypeSelect === 'youtube'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                YouTube URL
              </button>
              <button
                type="button"
                onClick={() => setSourceTypeSelect('direct')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  sourceTypeSelect === 'direct'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Doğrudan Video (MP4)
              </button>
            </div>

            <div className="mb-3.5">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-300 mb-1">
                {sourceTypeSelect === 'youtube'
                  ? 'YouTube Video Bağlantısı'
                  : 'Doğrudan Video Akış URL (MP4 / WebM)'}
              </label>
              <input
                type="text"
                placeholder={
                  sourceTypeSelect === 'youtube'
                    ? 'https://www.youtube.com/watch?v=...'
                    : 'https://example.com/movie.mp4'
                }
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono"
              />
            </div>

            <div className="mb-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                Hızlı Örnek Videolar:
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    loadPreset(
                      'youtube',
                      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
                      'Big Buck Bunny (4K 60fps)'
                    )
                  }
                  className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left text-slate-300 transition-colors"
                >
                  <span className="font-semibold block text-white truncate text-[11px]">Big Buck Bunny</span>
                  <span className="text-[9px] text-slate-500">YouTube 4K Test</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    loadPreset(
                      'youtube',
                      'https://www.youtube.com/watch?v=zSWdZVtXT7E',
                      'Interstellar Fragman'
                    )
                  }
                  className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left text-slate-300 transition-colors"
                >
                  <span className="font-semibold block text-white truncate text-[11px]">Interstellar</span>
                  <span className="text-[9px] text-slate-500">YouTube Fragman</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    loadPreset(
                      'direct',
                      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
                      'Tears of Steel (1080p Sci-Fi)'
                    )
                  }
                  className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left text-slate-300 transition-colors"
                >
                  <span className="font-semibold block text-white truncate text-[11px]">Tears of Steel</span>
                  <span className="text-[9px] text-slate-500">Direct MP4 1080p</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    loadPreset(
                      'direct',
                      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
                      'Elephants Dream'
                    )
                  }
                  className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left text-slate-300 transition-colors"
                >
                  <span className="font-semibold block text-white truncate text-[11px]">Elephants Dream</span>
                  <span className="text-[9px] text-slate-500">Direct MP4 Test</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2.5 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSourceModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleApplySource}
                disabled={!sourceInput.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 disabled:opacity-50 transition-colors"
              >
                Videoyu Yükle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
