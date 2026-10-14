import React, { useState, useRef, useEffect } from 'react';
import { Send, Smile, Lock, ShieldCheck, Users, MessageSquare } from 'lucide-react';
import { ChatMessage, RoomUser } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  users: RoomUser[];
  currentUserId: string;
  isEncrypted: boolean;
  onTriggerReaction: (emoji: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  users,
  currentUserId,
  isEncrypted,
  onTriggerReaction,
}) => {
  const [inputText, setInputText] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'chat' | 'users'>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0e1424] border border-slate-800/80 rounded-xl overflow-hidden shadow-xl">
      {/* Tab Switcher: Sohbet vs Katılımcılar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveSubTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-colors ${
              activeSubTab === 'chat'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Canlı Sohbet</span>
          </button>

          <button
            onClick={() => setActiveSubTab('users')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold transition-colors ${
              activeSubTab === 'users'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Kişiler ({users.length})</span>
          </button>
        </div>

        {/* E2EE indicator */}
        <div className="flex items-center gap-1 text-[11px]">
          {isEncrypted ? (
            <span className="flex items-center gap-1 text-emerald-400 font-mono" title="AES-GCM Uçtan Uca Şifreli">
              <ShieldCheck className="w-3.5 h-3.5" />
              E2EE
            </span>
          ) : (
            <span className="text-slate-500 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Genel
            </span>
          )}
        </div>
      </div>

      {/* Main Tab Content */}
      {activeSubTab === 'chat' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
                <Smile className="w-8 h-8 mb-2 text-slate-600" />
                <p className="font-semibold text-slate-300">Sohbet Başlasın!</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Arkadaşlarınızla film izlerken anlık yorumlarınızı buradan paylaşabilirsiniz.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.senderId === currentUserId;

                if (msg.isSystem) {
                  return (
                    <div
                      key={msg.id}
                      className="text-center text-[10px] text-slate-400 bg-slate-900/60 py-1 px-2.5 rounded-full mx-auto w-fit border border-slate-800/80"
                    >
                      {msg.text}
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-slate-400">
                      <span
                        className="font-semibold truncate max-w-[120px]"
                        style={{ color: msg.senderColor || '#94a3b8' }}
                      >
                        {isMe ? 'Sen' : msg.senderName}
                      </span>
                      <span className="font-mono text-slate-600">{formatTimestamp(msg.timestamp)}</span>
                    </div>

                    <div
                      className={`px-3 py-2 rounded-xl text-xs max-w-[85%] break-words ${
                        isMe
                          ? 'bg-rose-600 text-white rounded-tr-xs shadow-xs'
                          : 'bg-slate-800 text-slate-100 rounded-tl-xs border border-slate-700/80'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Reaction Bar */}
          <div className="px-3 py-1.5 bg-slate-950/80 border-t border-slate-800/60 flex items-center justify-between text-base">
            <span className="text-[10px] text-slate-400">Hızlı Tepki:</span>
            <div className="flex items-center gap-1">
              {['🍿', '😂', '🔥', '❤️', '😱', '🤫'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onTriggerReaction(emoji)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Input Box */}
          <form
            onSubmit={handleSubmit}
            className="p-2.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              placeholder={isEncrypted ? "🔒 Şifreli mesaj yaz..." : "Bir mesaj yaz..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 px-3 py-2 text-xs bg-slate-900 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white transition-colors"
              title="Gönder"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        /* Users List View */
        <div className="flex-1 p-3 overflow-y-auto space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white"
                  style={{ backgroundColor: u.avatarColor || '#e11d48' }}
                >
                  {u.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-200">
                    {u.name} {u.id === currentUserId ? '(Sen)' : ''}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {u.isHost ? 'Oda Kurucusu' : 'İzleyici'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                {u.hasCamera && <span className="text-emerald-400 text-[10px]">Kamera</span>}
                {u.hasMic && <span className="text-blue-400 text-[10px]">Mikrofon</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
