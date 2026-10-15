import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (e) {
    socket.destroy();
  }
});

app.use(express.json());

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Room & Participant Hub interfaces
interface RoomUserRecord {
  id: string;
  name: string;
  avatarColor: string;
  isHost: boolean;
  hasCamera: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  isSharingScreen: boolean;
  joinedAt: number;
  lastSeen: number;
}

interface RoomEvent {
  id: string;
  seq: number;
  type: string;
  roomId: string;
  senderId?: string;
  targetId?: string;
  data: any;
  timestamp: number;
}

interface RoomData {
  id: string;
  name: string;
  hostId: string;
  password?: string;
  hasPassword?: boolean;
  video: {
    sourceType: 'youtube' | 'direct' | 'screenshare';
    sourceUrl: string;
    sourceTitle: string;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    lastUpdated: number;
    updatedBy: string;
    playbackRate: number;
  };
  users: Map<string, RoomUserRecord>;
  events: RoomEvent[];
  nextEventSeq: number;
  activeVote?: any;
}

const DATA_DIR = path.join(__dirname, '.data');
const DATA_FILE = path.join(DATA_DIR, 'rooms_store.json');

const rooms = new Map<string, RoomData>();
const wsClientMap = new Map<WebSocket, { userId: string; roomId: string; userName: string }>();

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSaveRooms() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const serialized: Record<string, any> = {};
      for (const [id, r] of rooms.entries()) {
        serialized[id] = {
          id: r.id,
          name: r.name,
          hostId: r.hostId,
          password: r.password,
          hasPassword: r.hasPassword,
          video: r.video,
          users: Array.from(r.users.entries()),
          events: r.events.slice(-60),
          nextEventSeq: r.nextEventSeq,
          activeVote: r.activeVote,
        };
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[Storage] Error persisting rooms:', e);
    }
  }, 1000);
}

function loadRoomsFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      for (const [id, r] of Object.entries(data) as [string, any][]) {
        rooms.set(id, {
          ...r,
          users: new Map(r.users || []),
          events: r.events || [],
        });
      }
      console.log(`[Storage] Restored ${rooms.size} active rooms from persistent disk storage.`);
    }
  } catch (e) {
    console.warn('[Storage] Could not load persisted rooms:', e);
  }
}
loadRoomsFromDisk();

function getOrCreateRoom(roomId: string, hostName?: string, hostId?: string): RoomData {
  const normId = roomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!rooms.has(normId)) {
    rooms.set(normId, {
      id: normId,
      name: hostName ? `${hostName}'in Sinema Odası` : 'CineSync Sinema Odası',
      hostId: hostId || '',
      password: '',
      hasPassword: false,
      video: {
        sourceType: 'youtube',
        sourceUrl: '',
        sourceTitle: 'İçerik Seçilmedi',
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        lastUpdated: Date.now(),
        updatedBy: hostName || 'Sistem',
        playbackRate: 1,
      },
      users: new Map(),
      events: [],
      nextEventSeq: 1,
    });
    scheduleSaveRooms();
  }
  return rooms.get(normId)!;
}

function getRoomSnapshot(room: RoomData) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    password: room.password,
    hasPassword: Boolean(room.password),
    video: room.video,
    users: Array.from(room.users.values()).map(u => ({
      id: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      isHost: u.isHost,
      hasCamera: u.hasCamera,
      hasMic: u.hasMic,
      isSpeaking: u.isSpeaking,
      isSharingScreen: u.isSharingScreen,
      joinedAt: u.joinedAt,
    })),
    activeVote: room.activeVote,
  };
}

// Broadcasts an event to all WebSocket clients for a room
function broadcastToWebSocketClients(roomId: string, event: RoomEvent, excludeWs?: WebSocket) {
  const payload = JSON.stringify(event);
  const normId = roomId.trim().toLowerCase();
  for (const [ws, client] of wsClientMap.entries()) {
    if (client.roomId === normId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      if (!event.targetId || event.targetId === client.userId) {
        ws.send(payload);
      }
    }
  }
}

// Dispatches an event to the unified room: stores it in room.events, updates state, and broadcasts
function dispatchRoomEvent(
  roomId: string,
  event: { type: string; senderId?: string; targetId?: string; data?: any },
  excludeWs?: WebSocket
): RoomEvent {
  const normId = roomId.trim().toLowerCase();
  const room = getOrCreateRoom(normId);
  const seq = room.nextEventSeq++;

  const roomEvent: RoomEvent = {
    id: `ev_${Date.now()}_${seq}_${Math.random().toString(36).substring(2, 6)}`,
    seq,
    type: event.type,
    roomId: normId,
    senderId: event.senderId,
    targetId: event.targetId,
    data: event.data !== undefined ? event.data : {},
    timestamp: Date.now(),
  };

  // State mutations based on event type
  if (event.type === 'sync:video' && event.data) {
    room.video = {
      ...room.video,
      ...event.data,
      lastUpdated: Date.now(),
    };
  } else if (event.type === 'room:password_update' && event.data) {
    room.password = event.data.password || '';
    room.hasPassword = Boolean(room.password);
  } else if (event.type === 'vote:update' && event.data) {
    room.activeVote = event.data;
  } else if (event.type === 'user:state_update' && event.senderId && event.data) {
    const user = room.users.get(event.senderId);
    if (user) {
      Object.assign(user, event.data);
      user.lastSeen = Date.now();
    }
  }

  // Push to room events buffer (keep last 300)
  room.events.push(roomEvent);
  if (room.events.length > 300) {
    room.events.shift();
  }

  // Broadcast to all active WebSocket connections for this room
  broadcastToWebSocketClients(normId, roomEvent, excludeWs);
  scheduleSaveRooms();

  return roomEvent;
}

// Registers or updates user activity in room
function touchUser(
  roomId: string,
  user: {
    id: string;
    name: string;
    avatarColor?: string;
    isHost?: boolean;
    hasCamera?: boolean;
    hasMic?: boolean;
    isSpeaking?: boolean;
    isSharingScreen?: boolean;
  },
  triggerJoinedEvent = true
) {
  const normId = roomId.trim().toLowerCase();
  const room = getOrCreateRoom(normId, user.name, user.id);

  let userRecord = room.users.get(user.id);
  const isNew = !userRecord;

  if (!userRecord) {
    const isFirstUser = room.users.size === 0;
    userRecord = {
      id: user.id,
      name: user.name || 'Misafir',
      avatarColor: user.avatarColor || '#e11d48',
      isHost: user.isHost ?? isFirstUser,
      hasCamera: Boolean(user.hasCamera),
      hasMic: user.hasMic ?? true,
      isSpeaking: Boolean(user.isSpeaking),
      isSharingScreen: Boolean(user.isSharingScreen),
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    };
    room.users.set(user.id, userRecord);
    if (!room.hostId || isFirstUser) {
      room.hostId = user.id;
    }
  } else {
    userRecord.name = user.name || userRecord.name;
    if (user.avatarColor) userRecord.avatarColor = user.avatarColor;
    if (user.hasCamera !== undefined) userRecord.hasCamera = user.hasCamera;
    if (user.hasMic !== undefined) userRecord.hasMic = user.hasMic;
    if (user.isSpeaking !== undefined) userRecord.isSpeaking = user.isSpeaking;
    if (user.isSharingScreen !== undefined) userRecord.isSharingScreen = user.isSharingScreen;
    userRecord.lastSeen = Date.now();
  }

  if (isNew && triggerJoinedEvent) {
    const allUsers = Array.from(room.users.values()).map(u => ({
      id: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      isHost: u.isHost,
      hasCamera: u.hasCamera,
      hasMic: u.hasMic,
      isSpeaking: u.isSpeaking,
      isSharingScreen: u.isSharingScreen,
      joinedAt: u.joinedAt,
    }));

    dispatchRoomEvent(normId, {
      type: 'user:joined',
      senderId: user.id,
      data: {
        user: {
          id: userRecord.id,
          name: userRecord.name,
          avatarColor: userRecord.avatarColor,
          isHost: userRecord.isHost,
          hasCamera: userRecord.hasCamera,
          hasMic: userRecord.hasMic,
          isSpeaking: userRecord.isSpeaking,
          isSharingScreen: userRecord.isSharingScreen,
          joinedAt: userRecord.joinedAt,
        },
        allUsers,
      },
    });

    dispatchRoomEvent(normId, {
      type: 'room:users_updated',
      senderId: user.id,
      data: allUsers,
    });

    dispatchRoomEvent(normId, {
      type: 'room:state',
      senderId: user.id,
      data: getRoomSnapshot(room),
    });
  }

  scheduleSaveRooms();
  return userRecord;
}

// Periodically clean up stale users who haven't pinged in 40 seconds
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    let usersChanged = false;
    for (const [userId, user] of room.users.entries()) {
      // Check if user has an active WebSocket
      let hasActiveWs = false;
      for (const [ws, client] of wsClientMap.entries()) {
        if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
          hasActiveWs = true;
          user.lastSeen = now; // Keep alive as long as WS is open
          break;
        }
      }

      if (!hasActiveWs && now - user.lastSeen > 40000) {
        room.users.delete(userId);
        usersChanged = true;

        if (room.hostId === userId && room.users.size > 0) {
          const firstLeft = room.users.values().next().value;
          if (firstLeft) {
            room.hostId = firstLeft.id;
            firstLeft.isHost = true;
          }
        }

        const remainingUsers = Array.from(room.users.values()).map(u => ({
          id: u.id,
          name: u.name,
          avatarColor: u.avatarColor,
          isHost: u.isHost,
          hasCamera: u.hasCamera,
          hasMic: u.hasMic,
          isSpeaking: u.isSpeaking,
          isSharingScreen: u.isSharingScreen,
          joinedAt: u.joinedAt,
        }));

        dispatchRoomEvent(roomId, {
          type: 'user:left',
          senderId: userId,
          data: {
            userId,
            userName: user.name,
            remainingUsers,
          },
        });
      }
    }

    if (usersChanged && room.users.size === 0) {
      setTimeout(() => {
        if (rooms.get(roomId)?.users.size === 0) {
          rooms.delete(roomId);
        }
      }, 600000);
    }
  }
}, 10000);

// WebSocket Connection Management
wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data.toString());
      const normRoomId = (msg.roomId || '').trim().toLowerCase();

      switch (msg.type) {
        case 'join-room': {
          const { userId, userName, userColor, isHost } = msg;
          wsClientMap.set(ws, { userId, roomId: normRoomId, userName });

          touchUser(normRoomId, { id: userId, name: userName, avatarColor: userColor, isHost });
          const room = getOrCreateRoom(normRoomId);

          // Send complete current room snapshot to the joining client
          ws.send(JSON.stringify({
            id: `ev_${Date.now()}_state`,
            type: 'room:state',
            roomId: normRoomId,
            data: getRoomSnapshot(room),
            timestamp: Date.now(),
          }));
          break;
        }

        case 'get-room-state': {
          const room = getOrCreateRoom(normRoomId);
          ws.send(JSON.stringify({
            id: `ev_${Date.now()}_state`,
            type: 'room:state',
            roomId: normRoomId,
            data: getRoomSnapshot(room),
            timestamp: Date.now(),
          }));
          break;
        }

        case 'ping': {
          const client = wsClientMap.get(ws);
          if (client) {
            const room = rooms.get(client.roomId);
            const user = room?.users.get(client.userId);
            if (user) user.lastSeen = Date.now();
          }
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        }

        default: {
          // All other events: sync:video, chat:message, signal:*, user:state_update, etc.
          dispatchRoomEvent(normRoomId, {
            type: msg.type,
            senderId: msg.senderId || msg.userId,
            targetId: msg.targetId,
            data: msg.data !== undefined ? msg.data : msg,
          }, ws);
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    const client = wsClientMap.get(ws);
    if (client) {
      wsClientMap.delete(ws);
      // Give a 15 second grace period before cleaning up in case client reconnects or switches transport
      setTimeout(() => {
        let isReconnected = false;
        for (const c of wsClientMap.values()) {
          if (c.userId === client.userId && c.roomId === client.roomId) {
            isReconnected = true;
            break;
          }
        }
        if (!isReconnected) {
          const room = rooms.get(client.roomId);
          const user = room?.users.get(client.userId);
          // If no recent HTTP poll either, remove
          if (user && Date.now() - user.lastSeen > 20000) {
            room?.users.delete(client.userId);
            const remainingUsers = Array.from(room?.users.values() || []).map(u => ({
              id: u.id,
              name: u.name,
              avatarColor: u.avatarColor,
              isHost: u.isHost,
              hasCamera: u.hasCamera,
              hasMic: u.hasMic,
              isSpeaking: u.isSpeaking,
              isSharingScreen: u.isSharingScreen,
              joinedAt: u.joinedAt,
            }));
            dispatchRoomEvent(client.roomId, {
              type: 'user:left',
              senderId: client.userId,
              data: {
                userId: client.userId,
                userName: client.userName,
                remainingUsers,
              },
            });
          }
        }
      }, 15000);
    }
  });
});

// REST & Signaling API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// List all active rooms with participants (for room discovery & quick join)
app.get('/api/rooms', (req, res) => {
  const activeRooms = Array.from(rooms.values())
    .filter(r => r.users.size > 0)
    .map(r => {
      const hostUser = r.users.get(r.hostId);
      return {
        id: r.id,
        name: r.name,
        userCount: r.users.size,
        hasPassword: Boolean(r.password),
        hostName: hostUser?.name || 'Oda Sahibi',
        currentVideo: r.video?.sourceTitle && r.video.sourceTitle !== 'İçerik Seçilmedi' ? r.video.sourceTitle : 'İçerik Bekleniyor',
        users: Array.from(r.users.values()).map(u => ({ id: u.id, name: u.name, avatarColor: u.avatarColor })),
      };
    });
  res.json({ success: true, rooms: activeRooms });
});

// Direct room state query
app.get('/api/room/:roomId', (req, res) => {
  const normId = (req.params.roomId || '').trim().toLowerCase();
  const room = rooms.get(normId);
  if (!room || room.users.size === 0) {
    return res.status(200).json({ exists: false, error: 'Oda bulunamadı veya henüz aktif değil' });
  }
  res.json({ exists: true, success: true, room: getRoomSnapshot(room) });
});

// Unified HTTP Signaling & Polling endpoint (used across devices, proxies, Cloud Run and Vercel)
app.all('/api/signaling', (req, res) => {
  const query = req.method === 'GET' ? req.query : req.body || {};
  const body = req.body || {};
  const roomId = (query.roomId || body.roomId || '').toString();
  const userId = (query.userId || body.userId || '').toString();
  const userName = (query.userName || body.userName || '').toString();
  const userColor = (query.userColor || body.userColor || '').toString();
  const isHost = query.isHost === true || query.isHost === 'true' || body.isHost === true;
  const action = (query.action || body.action || (body.type === 'join-room' ? 'join' : '')).toString();
  const message = body.message || (body.type && body.type !== 'join-room' ? body : undefined);
  const fetchSince = query.fetchSince || query.lastIndex || query.since || body.fetchSince;
  const userState = body.userState;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId required' });
  }

  const normId = roomId.trim().toLowerCase();
  const room = getOrCreateRoom(normId, userName, userId);

  // Keep participant registered and active
  if (userId && (userName || action === 'join' || body.type === 'join-room')) {
    touchUser(normId, {
      id: userId,
      name: userName || (body.userName) || 'Kullanıcı',
      avatarColor: userColor || (body.userColor) || '#6366f1',
      isHost,
    }, true);
  } else if (userId) {
    const existing = room.users.get(userId);
    if (existing) {
      existing.lastSeen = Date.now();
    }
  }

  // Update user state if provided (camera, mic, etc.)
  if (userId && userState) {
    const user = room.users.get(userId);
    if (user) {
      Object.assign(user, userState);
      user.lastSeen = Date.now();
      dispatchRoomEvent(normId, {
        type: 'user:state_update',
        senderId: userId,
        data: userState,
      });
    }
  }

  // If a new outgoing message is sent from this client:
  if (message) {
    dispatchRoomEvent(normId, {
      type: message.type,
      senderId: message.senderId || userId,
      targetId: message.targetId,
      data: message.data !== undefined ? message.data : message,
    });
  }

  // Filter events for this user since the given sequence or timestamp
  const since = Number(fetchSince) || 0;
  const newEvents = room.events.filter(e => {
    // If client supplied a sequence number (less than 1,000,000) or timestamp
    if (since < 1000000) {
      if (e.seq <= since) return false;
    } else {
      if (e.timestamp <= since) return false;
    }
    if (e.targetId && e.targetId !== userId) return false;
    return true;
  });

  const snapshot = getRoomSnapshot(room);
  const currentSeq = room.nextEventSeq - 1;

  res.json({
    success: true,
    room: snapshot,
    roomState: snapshot,
    users: snapshot.users,
    messages: newEvents,
    events: newEvents,
    lastSeq: currentSeq,
    now: Date.now(),
  });
});

// Gemini AI Film Recommendation Endpoint
app.post('/api/gemini/recommendations', async (req, res) => {
  try {
    const { mood, genre, runtime, prompt } = req.body;

    const queryPrompt = `
Sen bir sinema uzmanı ve film küratörüsün. Birlikte film izleyecek bir arkadaş grubu için en iyi 4 film/dizi tavsiyesini oluştur.
Kullanıcı tercihleri:
- İstenen Tür: ${genre || 'Fark etmez'}
- Ruh Hali: ${mood || 'Sürükleyici, heyecanlı veya keyifli'}
- Süre: ${runtime || 'Standart (90-140 dk)'}
- Özel Not / İstek: ${prompt || 'Grupça izlerken kimsenin sıkılmayacağı, akıcı ve kaliteli bir yapım.'}

Her öneri için:
- Başlık (Orijinal ve Türkçe)
- Çıkış Yılı
- Türler (en fazla 3)
- Süre
- IMDb / Puan tahmini (1-10 arası ondalıklı)
- 2-3 cümlelik heyecan verici film özeti
- "Neden birlikte izlemelisiniz?" gerekçesi (grup dinamiği açısından neden ideal?)
- YouTube'da aratılacak resmi fragman arama terimi
- Örnek direkt oynatılabilir video linki veya fragman başlığı
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: queryPrompt,
      config: {
        systemInstruction: 'Sen CineSync için çalışan profesyonel bir film danışmanısın. Cevabını yalnızca istenen JSON şemasına uygun olarak üret.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              year: { type: Type.INTEGER },
              genre: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              duration: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              description: { type: Type.STRING },
              suggestedReason: { type: Type.STRING },
              trailerQuery: { type: Type.STRING },
              trailerYoutubeUrl: { type: Type.STRING },
            },
            required: ['id', 'title', 'year', 'genre', 'duration', 'rating', 'description', 'suggestedReason'],
          },
        },
      },
    });

    const movies = JSON.parse(response.text || '[]');
    res.json({ movies });
  } catch (err: any) {
    console.error('Gemini recommendation error:', err);
    // Provide a solid curated fallback so the UI never breaks
    res.json({
      movies: [
        {
          id: 'fb-1',
          title: 'Interstellar (Yıldızlararası)',
          year: 2014,
          genre: ['Bilim Kurgu', 'Macera', 'Dram'],
          duration: '169 dk',
          rating: 8.7,
          description: 'İnsanlığın yeni bir yaşanabilir gezegen arayışında solucan deliğinden geçen bir astronot grubunun epik ve duygusal yolculuğu.',
          suggestedReason: 'Arkadaşlarla izlerken görsel şölen, efsanevi Zimmer müzikleri ve üzerinde uzun uzun konuşulacak derin bilim kurgu teorileri sunar.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=zSWdZVtXT7E',
        },
        {
          id: 'fb-2',
          title: 'Knives Out (Bıçaklar Çekildi)',
          year: 2019,
          genre: ['Gizem', 'Komedi', 'Suç'],
          duration: '130 dk',
          rating: 7.9,
          description: 'Zengin bir polisiye yazarının gizemli ölümü sonrası tüm aileyi şüpheli gören dahi dedektif Benoit Blanc\'ın eğlenceli soruşturması.',
          suggestedReason: 'Grupça izlerken katili tahmin etme yarışına dönüşen, temposu hiç düşmeyen son derece eğlenceli bir ters köşe filmi.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=qGqiHJTsRkQ',
        },
        {
          id: 'fb-3',
          title: 'Spider-Man: Into the Spider-Verse',
          year: 2018,
          genre: ['Animasyon', 'Aksiyon', 'Macera'],
          duration: '117 dk',
          rating: 8.4,
          description: 'Miles Morales farklı boyutlardan gelen Örümcek Kahramanlar ile güçlerini birleştirerek çoklu evreni kurtarmak zorundadır.',
          suggestedReason: 'Çığır açan görsel tarzı, harika müzikleri ve 1080p ekranda herkesi büyüleyen akıcı sinematografisiyle kusursuz bir ortak izleme deneyimi.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=g4Hbz2jLxvQ',
        },
        {
          id: 'fb-4',
          title: 'A Quiet Place (Sessiz Bir Yer)',
          year: 2018,
          genre: ['Korku', 'Gerilim', 'Bilim Kurgu'],
          duration: '90 dk',
          rating: 7.5,
          description: 'Sese duyarlı ölümcül yaratıkların istila ettiği bir dünyada hayatta kalabilmek için mutlak sessizlik içinde yaşamak zorunda olan bir ailenin hikayesi.',
          suggestedReason: 'Bas-konuş özelliğimizle mükemmel uyumlu! Film boyu nefesinizi tutup arkadaşlarla gerilim dolu anları anlık paylaşmak için birebir.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=WR7cc5t7tv8',
        },
      ],
    });
  }
});

// Vite Middleware for Development / Static Serve for Production
const isDev = process.env.NODE_ENV !== 'production';

async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`CineSync full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
