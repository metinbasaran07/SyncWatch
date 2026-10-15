import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ShieldCheck, Lock, Share2, Link as LinkIcon, KeyRound, Unlock, Save, QrCode, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';

interface ShareRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  password?: string;
  isHost?: boolean;
  onUpdatePassword?: (newPassword: string) => void;
}

export const ShareRoomModal: React.FC<ShareRoomModalProps> = ({
  isOpen,
  onClose,
  roomId,
  roomName,
  hasPassword,
  password = '',
  isHost = false,
  onUpdatePassword,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState(password);
  const [passwordSavedNotice, setPasswordSavedNotice] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [showQrCode, setShowQrCode] = useState<boolean>(true);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isAisDev = origin.includes('ais-dev-');
  const publicOrigin = isAisDev ? origin.replace('ais-dev-', 'ais-pre-') : origin;

  const roomLink = typeof window !== 'undefined' && roomId
    ? `${publicOrigin}/?room=${encodeURIComponent(roomId)}${password ? `&pwd=${encodeURIComponent(password)}` : ''}`
    : typeof window !== 'undefined'
    ? window.location.href
    : `https://cinesync.app/?room=${roomId}`;

  useEffect(() => {
    if (isOpen && roomLink && roomId) {
      QRCode.toDataURL(roomLink, {
        width: 220,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((url) => setQrCodeUrl(url))
        .catch((err) => console.error('QR code generation failed:', err));
    }
  }, [isOpen, roomLink, roomId]);

  const copyTextToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      return false;
    }
  };

  const handleCopyCode = async () => {
    if (!roomId) return;
    await copyTextToClipboard(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = async () => {
    if (!roomLink) return;
    await copyTextToClipboard(roomLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSavePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdatePassword) {
      onUpdatePassword(newPasswordInput.trim());
      setPasswordSavedNotice(true);
      setTimeout(() => setPasswordSavedNotice(false), 2500);
    }
  };

  const handleRemovePassword = () => {
    if (onUpdatePassword) {
      setNewPasswordInput('');
      onUpdatePassword('');
      setPasswordSavedNotice(true);
      setTimeout(() => setPasswordSavedNotice(false), 2500);
    }
  };

  // CRITICAL: If modal is not open, render nothing!
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0f172a] border border-slate-700/80 rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          type="button"
          aria-label="Kapat"
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-600/20 text-rose-400 flex items-center justify-center border border-rose-500/30 shrink-0">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Odayı Paylaş & Güvenlik</h3>
            <p className="text-xs text-slate-400">{roomName || 'CineSync Odası'}</p>
          </div>
        </div>

        <div className="space-y-3.5">
          {/* 1. ROOM CODE DISPLAY */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider">
              ODA KODU
            </span>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xl sm:text-2xl font-black text-rose-400 tracking-widest selection:bg-rose-600">
                {roomId}
              </span>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all active:scale-95"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Kopyalandı!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Kodu Kopyala</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Arkadaşlarınız bu kodu ana sayfadaki "Odaya Katıl" kısmına yazabilir.
            </p>
          </div>

          {/* 2. DIRECT INVITE LINK */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider flex items-center gap-1">
              <LinkIcon className="w-3.5 h-3.5 text-slate-400" />
              <span>DİREKT DAVET BAĞLANTISI</span>
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={roomLink}
                className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-300 font-mono truncate focus:outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-all active:scale-95 whitespace-nowrap shadow-sm"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Kopyalandı!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Linki Kopyala</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* QR CODE FOR INSTANT MOBILE CONNECT */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-rose-400" />
                <span>KAREKOD İLE DİĞER CİHAZDAN / TELEFONDAN KATIL</span>
              </span>
              <button
                type="button"
                onClick={() => setShowQrCode(!showQrCode)}
                className="text-[10px] text-slate-400 hover:text-white underline"
              >
                {showQrCode ? 'Gizle' : 'Göster'}
              </button>
            </div>

            {showQrCode && (
              <div className="flex flex-col sm:flex-row items-center gap-3.5 pt-1">
                {qrCodeUrl ? (
                  <div className="p-2 bg-white rounded-xl shadow-md shrink-0">
                    <img
                      src={qrCodeUrl}
                      alt="Oda Bağlantısı Karekod"
                      className="w-28 h-28 sm:w-32 sm:h-32 object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                    <span className="text-[10px] text-slate-500">Karekod hazırlanıyor...</span>
                  </div>
                )}
                <div className="flex flex-col gap-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-white">
                    <Smartphone className="w-4 h-4 text-rose-400" />
                    <span>Telefon Kamerasıyla Taratın</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Telefonunuzun kamerasını karekoda tutun; tarayıcınız tam olarak aynı sunucu ve odaya otomatik bağlanacaktır.
                  </p>
                  <span className="text-[10px] text-emerald-400 font-medium mt-0.5">
                    ✓ Aynı ağda olmasanız bile (4G/5G dahil) TURN üzerinden bağlanır.
                  </span>
                  <span className="text-[10px] text-sky-400 font-medium mt-0.5">
                    ✓ Firebase Bulut Eşzamanlama aktif: Tüm cihazlar ve ağlar arası canlı senkronizasyon.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. HOST PASSWORD MANAGEMENT (Odayı kuran kişi şifreyi değiştirebilsin) */}
          {isHost ? (
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                  <span>Oda Şifresi Yönetimi (Kurucu)</span>
                </span>
                {passwordSavedNotice && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Güncellendi!
                  </span>
                )}
              </div>

              <form onSubmit={handleSavePassword} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Yeni oda şifresi belirleyin"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Kaydet</span>
                  </button>
                </div>

                {hasPassword && (
                  <button
                    type="button"
                    onClick={handleRemovePassword}
                    className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-rose-400 py-1 transition-colors"
                  >
                    <Unlock className="w-3 h-3" />
                    <span>Şifreyi Kaldır (Odayı Herkese Aç)</span>
                  </button>
                )}
              </form>
              <p className="text-[10px] text-slate-400">
                Şifre değiştiğinde odadaki tüm katılımcıların uçtan uca şifreleme anahtarı ve davet linki anında güncellenir.
              </p>
            </div>
          ) : (
            hasPassword ? (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>Bu oda uçtan uca şifrelidir (AES-GCM). Davet bağlantısı şifreyi içerir.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>Açık oda: Bağlantıya veya koda sahip herkes katılabilir.</span>
              </div>
            )
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
