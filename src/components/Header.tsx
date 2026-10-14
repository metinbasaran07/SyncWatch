import React from 'react';
import { Film, Share2, Lock, ShieldCheck, Users, Copy, Check } from 'lucide-react';

interface HeaderProps {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  participantCount: number;
  activeTab: 'cinema' | 'discovery' | 'settings';
  setActiveTab: (tab: 'cinema' | 'discovery' | 'settings') => void;
  onShareRoom: () => void;
  isCopied: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  roomId,
  roomName,
  hasPassword,
  participantCount,
  activeTab,
  setActiveTab,
  onShareRoom,
  isCopied,
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0e1424] border-b border-slate-800/80 sticky top-0 z-40">
      {/* Zone 1: Single text element Brand Zone */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-sm shadow-rose-950/40 group-hover:bg-rose-500 transition-colors">
            <Film className="w-4 h-4" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
            CineSync
          </span>
        </a>

        <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-800 text-xs text-slate-400">
          <span className="text-slate-300 font-medium truncate max-w-[140px] md:max-w-[200px]">
            {roomName || 'Sinema Odası'}
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="font-mono text-slate-400 tracking-wider">#{roomId}</span>
          {hasPassword ? (
            <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]" title="AES-GCM Uçtan Uca Şifreli">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              E2EE
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-500 text-[11px]">
              <Lock className="w-3 h-3 text-slate-500" />
              Açık Oda
            </span>
          )}
        </div>
      </div>

      {/* Zone 2: 4-5 single-line clean navigation tabs */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
        <button
          onClick={() => setActiveTab('cinema')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'cinema'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Sinema Sahnesi
        </button>
        <button
          onClick={() => setActiveTab('discovery')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'discovery'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Film Keşfet & AI
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'settings'
              ? 'text-white border-b-2 border-rose-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Oda & Şifreleme
        </button>
      </nav>

      {/* Zone 3: 1 primary action button */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-mono tabular-nums text-slate-200">{participantCount}</span>
          <span className="hidden sm:inline">kişi</span>
        </div>

        <button
          onClick={onShareRoom}
          className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 active:scale-95 transition-all shadow-sm shadow-rose-950/30 whitespace-nowrap shrink-0"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Kopyalandı!</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5" />
              <span>Odayı Paylaş</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
