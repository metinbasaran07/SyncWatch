import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteDoc,
  serverTimestamp,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { RoomState, VideoState, ChatMessage, EmojiReaction, RoomUser } from '../types';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Auth with anonymous sign-in support
export const auth = getAuth(app);

// Firestore instance (with databaseId support if configured)
export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

// Anonymous Auth helper
export async function ensureAuthUser(): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.warn('Anonymous auth proceeding in guest mode:', e);
    return null;
  }
}

/**
 * Clean, Pure Firebase Firestore Room Engine
 * Single Source of Truth for Rooms, Video Sync, Participants, Chat & Signaling
 */
class FirebaseRoomService {
  private activeSubscriptions: Unsubscribe[] = [];
  private heartbeatInterval: any = null;
  private currentRoomId: string = '';
  private currentUserId: string = '';
  private seenSignalIds: Set<string> = new Set();
  private sessionStartTime: number = Date.now();

  /**
   * Generates a simple, human-friendly 6-digit room code
   */
  public generateRoomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Creates a new room in Firestore
   */
  public async createRoom(
    name: string,
    hostName: string,
    hostId: string,
    password?: string,
    customRoomCode?: string
  ): Promise<{ roomId: string; success: boolean; error?: string }> {
    await ensureAuthUser();
    const roomId = (customRoomCode && customRoomCode.trim()) || this.generateRoomCode();
    const normRoomId = roomId.trim().toLowerCase();

    const roomRef = doc(db, 'rooms', normRoomId);

    const initialVideo: VideoState = {
      sourceType: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      sourceTitle: 'CineSync Örnek Sinema',
      isPlaying: false,
      currentTime: 0,
      duration: 213,
      lastUpdated: Date.now(),
      updatedBy: hostId,
      playbackRate: 1,
    };

    const roomData = {
      id: normRoomId,
      name: name && name.trim() ? name.trim() : `Sinema Odası #${normRoomId}`,
      hostId: hostId,
      hostName: hostName || 'Oda Sahibi',
      hasPassword: Boolean(password && password.trim().length > 0),
      password: password && password.trim() ? password.trim() : '',
      video: initialVideo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeVote: null,
    };

    try {
      await setDoc(roomRef, roomData);
      return { roomId: normRoomId, success: true };
    } catch (err: any) {
      console.error('Firestore createRoom error:', err);
      return { roomId: normRoomId, success: false, error: err?.message || 'Oda oluşturulamadı.' };
    }
  }

  /**
   * Joins an existing room in Firestore
   */
  public async joinRoom(
    roomId: string,
    user: {
      id: string;
      name: string;
      avatarColor: string;
      isHost: boolean;
      hasCamera: boolean;
      hasMic: boolean;
    },
    password?: string
  ): Promise<{ success: boolean; error?: string; room?: any }> {
    await ensureAuthUser();
    const normRoomId = roomId.trim().toLowerCase();
    this.currentRoomId = normRoomId;
    this.currentUserId = user.id;
    this.sessionStartTime = Date.now();

    // Clean up any stale signals addressed to this user from past sessions
    try {
      const oldSignalsSnap = await getDocs(
        query(collection(db, 'rooms', normRoomId, 'signals'), where('targetId', '==', user.id))
      );
      oldSignalsSnap.forEach((docSnap) => {
        deleteDoc(docSnap.ref).catch(() => {});
      });
    } catch (e) {}

    const roomRef = doc(db, 'rooms', normRoomId);

    try {
      const snap = await getDoc(roomRef);
      if (!snap.exists()) {
        // If room doesn't exist yet and user is trying to join with this ID, check if they are host
        if (user.isHost) {
          // Auto create
          await this.createRoom(`Sinema Odası #${normRoomId}`, user.name, user.id, password, normRoomId);
        } else {
          return {
            success: false,
            error: `"${normRoomId}" kodlu oda bulunamadı. Lütfen oda kodunu kontrol edin veya yeni bir oda oluşturun.`,
          };
        }
      } else {
        const roomData = snap.data();
        if (roomData.hasPassword && roomData.password) {
          if (!password || password.trim() !== roomData.password.trim()) {
            return {
              success: false,
              error: 'Oda şifresi yanlış! Lütfen doğru şifreyi giriniz.',
            };
          }
        }
      }

      // Register or update participant
      const participantRef = doc(db, 'rooms', normRoomId, 'participants', user.id);
      const participantData: RoomUser = {
        id: user.id,
        name: user.name,
        avatarColor: user.avatarColor,
        isHost: user.isHost,
        hasCamera: user.hasCamera,
        hasMic: user.hasMic,
        isSpeaking: false,
        isSharingScreen: false,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };
      await setDoc(participantRef, participantData, { merge: true });

      // Start Presence Heartbeat (every 15 seconds)
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = setInterval(async () => {
        try {
          if (this.currentRoomId && this.currentUserId) {
            const pRef = doc(db, 'rooms', this.currentRoomId, 'participants', this.currentUserId);
            await setDoc(pRef, { lastSeen: Date.now() }, { merge: true });
          }
        } catch (e) {}
      }, 15000);

      const refreshedSnap = await getDoc(roomRef);
      return { success: true, room: refreshedSnap.data() };
    } catch (err: any) {
      console.error('Firestore joinRoom error:', err);
      return { success: false, error: err?.message || 'Odaya bağlanırken bir sorun oluştu.' };
    }
  }

  /**
   * Subscribes to room state changes (video sync, room title, password)
   */
  public subscribeToRoom(roomId: string, callback: (roomData: any) => void): Unsubscribe {
    const normRoomId = roomId.trim().toLowerCase();
    const roomRef = doc(db, 'rooms', normRoomId);

    const unsub = onSnapshot(
      roomRef,
      (snapshot) => {
        if (snapshot.exists()) {
          callback(snapshot.data());
        }
      },
      (err) => {
        console.warn('Firestore room listener error:', err);
      }
    );

    this.activeSubscriptions.push(unsub);
    return unsub;
  }

  /**
   * Subscribes to participants in the room
   */
  public subscribeToParticipants(
    roomId: string,
    callback: (participants: RoomUser[]) => void
  ): Unsubscribe {
    const normRoomId = roomId.trim().toLowerCase();
    const participantsCol = collection(db, 'rooms', normRoomId, 'participants');

    const unsub = onSnapshot(
      participantsCol,
      (snapshot) => {
        const now = Date.now();
        const list: RoomUser[] = [];
        snapshot.forEach((d) => {
          const user = d.data() as RoomUser;
          // Filter out users inactive for more than 45 seconds (unless it's self)
          if (user.id && (user.id === this.currentUserId || !user.lastSeen || now - user.lastSeen < 45000)) {
            list.push(user);
          }
        });
        callback(list);
      },
      (err) => {
        console.warn('Firestore participants listener error:', err);
      }
    );

    this.activeSubscriptions.push(unsub);
    return unsub;
  }

  /**
   * Subscribes to real-time chat messages
   */
  public subscribeToMessages(
    roomId: string,
    callback: (messages: ChatMessage[]) => void
  ): Unsubscribe {
    const normRoomId = roomId.trim().toLowerCase();
    const messagesCol = collection(db, 'rooms', normRoomId, 'messages');
    const msgQuery = query(messagesCol, orderBy('timestamp', 'asc'), limit(100));

    const unsub = onSnapshot(
      msgQuery,
      (snapshot) => {
        const msgs: ChatMessage[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          msgs.push({
            id: d.id,
            senderId: data.senderId,
            senderName: data.senderName,
            senderColor: data.senderColor || '#e50914',
            text: data.text,
            timestamp: data.timestamp || Date.now(),
            isSystem: data.isSystem || false,
            isEncrypted: data.isEncrypted || false,
          });
        });
        callback(msgs);
      },
      (err) => {
        console.warn('Firestore messages listener error:', err);
      }
    );

    this.activeSubscriptions.push(unsub);
    return unsub;
  }

  /**
   * Sends a chat message
   */
  public async sendMessage(
    roomId: string,
    msg: {
      senderId: string;
      senderName: string;
      senderColor: string;
      text: string;
      isSystem?: boolean;
    }
  ): Promise<void> {
    const normRoomId = roomId.trim().toLowerCase();
    const msgId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const msgRef = doc(db, 'rooms', normRoomId, 'messages', msgId);

    try {
      await setDoc(msgRef, {
        id: msgId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderColor: msg.senderColor,
        text: msg.text,
        timestamp: Date.now(),
        isSystem: Boolean(msg.isSystem),
      });
    } catch (e) {
      console.error('Firestore sendMessage error:', e);
    }
  }

  /**
   * Updates video player state across all participants in the room
   */
  public async syncVideo(
    roomId: string,
    videoState: Partial<VideoState>,
    updaterId: string
  ): Promise<void> {
    const normRoomId = roomId.trim().toLowerCase();
    if (!normRoomId) return;

    try {
      const roomRef = doc(db, 'rooms', normRoomId);
      await setDoc(
        roomRef,
        {
          video: {
            ...videoState,
            lastUpdated: Date.now(),
            updatedBy: updaterId,
          },
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Firestore syncVideo error:', e);
    }
  }

  /**
   * Updates local participant state (mic, camera, speaking, screen share)
   */
  public async updateParticipantState(
    roomId: string,
    participantId: string,
    updates: Partial<RoomUser>
  ): Promise<void> {
    const normRoomId = roomId.trim().toLowerCase();
    if (!normRoomId || !participantId) return;

    try {
      const pRef = doc(db, 'rooms', normRoomId, 'participants', participantId);
      await setDoc(pRef, { ...updates, lastSeen: Date.now() }, { merge: true });
    } catch (e) {
      console.warn('Firestore updateParticipantState error:', e);
    }
  }

  /**
   * Sends real-time emoji reaction
   */
  public async sendReaction(
    roomId: string,
    reaction: {
      emoji: string;
      senderName: string;
      xOffset: number;
    }
  ): Promise<void> {
    const normRoomId = roomId.trim().toLowerCase();
    const reactId = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const reactRef = doc(db, 'rooms', normRoomId, 'reactions', reactId);

    try {
      await setDoc(reactRef, {
        id: reactId,
        emoji: reaction.emoji,
        senderName: reaction.senderName,
        timestamp: Date.now(),
        xOffset: reaction.xOffset,
      });
    } catch (e) {}
  }

  /**
   * Subscribes to real-time emoji reactions
   */
  public subscribeToReactions(
    roomId: string,
    callback: (reaction: EmojiReaction) => void
  ): Unsubscribe {
    const normRoomId = roomId.trim().toLowerCase();
    const reactCol = collection(db, 'rooms', normRoomId, 'reactions');
    const q = query(reactCol, orderBy('timestamp', 'desc'), limit(10));

    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const d = change.doc.data() as EmojiReaction;
          if (d.timestamp && d.timestamp >= this.sessionStartTime) {
            callback(d);
          }
        }
      });
    });

    this.activeSubscriptions.push(unsub);
    return unsub;
  }

  /**
   * WebRTC P2P Signaling via Firestore
   */
  public async sendSignal(
    roomId: string,
    senderId: string,
    targetId: string,
    type: 'offer' | 'answer' | 'candidate',
    data: any
  ): Promise<void> {
    const normRoomId = roomId.trim().toLowerCase();
    const signalId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const signalRef = doc(db, 'rooms', normRoomId, 'signals', signalId);

    try {
      await setDoc(signalRef, {
        id: signalId,
        senderId,
        targetId,
        type,
        data: JSON.stringify(data),
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('Firestore sendSignal error:', e);
    }
  }

  /**
   * Subscribes to WebRTC incoming signals targeted for this participant
   */
  public subscribeToSignals(
    roomId: string,
    myUserId: string,
    callback: (signal: { senderId: string; type: string; data: any }) => void
  ): Unsubscribe {
    const normRoomId = roomId.trim().toLowerCase();
    const signalsCol = collection(db, 'rooms', normRoomId, 'signals');
    // Query all incoming signals targeted to myUserId without an artificial limit
    const q = query(signalsCol, where('targetId', '==', myUserId));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const d = change.doc.data();

            // Delete ephemeral signal from Firestore immediately to prevent clutter
            deleteDoc(change.doc.ref).catch(() => {});

            // Filter out signals that originated before this session started
            if (d.timestamp && d.timestamp < this.sessionStartTime - 10000) {
              return;
            }

            if (d.id && !this.seenSignalIds.has(d.id)) {
              this.seenSignalIds.add(d.id);
              if (this.seenSignalIds.size > 500) {
                const first = this.seenSignalIds.values().next().value;
                if (first) this.seenSignalIds.delete(first);
              }

              let parsed = d.data;
              if (typeof d.data === 'string') {
                try {
                  parsed = JSON.parse(d.data);
                } catch (e) {
                  parsed = d.data;
                }
              }
              callback({ senderId: d.senderId, type: d.type, data: parsed });
            }
          }
        });
      },
      (err) => {
        console.warn('Firestore signals listener error:', err);
      }
    );

    this.activeSubscriptions.push(unsub);
    return unsub;
  }

  /**
   * Leaves room and cleans up listeners, presence, and heartbeat
   */
  public async leaveRoom(roomId?: string, participantId?: string): Promise<void> {
    const targetRoom = (roomId || this.currentRoomId || '').trim().toLowerCase();
    const targetUser = participantId || this.currentUserId;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.activeSubscriptions.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {}
    });
    this.activeSubscriptions = [];

    if (targetRoom && targetUser) {
      try {
        const pRef = doc(db, 'rooms', targetRoom, 'participants', targetUser);
        await deleteDoc(pRef);
      } catch (e) {}
    }

    this.currentRoomId = '';
    this.currentUserId = '';
    this.seenSignalIds.clear();
  }
}

export const firebaseRoomService = new FirebaseRoomService();
