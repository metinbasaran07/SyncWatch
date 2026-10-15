import React, { useState, useEffect } from 'react';
import {
  Film,
  ShieldCheck,
  Lock,
  Users,
  Sparkles,
  ArrowRight,
  UserCheck,
  RefreshCw,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Play,
  KeyRound
} from 'lucide-react';

interface ActiveRoomItem {
  id: string;
  name: string;
  userCount: number;
  hasPassword: boolean;
  hostName: string;
  currentVideo?: string;
  users?: { id: string; name: string; avatarColor?: string }[];
}

interface RoomModalProps {
  initialRoomId: string;
  initialPassword?: string;
  onJoinRoom: (userName: string, roomId: string, password: string, isHost: boolean) => void;
}

export const RoomModal: React.FC<RoomModalProps> = ({
  initialRoomId,
  initialPassword = '',
  onJoinRoom,
}) => {
  const [userName, setUserName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cinesync_userName') || '';
    }
    return '';
  });
  const [customRoomId, setCustomRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState(initialRoomId ? initialRoomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '');
  const [password, setPassword] = useState(initialPassword);
  const [isCreatingNew, setIsCreatingNew] = useState(!initialRoomId);
  const [activeRooms, setActiveRooms] = useState<ActiveRoomItem[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  const generateRandomRoomId = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let res = '';
    for (let i = 0; i < 6; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };

  // Generate initial code for new room creation
  useEffect(() => {
    if (!customRoomId) {
      setCustomRoomId(generateRandomRoomId());
    }
  }, []);

  useEffect(() => {
    if (initialRoomId) {
      const clean = initialRoomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      setJoinRoomId(clean);
      setIsCreatingNew(false);
    }
    if (initialPassword) {
      setPassword(initialPassword);
    }
  }, [initialRoomId, initialPassword]);

  // Fetch active rooms on mount and periodic refresh
  const fetchActiveRooms = async () => {
    try {
      setIsLoadingRooms(true);
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        if (data.rooms && Array.isArray(data.rooms)) {
          setActiveRooms(data.rooms);
        }
      }
    } catch (e) {
      // Ignore background fetch error
    } finally {
      setIsLoadingRooms(false);
    }
  };

  useEffect(() => {
    fetchActiveRooms();
    const timer = setInterval(fetchActiveRooms, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleSelectActiveRoom = (room: ActiveRoomItem) => {
    setJoinRoomId(room.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''));
    setIsCreatingNew(false);
  };

  const handleRegenerateCode = () => {
    setCustomRoomId(generateRandomRoomId());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    if (typeof window !== 'undefined') {
      localStorage.setItem('cinesync_userName', userName.trim());
    }

    let targetRoom = '';
    if (isCreatingNew) {
      targetRoom = (customRoomId.trim() || generateRandomRoomId()).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    } else {
      targetRoom = (joinRoomId.trim() || initialRoomId.trim()).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    }

    if (!targetRoom) return;

    onJoinRoom(userName.trim(), targetRoom, password.trim(), isCreatingNew);
  };

  const matchedActiveRoom = activeRooms.find(
    (r) => r.id.toLowerCase() === joinRoomId.trim().toLowerCase()
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#090d16]/92 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl p-5 sm:p-6 w-full max-w-lg shadow-2xl relative my-auto">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-rose-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-950/50 shrink-0">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>CineSync Sinema Odası</span>
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Canlı Eşleme
                </span>
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Eşzamanlı video izleme, bas-konuş ses & canlı kamera alanı
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchActiveRooms}
            title="Aktif Odaları Yenile"
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 rounded-lg transition-colors shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRooms ? 'animate-spin text-rose-400' : ''}`} />
          </button>
        </div>

        {/* Invited via link banner */}
        {initialRoomId && !isCreatingNew && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-rose-600/20 text-rose-400 flex items-center justify-center shrink-0">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <span className="text-slate-300">Davet bağlantısıyla geldiniz: </span>
                <strong className="text-rose-400 font-mono font-bold">#{initialRoomId}</strong>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setIsCreatingNew(true)}
                className="text-[11px] text-slate-400 hover:text-rose-300 underline underline-offset-2"
              >
                Kendi odamı oluştur
              </button>
              <span className="text-[10px] text-emerald-400 font-medium bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-md">
                Katılmaya Hazır
              </span>
            </div>
          </div>
        )}

        {/* Active Live Rooms List (Discovery) */}
        {activeRooms.length > 0 && (
          <div className="mb-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Radio className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                <span>Şu Anda Açık Odalar ({activeRooms.length})</span>
              </div>
              <span className="text-[10px] text-slate-400">Doğrudan tıklayıp katılabilirsiniz</span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activeRooms.map((room) => {
                const isSelected = !isCreatingNew && joinRoomId.toLowerCase() === room.id.toLowerCase();
                return (
                  <div
                    key={room.id}
                    onClick={() => handleSelectActiveRoom(room)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border text-xs ${
                      isSelected
                        ? 'bg-rose-950/50 border-rose-600 text-white shadow-xs'
                        : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 font-medium truncate">
                        <span className="truncate">{room.name}</span>
                        <span className="font-mono text-[10px] text-rose-400 font-bold bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-900/50 shrink-0">
                          #{room.id}
                        </span>
                        {room.hasPassword && (
                          <span title="Şifreli Oda">
                            <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1 text-slate-300">
                          <Users className="w-3 h-3 text-indigo-400" />
                          <strong>{room.userCount}</strong> kişi odada
                        </span>
                        <span>•</span>
                        <span className="truncate text-slate-400">Kurucu: {room.hostName}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectActiveRoom(room);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors shrink-0 ${
                        isSelected
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white border border-slate-700'
                      }`}
                    >
                      {isSelected ? 'Seçildi ✓' : 'Bu Odaya Katıl'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab: Yeni Oda Oluştur vs Odaya Katıl */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-lg mb-4 border border-slate-800">
          <button
            type="button"
            onClick={() => setIsCreatingNew(true)}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
              isCreatingNew ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>✨ Yeni Oda Oluştur</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingNew(false)}
            className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
              !isCreatingNew ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🔗 Odaya Katıl</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* User Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Adınız / Takma Adınız <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Örn: Ahmet, Burcu..."
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
            />
          </div>

          {/* New Room Setup */}
          {isCreatingNew ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Oda Kodu (Otomatik Belirlendi)
                </label>
                <button
                  type="button"
                  onClick={handleRegenerateCode}
                  className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Yeni Kod Üret</span>
                </button>
              </div>
              <div className="relative flex items-center">
                <input
                  type="text"
                  required
                  value={customRoomId}
                  onChange={(e) => setCustomRoomId(e.target.value.toLowerCase().trim())}
                  placeholder="Oda kodu"
                  className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-rose-400 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono font-bold tracking-wider"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Arkadaşlarınızla aynı odaya bağlanmak için bu kodu paylaşacaksınız.
              </p>
            </div>
          ) : (
            /* Join Existing Room Input with Live Status */
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Oda Kodu (Room ID) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Örn: c7x9p2"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toLowerCase().trim())}
                className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono tracking-wider font-semibold"
              />

              {/* Status Indicator for Typed Code */}
              {joinRoomId.trim().length > 0 && (
                <div className="mt-1.5">
                  {matchedActiveRoom ? (
                    <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-center gap-2 text-emerald-400 text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Aktif oda bulundu: <strong>{matchedActiveRoom.name}</strong> ({matchedActiveRoom.userCount} kişi yayında)
                      </span>
                    </div>
                  ) : (
                    <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-800/50 flex items-start gap-2 text-amber-300 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <span>Bu kodda (#{joinRoomId}) henüz açık bir oda görünmüyor.</span>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Arkadaşınız odayı kurduysa kodun birebir aynı olduğundan emin olun veya yukarıdaki listeden bir odaya tıklayın.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Encryption / Room Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Oda Şifresi (Uçtan Uca Şifreleme)</span>
              </label>
              <span className="text-[10px] text-slate-500">İsteğe Bağlı</span>
            </div>
            <input
              type="password"
              placeholder="Oda parolası (varsa)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Parola girildiğinde mesajlarınız ve oda trafiği AES-GCM ile şifrelenir.</span>
            </p>
          </div>

          {/* Submit CTA */}
          <button
            type="submit"
            disabled={
              !userName.trim() ||
              (isCreatingNew && !customRoomId.trim()) ||
              (!isCreatingNew && !joinRoomId.trim())
            }
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shadow-md shadow-rose-950/40 active:scale-98 mt-2"
          >
            <span>
              {isCreatingNew
                ? `Sinema Odasını Başlat (#${customRoomId || 'yeni'})`
                : matchedActiveRoom
                ? `${matchedActiveRoom.name}'e Bağlan`
                : `#${joinRoomId || '...'} Odasına Bağlan`}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
