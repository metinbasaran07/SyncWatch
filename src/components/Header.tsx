import React from 'react';
import { Film, Share2, Lock, ShieldCheck, Users, MessageSquare, Plus, LogIn, LogOut, Sparkles } from 'lucide-react';

interface HeaderProps {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  participantCount: number;
  isJoined: boolean;
  activeTab: 'cinema' | 'discovery' | 'settings';
  setActiveTab: (tab: 'cinema' | 'discovery' | 'settings') => void;
  onOpenCreateRoom: () => void;
  onOpenJoinRoom: () => void;
  onShareRoom: () => void;
  onLeaveRoom?: () => void;
  isCopied?: boolean;
  isChatOpen: boolean;
  onToggleChat: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  roomId,
  roomName,
  hasPassword,
  participantCount,
  isJoined,
  activeTab,
  setActiveTab,
  onOpenCreateRoom,
  onOpenJoinRoom,
  onShareRoom,
  onLeaveRoom,
  isChatOpen,
  onToggleChat,
}) => {
  return (
    <header className="flex items-center justify-between gap-2 sm:gap-4 px-3 py-2 sm:px-6 sm:py-2.5 bg-[#0e1424] border-b border-slate-800/80 sticky top-0 z-40">
      {/* Zone 1: Brand & Room Details */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          onClick={onOpenCreateRoom}
          className="flex items-center gap-2 group text-left cursor-pointer"
          title="CineSync Ana Sayfa & Yeni Oda"
        >
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-sm shadow-rose-950/40 group-hover:bg-rose-500 transition-colors">
            <Film className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
          <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
            CineSync
          </span>
        </button>

        {isJoined ? (
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-800 text-xs text-slate-400">
            <span className="text-slate-300 font-medium truncate max-w-[130px] md:max-w-[190px]">
              {roomName || 'Sinema Odası'}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono text-rose-400 font-semibold tracking-wider">#{roomId}</span>
            {hasPassword ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]" title="AES-GCM Uçtan Uca Şifreli">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                E2EE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-500 text-[11px]">
                <Lock className="w-3 h-3 text-slate-500" />
                Açık
              </span>
            )}
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded">
              🔥 Firebase
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 pl-3 border-l border-slate-800 text-xs text-slate-400">
            <span className="text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-full text-[10px] font-medium">
              Önizleme Modu
            </span>
          </div>
        )}
      </div>

      {/* Zone 2: Navigation Links */}
      <nav className="flex items-center gap-2 sm:gap-5 text-xs sm:text-sm font-medium text-slate-300">
        <button
          onClick={() => setActiveTab('cinema')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 px-1 sm:px-0 ${
            activeTab === 'cinema'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="hidden sm:inline">Sinema Sahnesi</span>
          <span className="sm:hidden">Sinema</span>
        </button>
        <button
          onClick={() => setActiveTab('discovery')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 px-1 sm:px-0 ${
            activeTab === 'discovery'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="hidden sm:inline">Film Keşfet & AI</span>
          <span className="sm:hidden">Keşfet</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 px-1 sm:px-0 ${
            activeTab === 'settings'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="hidden sm:inline">Oda & Şifreleme</span>
          <span className="sm:hidden">Ayarlar</span>
        </button>
      </nav>

      {/* Zone 3: Action Buttons */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* If user is inside a room */}
        {isJoined ? (
          <>
            {activeTab === 'cinema' && (
              <button
                onClick={onToggleChat}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  isChatOpen
                    ? 'bg-rose-900/30 border-rose-700/60 text-rose-300 hover:bg-rose-900/50'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
                title={isChatOpen ? 'Sohbeti Gizle' : 'Sohbeti Aç'}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isChatOpen ? 'Sohbet' : 'Sohbet'}</span>
              </button>
            )}

            <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono tabular-nums text-slate-200">{participantCount}</span>
            </div>

            {/* + Yeni Oda Button */}
            <button
              onClick={onOpenCreateRoom}
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
              title="Yeni bir sinema odası oluştur"
            >
              <Plus className="w-3.5 h-3.5 text-rose-400" />
              <span>Yeni Oda</span>
            </button>

            {/* Paylaş Button */}
            <button
              onClick={onShareRoom}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 active:scale-95 transition-all shadow-sm shadow-rose-950/30 whitespace-nowrap shrink-0"
              title="Oda kodunu ve davet linkini paylaş"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Odayı Paylaş</span>
            </button>

            {onLeaveRoom && (
              <button
                onClick={onLeaveRoom}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                title="Odadan Ayrıl"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Ayrıl</span>
              </button>
            )}
          </>
        ) : (
          /* When NOT in a room (Solo / Preview Mode) */
          <>
            <button
              onClick={onOpenJoinRoom}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="Var olan bir odaya katıl"
            >
              <LogIn className="w-3.5 h-3.5 text-indigo-400" />
              <span>Odaya Katıl</span>
            </button>

            <button
              onClick={onOpenCreateRoom}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-500 active:scale-95 transition-all shadow-md shadow-rose-950/40 whitespace-nowrap shrink-0 border border-rose-400/30"
              title="Yeni sinema odası oluştur ve arkadaşlarınla izle"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Oda Oluştur</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
