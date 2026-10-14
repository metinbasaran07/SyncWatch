import React, { useState, useEffect } from 'react';
import { Film, ShieldCheck, Lock, Users, Sparkles, ArrowRight, UserCheck } from 'lucide-react';

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
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [password, setPassword] = useState(initialPassword);
  const [isCreatingNew, setIsCreatingNew] = useState(!initialRoomId);

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
      setIsCreatingNew(false);
    }
    if (initialPassword) {
      setPassword(initialPassword);
    }
  }, [initialRoomId, initialPassword]);

  const generateRandomRoomId = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < 6; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    let targetRoom = roomId.trim().toLowerCase();
    if (isCreatingNew) {
      targetRoom = generateRandomRoomId();
    } else if (!targetRoom && initialRoomId) {
      targetRoom = initialRoomId.trim().toLowerCase();
    }

    onJoinRoom(userName.trim(), targetRoom, password.trim(), isCreatingNew);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#090d16]/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl p-5 sm:p-7 w-full max-w-md shadow-2xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-rose-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-950/50">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">CineSync Odası</h2>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Eşzamanlı video izleme & canlı kamera alanı
            </p>
          </div>
        </div>

        {/* Invited via link banner */}
        {initialRoomId && !isCreatingNew && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/60 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-rose-600/20 text-rose-400 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <span className="text-slate-300">Bir odaya davet edildiniz: </span>
              <strong className="text-rose-400 font-mono">#{initialRoomId}</strong>
            </div>
          </div>
        )}

        {/* Tab: Yeni Oda vs Odaya Katıl */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-lg mb-4 border border-slate-800">
          <button
            type="button"
            onClick={() => setIsCreatingNew(true)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              isCreatingNew ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            Yeni Oda Kur
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingNew(false)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              !isCreatingNew ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            Odaya Katıl
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* User Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Adınız / Takma Adınız
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Örn: Ahmet, Burcu..."
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          {/* Room ID (if joining existing) */}
          {!isCreatingNew && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Oda Kodu (Room ID)
              </label>
              <input
                type="text"
                required
                placeholder="Örn: c7x9p2"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono tracking-wider font-semibold"
              />
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
              <span>Parola girildiğinde mesajlarınız AES-GCM ile uçtan uca şifrelenir.</span>
            </p>
          </div>

          {/* Submit CTA */}
          <button
            type="submit"
            disabled={!userName.trim() || (!isCreatingNew && !roomId.trim())}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shadow-md shadow-rose-950/40 active:scale-98 mt-2"
          >
            <span>{isCreatingNew ? 'Sinema Odasını Başlat' : 'Odaya Bağlan'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
