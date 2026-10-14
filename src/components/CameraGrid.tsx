import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Radio,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { RoomUser } from '../types';

interface CameraGridProps {
  users: RoomUser[];
  currentUserId: string;
  localStream: MediaStream | null;
  remoteStreams?: Map<string, MediaStream>;
  isPushToTalkMode: boolean;
  onTogglePushToTalkMode: (enabled: boolean) => void;
  isPushToTalkActive: boolean;
  onPushToTalkTrigger: (active: boolean) => void;
  hasCamera: boolean;
  onToggleCamera: () => void;
  hasMic: boolean;
  onToggleMic: () => void;
  isSpeaking: boolean;
  speakingVolume: number;
}

export type CameraSizePreset = 'compact' | 'normal' | 'large';

// Component for a remote user camera tile + audio player
const RemoteUserTile: React.FC<{
  user: RoomUser;
  stream?: MediaStream;
  cardWidth: number;
  cardHeight: number;
}> = ({ user, stream, cardWidth, cardHeight }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (stream) {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      }
    }
  }, [stream]);

  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled);

  return (
    <div
      className={`relative rounded-lg overflow-hidden bg-slate-950 border transition-all shrink-0 flex flex-col items-center justify-center ${
        user.isSpeaking
          ? 'border-emerald-500 shadow-md shadow-emerald-950/40 ring-2 ring-emerald-500/50'
          : 'border-slate-800'
      }`}
      style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
    >
      {/* Remote Audio Track Player (so sound plays through speakers) */}
      <audio ref={audioRef} autoPlay playsInline />

      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-sm"
            style={{ backgroundColor: user.avatarColor || '#3b82f6' }}
          >
            {user.name.substring(0, 2).toUpperCase()}
          </div>
          <span className="text-[10px] text-slate-400">
            {user.hasCamera ? 'Kamera Başlatılıyor' : 'Ses Bağlantısı'}
          </span>
        </div>
      )}

      {/* Speaking visual indicator */}
      {user.isSpeaking && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/60 px-1.5 py-0.5 rounded-full">
          <span className="w-1 h-2.5 bg-emerald-500 rounded-full animate-voice-wave" />
          <span className="w-1 h-3.5 bg-emerald-500 rounded-full animate-voice-wave" style={{ animationDelay: '0.2s' }} />
          <span className="w-1 h-2 bg-emerald-500 rounded-full animate-voice-wave" style={{ animationDelay: '0.4s' }} />
        </div>
      )}

      {/* Bottom user label */}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] text-white">
        <span className="font-medium truncate">{user.name}</span>
        {user.isHost && (
          <span className="text-[9px] bg-rose-900/60 text-rose-300 px-1 rounded">
            Host
          </span>
        )}
      </div>
    </div>
  );
};

export const CameraGrid: React.FC<CameraGridProps> = ({
  users,
  currentUserId,
  localStream,
  remoteStreams = new Map(),
  isPushToTalkMode,
  onTogglePushToTalkMode,
  isPushToTalkActive,
  onPushToTalkTrigger,
  hasCamera,
  onToggleCamera,
  hasMic,
  onToggleMic,
  isSpeaking,
  speakingVolume,
}) => {
  const [sizePreset, setSizePreset] = useState<CameraSizePreset>('normal');
  const [customScale, setCustomScale] = useState<number>(100);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [showSizeSettings, setShowSizeSettings] = useState<boolean>(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Bind local webcam stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, hasCamera]);

  const getCardWidth = () => {
    let base = 180;
    if (sizePreset === 'compact') base = 120;
    if (sizePreset === 'large') base = 260;
    return Math.round((base * customScale) / 100);
  };

  const cardWidth = getCardWidth();
  const cardHeight = Math.round((cardWidth * 3) / 4);

  return (
    <div className="w-full bg-[#0d1322] border border-slate-800/80 rounded-xl p-3 shadow-lg flex flex-col gap-2.5">
      {/* Header & Size Settings */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">Kameralar & Ses</span>
          <span className="text-[11px] text-slate-400">
            ({users.length} Katılımcı)
          </span>

          {isPushToTalkMode ? (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                isPushToTalkActive
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {isPushToTalkActive ? '🔴 Bas-Konuş Aktif (Konuşuyorsunuz)' : 'Bas-Konuş: [Space / V]'}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950 text-emerald-400 border border-emerald-800/60">
              Açık Mikrofon
            </span>
          )}
        </div>

        {/* Size Presets & Minimize Toggle */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowSizeSettings(!showSizeSettings)}
              className="flex items-center gap-1 px-2.5 py-1 text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-md transition-colors"
              title="Kamera Boyutunu Ayarla"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Boyut: {sizePreset === 'compact' ? 'Kompakt' : sizePreset === 'large' ? 'Geniş' : 'Normal'}</span>
            </button>

            {showSizeSettings && (
              <div className="absolute right-0 bottom-full mb-2 z-50 w-64 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-2xl flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold text-slate-200">
                  Kamera Boyut Tercihi
                </span>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => {
                      setSizePreset('compact');
                      setCustomScale(100);
                    }}
                    className={`py-1 text-[11px] font-medium rounded transition-colors ${
                      sizePreset === 'compact'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Kompakt
                  </button>
                  <button
                    onClick={() => {
                      setSizePreset('normal');
                      setCustomScale(100);
                    }}
                    className={`py-1 text-[11px] font-medium rounded transition-colors ${
                      sizePreset === 'normal'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Normal
                  </button>
                  <button
                    onClick={() => {
                      setSizePreset('large');
                      setCustomScale(100);
                    }}
                    className={`py-1 text-[11px] font-medium rounded transition-colors ${
                      sizePreset === 'large'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Geniş
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>Ölçek:</span>
                    <span className="font-mono text-slate-200">{customScale}%</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={160}
                    step={5}
                    value={customScale}
                    onChange={(e) => setCustomScale(Number(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded accent-rose-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-slate-400 hover:text-white rounded bg-slate-900 border border-slate-800 transition-colors"
            title={isMinimized ? 'Kameraları Göster' : 'Kameraları Gizle'}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Camera Strip */}
      {!isMinimized && (
        <div className="flex items-center gap-3 overflow-x-auto pb-1.5 pt-0.5 scrollbar-thin">
          {/* 1. Local User Camera Card */}
          <div
            className={`relative rounded-lg overflow-hidden bg-slate-950 border transition-all shrink-0 flex flex-col items-center justify-center ${
              isSpeaking || isPushToTalkActive
                ? 'border-rose-500 shadow-md shadow-rose-950/40 ring-2 ring-rose-500/50'
                : 'border-slate-800'
            }`}
            style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
          >
            {hasCamera && localStream && localStream.getVideoTracks().length > 0 ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1.5 text-slate-500">
                <div className="w-10 h-10 rounded-full bg-rose-600/20 text-rose-400 flex items-center justify-center font-bold text-sm border border-rose-500/30">
                  Siz
                </div>
                <span className="text-[10px] text-slate-400">Kamera Kapalı</span>
              </div>
            )}

            {(isSpeaking || isPushToTalkActive) && (
              <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/60 px-1.5 py-0.5 rounded-full">
                <span className="w-1 h-2.5 bg-rose-500 rounded-full animate-voice-wave" />
                <span className="w-1 h-3.5 bg-rose-500 rounded-full animate-voice-wave" style={{ animationDelay: '0.2s' }} />
                <span className="w-1 h-2 bg-rose-500 rounded-full animate-voice-wave" style={{ animationDelay: '0.4s' }} />
              </div>
            )}

            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] text-white">
              <span className="font-medium truncate">Sen (Senin Kameran)</span>
              <div className="flex items-center gap-1 text-slate-300">
                {hasMic ? (
                  isPushToTalkMode && !isPushToTalkActive ? (
                    <span title="Bas-Konuş Beklemede"><MicOff className="w-3 h-3 text-slate-400" /></span>
                  ) : (
                    <Mic className="w-3 h-3 text-rose-400" />
                  )
                ) : (
                  <MicOff className="w-3 h-3 text-red-500" />
                )}
              </div>
            </div>
          </div>

          {/* 2. Remote Room Participants Camera Cards */}
          {users
            .filter((u) => u.id !== currentUserId)
            .map((user) => (
              <RemoteUserTile
                key={user.id}
                user={user}
                stream={remoteStreams.get(user.id)}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
              />
            ))}
        </div>
      )}

      {/* Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onToggleCamera}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors ${
              hasCamera
                ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            {hasCamera ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            <span>{hasCamera ? 'Kamera Açık' : 'Kamera Aç'}</span>
          </button>

          <button
            onClick={onToggleMic}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors ${
              hasMic
                ? 'bg-slate-800 text-white hover:bg-slate-700'
                : 'bg-rose-900/40 text-rose-300 border border-rose-800 hover:bg-rose-900/60'
            }`}
          >
            {hasMic ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            <span>{hasMic ? 'Mikrofon Açık' : 'Mikrofon Aç'}</span>
          </button>

          <button
            onClick={() => onTogglePushToTalkMode(!isPushToTalkMode)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium border transition-colors ${
              isPushToTalkMode
                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
            }`}
            title="Bas-Konuş ve Açık Mikrofon arasında geçiş yap"
          >
            <Radio className="w-3 h-3 text-rose-500" />
            <span>{isPushToTalkMode ? 'Bas-Konuş' : 'Açık Mic'}</span>
          </button>
        </div>

        {isPushToTalkMode && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0">
            <button
              onMouseDown={() => onPushToTalkTrigger(true)}
              onMouseUp={() => onPushToTalkTrigger(false)}
              onMouseLeave={() => onPushToTalkTrigger(false)}
              onTouchStart={(e) => {
                e.preventDefault();
                onPushToTalkTrigger(true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onPushToTalkTrigger(false);
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer active:scale-95 touch-none ${
                isPushToTalkActive
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/60 ring-2 ring-rose-400'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
            >
              <Mic className={`w-3.5 h-3.5 ${isPushToTalkActive ? 'animate-bounce' : ''}`} />
              <span>{isPushToTalkActive ? 'KONUŞULUYOR (Bırak)' : 'Basılı Tut ve Konuş (PTT)'}</span>
            </button>
            <span className="hidden sm:inline text-[10px] text-slate-400 font-mono">
              [Space / V]
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
