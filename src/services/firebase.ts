import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  getDocFromServer,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteDoc,
  serverTimestamp,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { RoomState, VideoState, ChatMessage, EmojiReaction, RoomUser } from '../types';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Auth with anonymous sign-in support
export const auth = getAuth(app);

// Firestore instance (with databaseId support if specified)
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Test connection on boot
async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or network is limited.');
    }
  }
}
testFirestoreConnection();

// Ensure user is authenticated anonymously
export async function ensureAuthUser(): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.warn('Anonymous auth note (proceeding with local guest session):', e);
    return null;
  }
}

/**
 * CineSync Firestore Room Coordinator
 * Synchronizes room status, video player, user participants, and signaling across all devices
 */
class FirebaseSyncService {
  private activeUnsubscribers: Unsubscribe[] = [];
  private currentRoomId: string = '';
  private currentUserId: string = '';
  private isHost: boolean = false;
  private heartbeatInterval: any = null;
  private seenEventIds: Set<string> = new Set();

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
    initialVideoState?: Partial<VideoState>,
    initialRoomPassword?: string,
    onStateUpdate?: (data: any) => void,
    onUsersUpdate?: (users: RoomUser[]) => void,
    onEvent?: (type: string, data: any, senderId: string) => void
  ) {
    const normRoomId = roomId.trim().toLowerCase();
    this.currentRoomId = normRoomId;
    this.currentUserId = user.id;
    this.isHost = user.isHost;

    // Clean up previous listeners
    this.leaveRoom();

    await ensureAuthUser();

    // 1. Ensure Room Document exists
    const roomRef = doc(db, 'rooms', normRoomId);
    try {
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        await setDoc(roomRef, {
          id: normRoomId,
          name: `Oda #${normRoomId}`,
          hostId: user.id,
          hasPassword: Boolean(initialRoomPassword),
          password: initialRoomPassword || '',
          video: initialVideoState || {
            sourceType: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            sourceTitle: 'İçerik Seçilmedi',
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            lastUpdated: Date.now(),
            updatedBy: user.id,
            playbackRate: 1,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      console.warn('Error reading/creating room in Firestore:', e);
    }

    // 2. Register/Touch User in subcollection
    const userRef = doc(db, 'rooms', normRoomId, 'users', user.id);
    const writeUserData = {
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

    try {
      await setDoc(userRef, writeUserData, { merge: true });
    } catch (e) {
      console.warn('Error registering user in Firestore:', e);
    }

    // 3. Listen to Room document updates (video playback, password, host)
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (onStateUpdate) {
          onStateUpdate({
            id: normRoomId,
            name: data.name,
            hostId: data.hostId,
            hasPassword: data.hasPassword,
            video: data.video,
            activeVote: data.activeVote || null,
          });
        }
      }
    }, (err) => {
      console.warn('Firestore room snapshot error:', err);
    });
    this.activeUnsubscribers.push(unsubRoom);

    // 4. Listen to Users collection updates
    const usersColRef = collection(db, 'rooms', normRoomId, 'users');
    const unsubUsers = onSnapshot(usersColRef, (snapshot) => {
      const usersList: RoomUser[] = [];
      const now = Date.now();
      snapshot.forEach((d) => {
        const u = d.data() as RoomUser;
        // Keep active users who pinged in last 90 seconds
        if (u.id && (!u.lastSeen || now - u.lastSeen < 90000)) {
          usersList.push(u);
        }
      });
      if (onUsersUpdate && usersList.length > 0) {
        onUsersUpdate(usersList);
      }
    }, (err) => {
      console.warn('Firestore users snapshot error:', err);
    });
    this.activeUnsubscribers.push(unsubUsers);

    // 5. Listen to Real-time Events (Signaling, Chat, Reactions)
    // Only fetch events from the last 15 seconds to avoid old stale messages
    const eventsColRef = collection(db, 'rooms', normRoomId, 'events');
    const recentEventsQuery = query(
      eventsColRef,
      where('timestamp', '>=', Date.now() - 15000),
      limit(40)
    );

    const unsubEvents = onSnapshot(recentEventsQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const ev = change.doc.data();
          if (ev.id && !this.seenEventIds.has(ev.id)) {
            this.seenEventIds.add(ev.id);
            if (this.seenEventIds.size > 400) {
              const first = this.seenEventIds.values().next().value;
              if (first) this.seenEventIds.delete(first);
            }

            // Target check for direct peer signaling
            if (ev.targetId && ev.targetId !== this.currentUserId) {
              return;
            }

            // Exclude messages sent by self
            if (ev.senderId === this.currentUserId) {
              return;
            }

            let parsedData = ev.data;
            if (typeof ev.data === 'string') {
              try {
                parsedData = JSON.parse(ev.data);
              } catch (e) {
                parsedData = ev.data;
              }
            }

            if (onEvent) {
              onEvent(ev.type, parsedData, ev.senderId);
            }
          }
        }
      });
    }, (err) => {
      console.warn('Firestore events snapshot error:', err);
    });
    this.activeUnsubscribers.push(unsubEvents);

    // 6. Heartbeat every 20 seconds
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(async () => {
      try {
        await setDoc(userRef, { lastSeen: Date.now() }, { merge: true });
      } catch (e) {}
    }, 20000);
  }

  public async syncVideo(videoState: Partial<VideoState>) {
    if (!this.currentRoomId) return;
    try {
      const roomRef = doc(db, 'rooms', this.currentRoomId);
      await setDoc(roomRef, {
        video: {
          ...videoState,
          lastUpdated: Date.now(),
          updatedBy: this.currentUserId,
        },
        updatedAt: Date.now(),
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore syncVideo error:', e);
    }
  }

  public async updateUserState(state: Partial<RoomUser>) {
    if (!this.currentRoomId || !this.currentUserId) return;
    try {
      const userRef = doc(db, 'rooms', this.currentRoomId, 'users', this.currentUserId);
      await setDoc(userRef, {
        ...state,
        lastSeen: Date.now(),
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore updateUserState error:', e);
    }
  }

  public async sendEvent(type: string, data: any, targetId?: string) {
    if (!this.currentRoomId || !this.currentUserId) return;
    const eventId = `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.seenEventIds.add(eventId);

    try {
      const serializedData = typeof data === 'object' ? JSON.stringify(data) : String(data);
      const evRef = doc(db, 'rooms', this.currentRoomId, 'events', eventId);
      await setDoc(evRef, {
        id: eventId,
        type,
        roomId: this.currentRoomId,
        senderId: this.currentUserId,
        targetId: targetId || '',
        data: serializedData,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('Firestore sendEvent error:', e);
    }
  }

  public async leaveRoom() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.activeUnsubscribers.forEach((unsub) => {
      try { unsub(); } catch (e) {}
    });
    this.activeUnsubscribers = [];

    if (this.currentRoomId && this.currentUserId) {
      try {
        const userRef = doc(db, 'rooms', this.currentRoomId, 'users', this.currentUserId);
        await deleteDoc(userRef);
      } catch (e) {}
    }

    this.currentRoomId = '';
    this.currentUserId = '';
  }
}

export const firebaseSync = new FirebaseSyncService();
