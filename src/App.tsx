import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { CinemaStage } from './components/CinemaStage';
import { CameraGrid } from './components/CameraGrid';
import { ChatPanel } from './components/ChatPanel';
import { MovieDiscovery } from './components/MovieDiscovery';
import { RoomModal } from './components/RoomModal';
import { ShareRoomModal } from './components/ShareRoomModal';
import { RoomState, RoomUser, VideoState, ChatMessage, EmojiReaction, MovieSuggestion } from './types';
import { firebaseRoomService, db } from './services/firebaseRoomService';
import { doc, setDoc } from 'firebase/firestore';
import { webrtc } from './services/webrtc';
import { deriveKeyFromPassword, encryptMessage, decryptMessage } from './services/crypto';
import { MessageSquare, ShieldCheck, Film, Sparkles } from 'lucide-react';

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

  // Share Modal & Room Creation Modal States
  const [isRoomModalOpen, setIsRoomModalOpen] = useState<boolean>(true);
  const [roomModalMode, setRoomModalMode] = useState<'create' | 'join'>('create');
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
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [hasCamera, setHasCamera] = useState<boolean>(false);
  const [hasMic, setHasMic] = useState<boolean>(true);
  const [isPushToTalkMode, setIsPushToTalkMode] = useState<boolean>(false);
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
  const userJoinedAtRef = useRef<number>(Date.now());

  // Calculates whether current user entered the room first compared to otherUser.
  // The person who entered the room first initiates the WebRTC handshake with newer participants
  const checkIfInitiator = useCallback(
    (otherUser: RoomUser): boolean => {
      const myJoinedAt = userJoinedAtRef.current;
      const otherJoinedAt = otherUser.joinedAt || 0;

      if (myJoinedAt && otherJoinedAt && myJoinedAt !== otherJoinedAt) {
        return myJoinedAt < otherJoinedAt;
      }
      if (isHost && !otherUser.isHost) return true;
      if (!isHost && otherUser.isHost) return false;
      return userId < otherUser.id;
    },
    [userId, isHost]
  );

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

  // 2. Pure Firebase Real-Time Firestore Synchronization
  useEffect(() => {
    if (!isJoined || !roomId) return;

    webrtc.setCallbacks(
      (streams) => {
        setRemoteStreams(new Map(streams));
      },
      (speaking, vol) => {
        setIsSpeaking(speaking);
        setSpeakingVolume(vol);
      },
      (screenStreams) => {
        setRemoteScreenStreams(new Map(screenStreams));
      }
    );

    // A. Room document subscription (video state, room name, password, vote)
    const unsubRoom = firebaseRoomService.subscribeToRoom(roomId, (data) => {
      if (!data) return;
      if (data.name) setRoomName(data.name);
      if (data.video && data.video.sourceUrl) {
        setVideoState((prev) => {
          // If updated locally by self in the last 2 seconds, avoid self-jitter
          if (data.video.updatedBy === userId && prev.sourceUrl === data.video.sourceUrl) {
            return prev;
          }
          return data.video;
        });
      }
      if (data.hasPassword !== undefined) {
        if (data.hasPassword && data.password && data.password !== roomPassword) {
          setRoomPassword(data.password);
          deriveKeyFromPassword(data.password).then(setCryptoKey);
        } else if (!data.hasPassword) {
          setRoomPassword('');
          setCryptoKey(null);
        }
      }
      if (data.activeVote !== undefined) {
        setActiveVote(data.activeVote);
      }
    });

    // B. Live participants subscription
    const unsubParticipants = firebaseRoomService.subscribeToParticipants(roomId, (list) => {
      setUsers(list);
      const me = list.find((u) => u.id === userId);
      if (me?.joinedAt) {
        userJoinedAtRef.current = me.joinedAt;
      }

      const activeIds = new Set(list.map((u) => u.id));
      // Cleanup remote streams for participants who left
      webrtc.getRemoteStreams().forEach((_, peerId) => {
        if (!activeIds.has(peerId)) {
          webrtc.removePeer(peerId);
        }
      });

      // Establish P2P Mesh with peers
      list.forEach((otherUser) => {
        if (otherUser.id !== userId) {
          const isInitiator = checkIfInitiator(otherUser);
          webrtc.createPeer(otherUser.id, isInitiator);
        }
      });
    });

    // C. Live chat messages subscription
    const unsubMessages = firebaseRoomService.subscribeToMessages(roomId, async (msgs) => {
      const processed: ChatMessage[] = [];
      for (const msg of msgs) {
        let displayText = msg.text;
        if (msg.isEncrypted && (msg as any).ciphertext && (msg as any).iv) {
          displayText = await decryptMessage((msg as any).ciphertext, (msg as any).iv, cryptoKey);
        }
        processed.push({ ...msg, text: displayText });
      }
      setMessages(processed);
    });

    // D. Live emoji reactions subscription
    const unsubReactions = firebaseRoomService.subscribeToReactions(roomId, (rx) => {
      setReactions((prev) => [...prev, rx]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== rx.id));
      }, 3000);
    });

    // E. WebRTC P2P Signals subscription
    const unsubSignals = firebaseRoomService.subscribeToSignals(
      roomId,
      userId,
      ({ senderId, type, data }) => {
        if (senderId && senderId !== userId) {
          webrtc.handleIncomingSignal(senderId, type, data);
        }
      }
    );

    return () => {
      unsubRoom();
      unsubParticipants();
      unsubMessages();
      unsubReactions();
      unsubSignals();
    };
  }, [isJoined, roomId, userId, cryptoKey, checkIfInitiator]);

  // Join Room Handler
  const handleJoinRoom = async (
    name: string,
    targetRoom: string,
    password: string,
    asHost: boolean,
    customName?: string
  ) => {
    const cleanRoom = targetRoom.trim().toLowerCase();
    setUserName(name);
    setRoomId(cleanRoom);
    setRoomPassword(password);
    setIsHost(asHost);
    if (customName) {
      setRoomName(customName);
    }
    setIsRoomModalOpen(false);

    const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    setUserColor(randomColor);

    if (password.trim()) {
      const key = await deriveKeyFromPassword(password.trim());
      setCryptoKey(key);
    } else {
      setCryptoKey(null);
    }

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', cleanRoom);
    if (password.trim()) {
      newUrl.searchParams.set('pwd', password.trim());
    }
    window.history.replaceState({}, '', newUrl.toString());

    webrtc.init(cleanRoom, userId);
    webrtc.setPushToTalkMode(isPushToTalkMode);

    let camActive = false;
    let micActive = false;
    try {
      const stream = await webrtc.startLocalMedia(true, true);
      if (stream) {
        setLocalStream(stream);
        camActive = stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
        micActive = stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].enabled;
        setHasCamera(camActive);
        setHasMic(micActive);
      }
    } catch (e) {
      console.warn('Local media acquire skipped:', e);
    }

    userJoinedAtRef.current = Date.now();

    // Pure Firestore Join & Presence Registration
    const joinResult = await firebaseRoomService.joinRoom(
      cleanRoom,
      {
        id: userId,
        name,
        avatarColor: randomColor,
        isHost: asHost,
        hasCamera: camActive,
        hasMic: micActive,
      },
      password
    );

    if (!joinResult.success) {
      alert(joinResult.error || 'Odaya katılırken bir sorun oluştu.');
      setIsRoomModalOpen(true);
      return;
    }

    if (joinResult.room) {
      if (joinResult.room.name) setRoomName(joinResult.room.name);
      if (joinResult.room.video && joinResult.room.video.sourceUrl) {
        setVideoState(joinResult.room.video);
      }
    }

    setIsJoined(true);
  };

  // Host Password Update
  const handleHostUpdatePassword = async (newPassword: string) => {
    const clean = newPassword.trim();
    setRoomPassword(clean);
    if (clean) {
      const key = await deriveKeyFromPassword(clean);
      setCryptoKey(key);
    } else {
      setCryptoKey(null);
    }

    const url = new URL(window.location.href);
    if (clean) url.searchParams.set('pwd', clean);
    else url.searchParams.delete('pwd');
    window.history.replaceState({}, '', url.toString());

    if (roomId) {
      const roomRef = doc(db, 'rooms', roomId);
      await setDoc(
        roomRef,
        {
          hasPassword: Boolean(clean),
          password: clean,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    }
  };

  // Leave room and return to room creation/join screen
  const handleLeaveRoom = () => {
    if (roomId) {
      firebaseRoomService.leaveRoom(roomId, userId);
    }
    webrtc.cleanup();
    setIsJoined(false);
    setRoomId('');
    setRoomPassword('');
    setIsShareModalOpen(false);
    setIsRoomModalOpen(true);
    setRoomModalMode('create');
    setUsers([]);
    setMessages([]);
    setRemoteStreams(new Map());
    setRemoteScreenStreams(new Map());
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('pwd');
    window.history.replaceState({}, '', url.pathname);
  };

  // Video State Update
  const handleUpdateVideo = (update: Partial<VideoState>) => {
    const nextState: VideoState = {
      ...videoState,
      ...update,
      lastUpdated: Date.now(),
      updatedBy: userName || userId,
    };
    setVideoState(nextState);
    if (roomId) {
      firebaseRoomService.syncVideo(roomId, nextState, userId);
    }
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
    if (roomId) {
      firebaseRoomService.updateParticipantState(roomId, userId, { hasCamera: nextState });
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
    if (roomId) {
      firebaseRoomService.updateParticipantState(roomId, userId, { hasMic: nextState });
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!roomId || !text.trim()) return;

    let ciphertext = text;
    let iv = '';
    let isEncrypted = false;

    if (cryptoKey) {
      const enc = await encryptMessage(text, cryptoKey);
      ciphertext = enc.ciphertext;
      iv = enc.iv;
      isEncrypted = enc.isEncrypted;
    }

    await firebaseRoomService.sendMessage(roomId, {
      senderId: userId,
      senderName: userName,
      senderColor: userColor,
      text: isEncrypted ? ciphertext : text,
    });
  };

  const handleTriggerReaction = (emoji: string) => {
    if (!roomId) return;
    const reaction: EmojiReaction = {
      id: 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      emoji,
      senderName: userName,
      timestamp: Date.now(),
      xOffset: Math.floor(Math.random() * 80) + 10,
    };

    setReactions((prev) => [...prev, reaction]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
    }, 3000);
    firebaseRoomService.sendReaction(roomId, reaction);
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

  const handleStartVote = async (movie: MovieSuggestion) => {
    const voteData = {
      id: 'vote_' + Date.now(),
      movie,
      yesVotes: [userId],
      noVotes: [],
      initiatedBy: userName,
      expiresAt: Date.now() + 60000,
    };
    setActiveVote(voteData);
    if (roomId) {
      const roomRef = doc(db, 'rooms', roomId);
      await setDoc(roomRef, { activeVote: voteData }, { merge: true });
    }
  };

  const handleCastVote = async (vote: 'yes' | 'no') => {
    if (!activeVote || !roomId) return;
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
    const roomRef = doc(db, 'rooms', roomId);
    await setDoc(roomRef, { activeVote: updated }, { merge: true });
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
      {/* 1. Room Creation / Join Modal (Can be closed anytime to explore site) */}
      {isRoomModalOpen && (
        <RoomModal
          isOpen={isRoomModalOpen}
          onClose={() => setIsRoomModalOpen(false)}
          initialMode={roomModalMode}
          initialRoomId={roomId}
          initialPassword={roomPassword}
          onJoinRoom={handleJoinRoom}
        />
      )}

      {/* 2. Share Room Modal with Host Password Management */}
      {isShareModalOpen && (
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
      )}

      {/* 3. Top Bar Navigation with Explicit Room Action Buttons */}
      <Header
        roomId={roomId}
        roomName={roomName}
        hasPassword={Boolean(cryptoKey || roomPassword)}
        participantCount={users.length || 1}
        isJoined={isJoined}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenCreateRoom={() => {
          setRoomModalMode('create');
          setIsRoomModalOpen(true);
        }}
        onOpenJoinRoom={() => {
          setRoomModalMode('join');
          setIsRoomModalOpen(true);
        }}
        onShareRoom={() => setIsShareModalOpen(true)}
        onLeaveRoom={handleLeaveRoom}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
      />

      {/* 4. Main Body Content Area */}
      <main className="flex-1 p-2.5 sm:p-4 max-w-[1720px] w-full mx-auto flex flex-col gap-3 sm:gap-4">
        {/* Solo Preview Mode Notification Banner */}
        {!isJoined && (
          <div className="bg-gradient-to-r from-rose-950/70 via-slate-900/90 to-indigo-950/70 border border-rose-500/30 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-600/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-sm font-bold text-white">
                    Tekli Önizleme Modundasınız
                  </h3>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                    Solo İzleme
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Arkadaşlarınızla farklı cihazlardan aynı odaya bağlanıp canlı izlemek ve konuşmak için hemen oda oluşturun veya katılın.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={() => {
                  setRoomModalMode('join');
                  setIsRoomModalOpen(true);
                }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-all active:scale-95"
              >
                <span>🔗 Odaya Katıl</span>
              </button>
              <button
                onClick={() => {
                  setRoomModalMode('create');
                  setIsRoomModalOpen(true);
                }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow-md shadow-rose-950/40 transition-all active:scale-95"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>✨ Oda Oluştur</span>
              </button>
            </div>
          </div>
        )}
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
                remoteScreenStreams={remoteScreenStreams}
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
