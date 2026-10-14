import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { CinemaStage } from './components/CinemaStage';
import { CameraGrid } from './components/CameraGrid';
import { ChatPanel } from './components/ChatPanel';
import { MovieDiscovery } from './components/MovieDiscovery';
import { RoomModal } from './components/RoomModal';
import { ShareRoomModal } from './components/ShareRoomModal';
import { RoomState, RoomUser, VideoState, ChatMessage, EmojiReaction, MovieSuggestion } from './types';
import { socket } from './services/socket';
import { webrtc } from './services/webrtc';
import { deriveKeyFromPassword, encryptMessage, decryptMessage } from './services/crypto';
import { Copy, ShieldCheck, Check, MonitorUp, Film } from 'lucide-react';

const AVATAR_COLORS = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

export default function App() {
  // Room & Identity State
  const [roomId, setRoomId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [userColor, setUserColor] = useState<string>('#e11d48');
  const [userId] = useState<string>(() => 'usr_' + Math.random().toString(36).substring(2, 9));
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [roomName, setRoomName] = useState<string>('Sinema Odası');

  // Share Modal State
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);

  // Media & Video Sync State - INITIAL PLAYER IS EMPTY (NO AUTOPLAY)
  const [videoState, setVideoState] = useState<VideoState>({
    sourceType: 'youtube',
    sourceUrl: '', // EMPTY INITIAL STATE
    sourceTitle: 'İçerik Bekleniyor',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    lastUpdated: Date.now(),
    updatedBy: 'Sistem',
    playbackRate: 1,
  });

  // Screen Share Stream
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isSharingScreen, setIsSharingScreen] = useState<boolean>(false);

  // WebRTC Camera & Mic State
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [hasCamera, setHasCamera] = useState<boolean>(false);
  const [hasMic, setHasMic] = useState<boolean>(true);
  const [isPushToTalkMode, setIsPushToTalkMode] = useState<boolean>(false); // default open mic so sound works immediately
  const [isPushToTalkActive, setIsPushToTalkActive] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speakingVolume, setSpeakingVolume] = useState<number>(0);

  // Users & Room Metadata
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<EmojiReaction[]>([]);
  const [activeVote, setActiveVote] = useState<RoomState['activeVote']>();

  // UI Navigation Tabs
  const [activeTab, setActiveTab] = useState<'cinema' | 'discovery' | 'settings'>('cinema');
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const isPttKeyDownRef = useRef<boolean>(false);

  // 1. Initial URL search params check
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    const urlPwd = params.get('pwd');
    if (urlRoom) {
      setRoomId(urlRoom);
    }
    if (urlPwd) {
      setRoomPassword(urlPwd);
    }
  }, []);

  // 2. Push-To-Talk Keyboard Listener (Space or V)
  useEffect(() => {
    if (!isJoined || !isPushToTalkMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.code === 'Space' || e.key === 'v' || e.key === 'V') && !isPttKeyDownRef.current) {
        e.preventDefault();
        isPttKeyDownRef.current = true;
        setIsPushToTalkActive(true);
        webrtc.triggerPushToTalk(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.code === 'Space' || e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        isPttKeyDownRef.current = false;
        setIsPushToTalkActive(false);
        webrtc.triggerPushToTalk(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isJoined, isPushToTalkMode]);

  // 3. Socket event subscriptions & WebRTC Signaling
  useEffect(() => {
    if (!isJoined) return;

    // Set WebRTC callbacks
    webrtc.setCallbacks(
      (streams) => {
        setRemoteStreams(new Map(streams));
      },
      (speaking, vol) => {
        setIsSpeaking(speaking);
        setSpeakingVolume(vol);
      }
    );

    // A. Room full state on join
    const unsubRoomState = socket.on('room:state', ({ data }) => {
      if (!data) return;
      if (data.name) setRoomName(data.name);
      if (data.video && data.video.sourceUrl) {
        setVideoState(data.video);
      }
      if (data.users) {
        setUsers(data.users);
        // Initiate peer connection to other existing users in the room
        data.users.forEach((otherUser: RoomUser) => {
          if (otherUser.id !== userId) {
            webrtc.createPeer(otherUser.id, true);
          }
        });
      }
      if (data.activeVote) setActiveVote(data.activeVote);
    });

    // B. User Joined
    const unsubUserJoined = socket.on('user:joined', ({ data }) => {
      if (data?.allUsers) {
        setUsers(data.allUsers);
      }
      if (data?.user && data.user.id !== userId) {
        // Create peer connection to newcomer
        webrtc.createPeer(data.user.id, true);

        setMessages((prev) => [
          ...prev,
          {
            id: 'sys_' + Date.now(),
            senderId: 'system',
            senderName: 'Sistem',
            senderColor: '#94a3b8',
            text: `${data.user.name} odaya katıldı.`,
            timestamp: Date.now(),
            isSystem: true,
          },
        ]);
      }
    });

    // C. User Left
    const unsubUserLeft = socket.on('user:left', ({ data, userId: leftUserId }) => {
      const targetId = leftUserId || data?.userId;
      if (targetId) {
        webrtc.removePeer(targetId);
      }
      if (data?.remainingUsers) {
        setUsers(data.remainingUsers);
      }
      if (data?.userName) {
        setMessages((prev) => [
          ...prev,
          {
            id: 'sys_' + Date.now(),
            senderId: 'system',
            senderName: 'Sistem',
            senderColor: '#94a3b8',
            text: `${data.userName} odadan ayrıldı.`,
            timestamp: Date.now(),
            isSystem: true,
          },
        ]);
      }
    });

    // WebRTC Signaling Handlers
    const unsubOffer = socket.on('signal:offer', ({ data, senderId }) => {
      if (senderId && senderId !== userId) {
        webrtc.handleOffer(senderId, data);
      }
    });

    const unsubAnswer = socket.on('signal:answer', ({ data, senderId }) => {
      if (senderId && senderId !== userId) {
        webrtc.handleAnswer(senderId, data);
      }
    });

    const unsubCandidate = socket.on('signal:candidate', ({ data, senderId }) => {
      if (senderId && senderId !== userId) {
        webrtc.handleCandidate(senderId, data);
      }
    });

    // D. Video Sync
    const unsubSyncVideo = socket.on('sync:video', ({ data, senderId }) => {
      if (senderId === userId) return;
      if (data) {
        setVideoState(data);
      }
    });

    // E. User State Update (Mic, Cam, Screen, Speaking)
    const unsubUserState = socket.on('user:state_update', ({ userId: targetUserId, data }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUserId ? { ...u, ...data } : u))
      );
    });

    // F. Chat Message with E2EE Decryption
    const unsubChatMessage = socket.on('chat:message', async ({ data }) => {
      if (!data) return;
      let displayText = data.text;
      if (data.isEncrypted && data.ciphertext && data.iv) {
        displayText = await decryptMessage(data.ciphertext, data.iv, cryptoKey);
      }

      setMessages((prev) => [
        ...prev,
        {
          ...data,
          text: displayText,
        },
      ]);
    });

    // G. Emoji Reaction
    const unsubChatReaction = socket.on('chat:reaction', ({ data }) => {
      if (!data) return;
      setReactions((prev) => [...prev, data]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== data.id));
      }, 3000);
    });

    // H. Vote Update
    const unsubVoteUpdate = socket.on('vote:update', ({ data }) => {
      setActiveVote(data);
    });

    return () => {
      unsubRoomState();
      unsubUserJoined();
      unsubUserLeft();
      unsubOffer();
      unsubAnswer();
      unsubCandidate();
      unsubSyncVideo();
      unsubUserState();
      unsubChatMessage();
      unsubChatReaction();
      unsubVoteUpdate();
    };
  }, [isJoined, userId, cryptoKey]);

  // Join Room Handler
  const handleJoinRoom = async (
    name: string,
    targetRoom: string,
    password: string,
    asHost: boolean
  ) => {
    setUserName(name);
    setRoomId(targetRoom);
    setRoomPassword(password);
    setIsHost(asHost);

    const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    setUserColor(randomColor);

    // Derive E2EE key if password provided
    let key: CryptoKey | null = null;
    if (password.trim()) {
      key = await deriveKeyFromPassword(password.trim());
      setCryptoKey(key);
    }

    // Update URL query parameters for easy copy & sharing
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', targetRoom);
    if (password.trim()) {
      newUrl.searchParams.set('pwd', password.trim());
    }
    window.history.replaceState({}, '', newUrl.toString());

    // Initialize WebRTC and Socket
    webrtc.setUserId(userId);
    webrtc.setPushToTalkMode(isPushToTalkMode);

    // Request both camera and mic on join so user has ready media
    const stream = await webrtc.startLocalMedia(true, true);
    if (stream) {
      setLocalStream(stream);
      setHasCamera(stream.getVideoTracks().length > 0);
      setHasMic(stream.getAudioTracks().length > 0);
    }

    // Connect socket
    socket.init(targetRoom, userId, name, randomColor, asHost);
    setIsJoined(true);
  };

  // Video State Update & Broadcast
  const handleUpdateVideo = (update: Partial<VideoState>) => {
    const nextState = {
      ...videoState,
      ...update,
      lastUpdated: Date.now(),
      updatedBy: userName,
    };
    setVideoState(nextState);
    socket.syncVideo(nextState);
  };

  // 1080p Screen & Tab Sharing (Netflix & Video Sites)
  const handleStartScreenShare = async () => {
    const stream = await webrtc.startHighQualityScreenShare();
    if (stream) {
      setScreenStream(stream);
      setIsSharingScreen(true);
      handleUpdateVideo({
        sourceType: 'screenshare',
        sourceTitle: `${userName}'in Canlı Sekme / Film Yayını`,
        isPlaying: true,
      });
    }
  };

  const handleStopScreenShare = () => {
    webrtc.stopScreenShare();
    setScreenStream(null);
    setIsSharingScreen(false);
    handleUpdateVideo({
      sourceType: 'youtube',
      sourceUrl: '',
      sourceTitle: 'İçerik Bekleniyor',
      isPlaying: false,
    });
  };

  // Push-To-Talk Toggle
  const handleTogglePushToTalkMode = (enabled: boolean) => {
    setIsPushToTalkMode(enabled);
    webrtc.setPushToTalkMode(enabled);
  };

  const handlePushToTalkTrigger = (active: boolean) => {
    setIsPushToTalkActive(active);
    webrtc.triggerPushToTalk(active);
  };

  // Camera & Mic Toggles
  const handleToggleCamera = async () => {
    const nextState = !hasCamera;
    setHasCamera(nextState);

    // If stream doesn't have video track or is null, request with camera
    if (nextState && (!localStream || localStream.getVideoTracks().length === 0)) {
      const stream = await webrtc.startLocalMedia(true, hasMic);
      if (stream) {
        setLocalStream(stream);
      }
    } else {
      webrtc.toggleCamera(nextState);
    }
  };

  const handleToggleMic = async () => {
    const nextState = !hasMic;
    setHasMic(nextState);

    if (nextState && (!localStream || localStream.getAudioTracks().length === 0)) {
      const stream = await webrtc.startLocalMedia(hasCamera, true);
      if (stream) {
        setLocalStream(stream);
      }
    } else {
      webrtc.toggleMic(nextState);
    }
  };

  // Chat message submission
  const handleSendMessage = async (text: string) => {
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    let ciphertext = text;
    let iv = '';
    let isEncrypted = false;

    if (cryptoKey) {
      const enc = await encryptMessage(text, cryptoKey);
      ciphertext = enc.ciphertext;
      iv = enc.iv;
      isEncrypted = enc.isEncrypted;
    }

    const payload: ChatMessage = {
      id: msgId,
      senderId: userId,
      senderName: userName,
      senderColor: userColor,
      text: isEncrypted ? ciphertext : text,
      timestamp: Date.now(),
      isEncrypted,
    };

    (payload as any).ciphertext = ciphertext;
    (payload as any).iv = iv;

    socket.sendChatMessage(payload);

    setMessages((prev) => [
      ...prev,
      {
        ...payload,
        text,
      },
    ]);
  };

  // Floating Emoji Reaction Trigger
  const handleTriggerReaction = (emoji: string) => {
    const reaction: EmojiReaction = {
      id: 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      emoji,
      senderName: userName,
      timestamp: Date.now(),
      xOffset: Math.floor(Math.random() * 80) + 10,
    };

    socket.sendReaction(reaction);
    setReactions((prev) => [...prev, reaction]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
    }, 3000);
  };

  // Movie Discovery: Load into Cinema
  const handleLoadMovieIntoCinema = (title: string, url: string) => {
    handleUpdateVideo({
      sourceType: 'youtube',
      sourceUrl: url,
      sourceTitle: title,
      currentTime: 0,
      isPlaying: true,
    });
    setActiveTab('cinema');
  };

  // Movie Discovery: Start Poll
  const handleStartVote = (movie: MovieSuggestion) => {
    const voteData = {
      id: 'vote_' + Date.now(),
      movie,
      yesVotes: [userId],
      noVotes: [],
      initiatedBy: userName,
      expiresAt: Date.now() + 60000,
    };
    setActiveVote(voteData);
    socket.updateVote(voteData);
  };

  // Movie Discovery: Cast Vote
  const handleCastVote = (vote: 'yes' | 'no') => {
    if (!activeVote) return;
    const yes = new Set(activeVote.yesVotes);
    const no = new Set(activeVote.noVotes);

    if (vote === 'yes') {
      yes.add(userId);
      no.delete(userId);
    } else {
      no.add(userId);
      yes.delete(userId);
    }

    const updated = {
      ...activeVote,
      yesVotes: Array.from(yes),
      noVotes: Array.from(no),
    };
    setActiveVote(updated);
    socket.updateVote(updated);
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
      {/* 1. Room Creation / Join Modal (if not joined) */}
      {!isJoined && (
        <RoomModal
          initialRoomId={roomId}
          initialPassword={roomPassword}
          onJoinRoom={handleJoinRoom}
        />
      )}

      {/* 2. Share Room Modal (Room Code + Link Copy) */}
      <ShareRoomModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        roomId={roomId}
        roomName={roomName}
        hasPassword={Boolean(cryptoKey || roomPassword)}
        password={roomPassword}
      />

      {/* 3. Top Bar Navigation */}
      <Header
        roomId={roomId}
        roomName={roomName}
        hasPassword={Boolean(cryptoKey || roomPassword)}
        participantCount={users.length || 1}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onShareRoom={() => setIsShareModalOpen(true)}
        isCopied={isCopied}
      />

      {/* 4. Main Body Content Area */}
      <main className="flex-1 p-3 md:p-5 max-w-[1720px] w-full mx-auto flex flex-col gap-4">
        {/* TAB 1: Sinema Sahnesi & Birlikte İzleme */}
        {activeTab === 'cinema' && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-3">
              {/* Primary Cinema Video Player with auto-hide controls & fullscreen cameras */}
              <CinemaStage
                videoState={videoState}
                onUpdateVideo={handleUpdateVideo}
                isHost={isHost}
                screenStream={screenStream}
                onStartScreenShare={handleStartScreenShare}
                onStopScreenShare={handleStopScreenShare}
                isSharingScreen={isSharingScreen}
                reactions={reactions}
                onTriggerReaction={handleTriggerReaction}
                onOpenDiscovery={() => setActiveTab('discovery')}
                users={users}
                localStream={localStream}
                remoteStreams={remoteStreams}
                currentUserId={userId}
                hasCamera={hasCamera}
              />

              {/* Resizable Camera Grid & Push-To-Talk Control Bar */}
              <CameraGrid
                users={users.length > 0 ? users : [{
                  id: userId,
                  name: userName || 'Sen',
                  avatarColor: userColor,
                  isHost,
                  hasCamera,
                  hasMic,
                  isSpeaking,
                  isSharingScreen,
                  joinedAt: Date.now(),
                }]}
                currentUserId={userId}
                localStream={localStream}
                remoteStreams={remoteStreams}
                isPushToTalkMode={isPushToTalkMode}
                onTogglePushToTalkMode={handleTogglePushToTalkMode}
                isPushToTalkActive={isPushToTalkActive}
                onPushToTalkTrigger={handlePushToTalkTrigger}
                hasCamera={hasCamera}
                onToggleCamera={handleToggleCamera}
                hasMic={hasMic}
                onToggleMic={handleToggleMic}
                isSpeaking={isSpeaking}
                speakingVolume={speakingVolume}
              />
            </div>

            {/* Right Side: Live Encrypted Chat & Reactions */}
            <div className="lg:col-span-4 xl:col-span-3 h-[520px] lg:h-[calc(100vh-120px)] sticky top-16">
              <ChatPanel
                messages={messages}
                onSendMessage={handleSendMessage}
                users={users.length > 0 ? users : [{
                  id: userId,
                  name: userName || 'Sen',
                  avatarColor: userColor,
                  isHost,
                  hasCamera,
                  hasMic,
                  isSpeaking,
                  isSharingScreen,
                  joinedAt: Date.now(),
                }]}
                currentUserId={userId}
                isEncrypted={Boolean(cryptoKey)}
                onTriggerReaction={handleTriggerReaction}
              />
            </div>
          </div>
        )}

        {/* TAB 2: Film Keşfet & AI Öneri Motoru */}
        {activeTab === 'discovery' && (
          <div className="flex-1 max-w-5xl mx-auto w-full h-[calc(100vh-120px)]">
            <MovieDiscovery
              onLoadMovieIntoCinema={handleLoadMovieIntoCinema}
              isHost={isHost}
              currentUserId={userId}
              activeVote={activeVote}
              onStartVote={handleStartVote}
              onCastVote={handleCastVote}
            />
          </div>
        )}

        {/* TAB 3: Oda Ayarları & Şifreleme Bilgisi */}
        {activeTab === 'settings' && (
          <div className="flex-1 max-w-3xl mx-auto w-full bg-[#0e1424] border border-slate-800/80 rounded-xl p-6 shadow-xl space-y-6">
            <div>
              <h2 className="text-base font-bold text-white mb-1">Oda & Güvenlik Ayarları</h2>
              <p className="text-xs text-slate-400">
                Oda bağlantısını ve kodunu arkadaşlarınızla paylaşın veya uçtan uca şifreleme detaylarını inceleyin.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-slate-300 block">
                Oda Paylaşım Bilgisi
              </span>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-slate-400">Oda Kodu:</span>
                  <span className="font-mono text-lg font-bold text-rose-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                    {roomId}
                  </span>
                </div>
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm w-full sm:w-auto justify-center"
                >
                  <span>Paylaşım Penceresini Aç</span>
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-xs font-bold text-white">Uçtan Uca Şifreleme (AES-GCM 256-bit)</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Odanız {cryptoKey ? 'oda parolasıyla uçtan uca şifrelenmiştir.' : 'şifresiz genel odadır.'}
                {cryptoKey &&
                  ' Mesajlarınız ve anlık tepkileriniz tarayıcınızda PBKDF2 (100.000 iterasyon) ile türetilen AES-GCM anahtarıyla şifrelenir. Sunucu dahil hiç kimse mesaj içeriğini okuyamaz.'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <MonitorUp className="w-5 h-5 text-rose-400" />
                <h3 className="text-xs font-bold text-white">Netflix & Film Sitelerini Beraber İzleme İpucu</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Netflix, Disney+, Prime Video veya herhangi bir film sitesinden bir içerik izlemek istediğinizde, üst kısımdaki <strong>"Ekran / Film Sekmesi Paylaş"</strong> butonuna basın ve filmin açık olduğu <strong>Tarayıcı Sekmesini</strong> seçin. <em>"Sekme sesini de paylaş"</em> seçeneğinin işaretli olduğundan emin olun. Görüntü 1080p 60fps yüksek bit-rate ve stereo film sesiyle odaya aktarılacaktır.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
