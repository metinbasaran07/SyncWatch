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
import { MessageSquare, ShieldCheck } from 'lucide-react';

const AVATAR_COLORS = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

export default function App() {
  // Synchronous URL param extraction so second device is immediately in the correct room!
  const [roomId, setRoomId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || '';
    }
    return '';
  });

  const [roomPassword, setRoomPassword] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('pwd') || '';
    }
    return '';
  });

  const [userName, setUserName] = useState<string>('');
  const [userColor, setUserColor] = useState<string>('#e11d48');
  const [userId] = useState<string>(() => 'usr_' + Math.random().toString(36).substring(2, 9));
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [roomName, setRoomName] = useState<string>('Sinema Odası');

  // Share Modal & Chat Toggle State
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024; // Open by default on desktop, closed on mobile
    }
    return true;
  });

  // Empty initial video state (no autoplay on initial site load)
  const [videoState, setVideoState] = useState<VideoState>({
    sourceType: 'youtube',
    sourceUrl: '',
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
  const [isPushToTalkMode, setIsPushToTalkMode] = useState<boolean>(false); // default open mic so voice is heard immediately
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

  const isPttKeyDownRef = useRef<boolean>(false);

  // 1. Push-To-Talk Keyboard Listener (Space or V)
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

  // 2. Socket Event Subscriptions & Multi-Device Peer Handling
  useEffect(() => {
    if (!isJoined) return;

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
      if (data.users && Array.isArray(data.users)) {
        setUsers(data.users);
        data.users.forEach((otherUser: RoomUser) => {
          if (otherUser.id !== userId) {
            // Deterministic initiator to eliminate WebRTC offer collision
            const isInitiator = userId > otherUser.id;
            webrtc.createPeer(otherUser.id, isInitiator);
          }
        });
      }
      if (data.activeVote) setActiveVote(data.activeVote);
    });

    // A2. Incremental room users sync
    const unsubUsersUpdated = socket.on('room:users_updated', ({ data }) => {
      if (Array.isArray(data)) {
        setUsers(data);
        data.forEach((otherUser: RoomUser) => {
          if (otherUser.id !== userId) {
            const isInitiator = userId > otherUser.id;
            webrtc.createPeer(otherUser.id, isInitiator);
          }
        });
      }
    });

    // B. User Joined
    const unsubUserJoined = socket.on('user:joined', ({ data }) => {
      if (data?.allUsers) {
        setUsers(data.allUsers);
      }
      if (data?.user && data.user.id !== userId) {
        const isInitiator = userId > data.user.id;
        webrtc.createPeer(data.user.id, isInitiator);

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
    const unsubUserLeft = socket.on('user:left', ({ data, senderId }) => {
      const targetId = data?.userId || senderId;
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

    // WebRTC Signaling
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

    // E. User State Update
    const unsubUserState = socket.on('user:state_update', ({ data, senderId }) => {
      const targetUserId = data?.userId || senderId;
      if (targetUserId) {
        setUsers((prev) =>
          prev.map((u) => (u.id === targetUserId ? { ...u, ...data } : u))
        );
      }
    });

    // F. Room Password Update
    const unsubPasswordUpdate = socket.on('room:password_update', async ({ data }) => {
      const newPwd = data?.password || '';
      setRoomPassword(newPwd);
      if (newPwd) {
        const key = await deriveKeyFromPassword(newPwd);
        setCryptoKey(key);
      } else {
        setCryptoKey(null);
      }

      const url = new URL(window.location.href);
      if (newPwd) url.searchParams.set('pwd', newPwd);
      else url.searchParams.delete('pwd');
      window.history.replaceState({}, '', url.toString());

      setMessages((prev) => [
        ...prev,
        {
          id: 'sys_' + Date.now(),
          senderId: 'system',
          senderName: 'Sistem',
          senderColor: '#10b981',
          text: newPwd
            ? 'Oda şifresi güncellendi. Mesajlar yeni anahtarla şifreleniyor.'
            : 'Oda şifresi kaldırıldı. Artık açık oda.',
          timestamp: Date.now(),
          isSystem: true,
        },
      ]);
    });

    // G. Chat Message
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

    // H. Reactions
    const unsubChatReaction = socket.on('chat:reaction', ({ data }) => {
      if (!data) return;
      setReactions((prev) => [...prev, data]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== data.id));
      }, 3000);
    });

    // I. Vote Update
    const unsubVoteUpdate = socket.on('vote:update', ({ data }) => {
      setActiveVote(data);
    });

    // Request fresh room state from server upon joining
    socket.requestRoomState();

    return () => {
      unsubRoomState();
      unsubUsersUpdated();
      unsubUserJoined();
      unsubUserLeft();
      unsubOffer();
      unsubAnswer();
      unsubCandidate();
      unsubSyncVideo();
      unsubUserState();
      unsubPasswordUpdate();
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

    if (password.trim()) {
      const key = await deriveKeyFromPassword(password.trim());
      setCryptoKey(key);
    }

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', targetRoom);
    if (password.trim()) {
      newUrl.searchParams.set('pwd', password.trim());
    }
    window.history.replaceState({}, '', newUrl.toString());

    webrtc.setUserId(userId);
    webrtc.setPushToTalkMode(isPushToTalkMode);

    // Acquire local camera and mic with a fast race to ensure tracks exist before initial offer
    try {
      const initialMediaPromise = webrtc.startLocalMedia(true, true);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200));
      const stream = await Promise.race([initialMediaPromise, timeoutPromise]);
      if (stream) {
        setLocalStream(stream);
        const hasV = stream.getVideoTracks().length > 0;
        const hasA = stream.getAudioTracks().length > 0;
        setHasCamera(hasV);
        setHasMic(hasA);
      }
    } catch (e) {
      console.warn('Initial media race skipped or failed:', e);
    }

    // Initialize socket connection immediately
    socket.init(targetRoom, userId, name, randomColor, asHost);
    setIsJoined(true);

    // If stream wasn't ready during fast race, finish acquiring in background
    webrtc.startLocalMedia(true, true).then((stream) => {
      if (stream) {
        setLocalStream(stream);
        const hasV = stream.getVideoTracks().length > 0;
        const hasA = stream.getAudioTracks().length > 0;
        setHasCamera(hasV);
        setHasMic(hasA);
        socket.updateUserState({ hasCamera: hasV, hasMic: hasA });
      }
    });
  };

  // Host Password Update
  const handleHostUpdatePassword = async (newPassword: string) => {
    setRoomPassword(newPassword);
    if (newPassword.trim()) {
      const key = await deriveKeyFromPassword(newPassword.trim());
      setCryptoKey(key);
    } else {
      setCryptoKey(null);
    }

    const url = new URL(window.location.href);
    if (newPassword.trim()) url.searchParams.set('pwd', newPassword.trim());
    else url.searchParams.delete('pwd');
    window.history.replaceState({}, '', url.toString());

    socket.updatePassword(newPassword.trim());
  };

  // Video State Update
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

  // 1080p Screen & Tab Sharing
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

  const handleTogglePushToTalkMode = (enabled: boolean) => {
    setIsPushToTalkMode(enabled);
    webrtc.setPushToTalkMode(enabled);
  };

  const handlePushToTalkTrigger = (active: boolean) => {
    setIsPushToTalkActive(active);
    webrtc.triggerPushToTalk(active);
  };

  const handleToggleCamera = async () => {
    const nextState = !hasCamera;
    setHasCamera(nextState);

    if (nextState && (!localStream || localStream.getVideoTracks().length === 0)) {
      const stream = await webrtc.startLocalMedia(true, hasMic);
      if (stream) {
        setLocalStream(stream);
      }
    } else {
      webrtc.toggleCamera(nextState);
    }
    socket.updateUserState({ hasCamera: nextState });
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
    socket.updateUserState({ hasMic: nextState });
  };

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
      {/* 1. Room Creation / Join Modal */}
      {!isJoined && (
        <RoomModal
          initialRoomId={roomId}
          initialPassword={roomPassword}
          onJoinRoom={handleJoinRoom}
        />
      )}

      {/* 2. Share Room Modal with Host Password Management */}
      <ShareRoomModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        roomId={roomId}
        roomName={roomName}
        hasPassword={Boolean(cryptoKey || roomPassword)}
        password={roomPassword}
        isHost={isHost}
        onUpdatePassword={handleHostUpdatePassword}
      />

      {/* 3. Top Bar Navigation with Chat Toggle */}
      <Header
        roomId={roomId}
        roomName={roomName}
        hasPassword={Boolean(cryptoKey || roomPassword)}
        participantCount={users.length || 1}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onShareRoom={() => setIsShareModalOpen(true)}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
      />

      {/* 4. Main Body Content Area */}
      <main className="flex-1 p-2.5 sm:p-4 max-w-[1720px] w-full mx-auto flex flex-col gap-3 sm:gap-4">
        {/* TAB 1: Sinema Sahnesi & Birlikte İzleme */}
        {activeTab === 'cinema' && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 relative">
            {/* Video Stage & Camera Strip: Expands to full 12 cols when chat is closed */}
            <div className={`flex flex-col gap-3 transition-all ${isChatOpen ? 'lg:col-span-8 xl:col-span-9' : 'lg:col-span-12'}`}>
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

            {/* Live Chat Panel (Togglable: Can be closed/opened at will) */}
            {isChatOpen ? (
              <div className="lg:col-span-4 xl:col-span-3 h-[420px] lg:h-[calc(100vh-100px)] sticky top-14">
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
                  onClose={() => setIsChatOpen(false)}
                />
              </div>
            ) : (
              /* Floating Button when Chat is Closed to Reopen with 1 Click */
              <button
                onClick={() => setIsChatOpen(true)}
                className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-xl shadow-rose-950/60 transition-all hover:scale-105 active:scale-95 font-semibold text-xs border border-rose-400/30"
                title="Canlı Sohbeti Aç"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Sohbet ({messages.filter(m => !m.isSystem).length})</span>
              </button>
            )}
          </div>
        )}

        {/* TAB 2: Film Keşfet & AI Öneri Motoru */}
        {activeTab === 'discovery' && (
          <div className="flex-1 max-w-5xl mx-auto w-full h-[calc(100vh-100px)]">
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
          <div className="flex-1 max-w-3xl mx-auto w-full bg-[#0e1424] border border-slate-800/80 rounded-xl p-4 sm:p-6 shadow-xl space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white mb-1">Oda & Güvenlik Ayarları</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Oda bağlantısını ve kodunu arkadaşlarınızla paylaşın veya uçtan uca şifreleme detaylarını inceleyin.
              </p>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
              <span className="text-xs font-semibold text-slate-300 block">
                Oda Bilgisi
              </span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Oda Kodu:</span>
                  <span className="font-mono text-base sm:text-lg font-bold text-rose-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                    {roomId}
                  </span>
                </div>
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm"
                >
                  <span>Paylaşım Penceresini Aç</span>
                </button>
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0" />
                <h3 className="text-xs font-bold text-white">Uçtan Uca Şifreleme (AES-GCM 256-bit)</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                Odanız {cryptoKey ? 'oda parolasıyla uçtan uca şifrelenmiştir.' : 'şifresiz genel odadır.'}
                {cryptoKey &&
                  ' Mesajlarınız ve anlık tepkileriniz tarayıcınızda PBKDF2 (100.000 iterasyon) ile türetilen AES-GCM anahtarıyla şifrelenir. Sunucu dahil hiç kimse mesaj içeriğini okuyamaz.'}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
