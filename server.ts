import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

// In-Memory Room & Peer Registry
interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  roomId: string;
  userName: string;
}

const clients = new Map<WebSocket, ConnectedClient>();
const rooms = new Map<string, any>();

// Helper to broadcast to room
function broadcastToRoom(roomId: string, message: any, excludeWs?: WebSocket) {
  const payload = JSON.stringify(message);
  for (const [ws, client] of clients.entries()) {
    if (client.roomId === roomId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// WebSocket Connection Management
wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'join-room': {
          const { roomId, userId, userName, userColor, isHost } = msg;
          clients.set(ws, { ws, userId, roomId, userName });

          // Initialize room if not exists
          if (!rooms.has(roomId)) {
            rooms.set(roomId, {
              id: roomId,
              name: `${userName}'in Sinema Odası`,
              hostId: userId,
              video: {
                sourceType: 'youtube',
                sourceUrl: '',
                sourceTitle: 'İçerik Seçilmedi',
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                lastUpdated: Date.now(),
                updatedBy: userName,
                playbackRate: 1,
              },
              users: [],
            });
          }

          const room = rooms.get(roomId);
          const existingUserIdx = room.users.findIndex((u: any) => u.id === userId);
          const newUser = {
            id: userId,
            name: userName,
            avatarColor: userColor || '#e11d48',
            isHost: isHost || room.users.length === 0,
            hasCamera: false,
            hasMic: false,
            isSpeaking: false,
            isSharingScreen: false,
            joinedAt: Date.now(),
          };

          if (existingUserIdx >= 0) {
            room.users[existingUserIdx] = newUser;
          } else {
            room.users.push(newUser);
          }

          // Send full current room state to joined user
          ws.send(JSON.stringify({
            type: 'room:state',
            roomId,
            data: room,
          }));

          // Notify other participants in the room
          broadcastToRoom(roomId, {
            type: 'user:joined',
            roomId,
            data: { user: newUser, allUsers: room.users },
          }, ws);
          break;
        }

        case 'sync:video': {
          const { roomId, data: videoState } = msg;
          const room = rooms.get(roomId);
          if (room) {
            room.video = {
              ...room.video,
              ...videoState,
              lastUpdated: Date.now(),
            };
            // Broadcast synchronization to all other peers
            broadcastToRoom(roomId, {
              type: 'sync:video',
              roomId,
              senderId: msg.senderId,
              data: room.video,
            }, ws);
          }
          break;
        }

        case 'user:state_update': {
          const { roomId, userId, data: userUpdate } = msg;
          const room = rooms.get(roomId);
          if (room) {
            const user = room.users.find((u: any) => u.id === userId);
            if (user) {
              Object.assign(user, userUpdate);
              broadcastToRoom(roomId, {
                type: 'user:state_update',
                roomId,
                userId,
                data: userUpdate,
              }, ws);
            }
          }
          break;
        }

        // WebRTC Signaling: Offer, Answer, ICE Candidate
        case 'signal:offer':
        case 'signal:answer':
        case 'signal:candidate': {
          const { roomId, targetId } = msg;
          // Route specifically to target peer if specified
          if (targetId) {
            for (const [targetWs, client] of clients.entries()) {
              if (client.userId === targetId && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(msg));
                break;
              }
            }
          } else {
            broadcastToRoom(roomId, msg, ws);
          }
          break;
        }

        case 'chat:message': {
          const { roomId } = msg;
          broadcastToRoom(roomId, msg);
          break;
        }

        case 'chat:reaction': {
          const { roomId } = msg;
          broadcastToRoom(roomId, msg);
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        case 'room:password_update': {
          const { roomId, data } = msg;
          const room = rooms.get(roomId);
          if (room) {
            room.password = data?.password || '';
            room.hasPassword = Boolean(data?.password);
            broadcastToRoom(roomId, {
              type: 'room:password_update',
              roomId,
              data: { password: room.password },
            });
          }
          break;
        }

        case 'vote:update': {
          const { roomId, data: voteData } = msg;
          const room = rooms.get(roomId);
          if (room) {
            room.activeVote = voteData;
            broadcastToRoom(roomId, {
              type: 'vote:update',
              roomId,
              data: voteData,
            });
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      const { roomId, userId, userName } = client;
      clients.delete(ws);

      // 15 second grace period for mobile reconnection / page refresh
      setTimeout(() => {
        let isStillConnected = false;
        for (const c of clients.values()) {
          if (c.userId === userId && c.roomId === roomId) {
            isStillConnected = true;
            break;
          }
        }

        if (!isStillConnected) {
          const room = rooms.get(roomId);
          if (room) {
            room.users = room.users.filter((u: any) => u.id !== userId);
            if (room.hostId === userId && room.users.length > 0) {
              room.hostId = room.users[0].id;
              room.users[0].isHost = true;
            }

            broadcastToRoom(roomId, {
              type: 'user:left',
              roomId,
              userId,
              userName,
              remainingUsers: room.users,
            });

            if (room.users.length === 0) {
              setTimeout(() => {
                if (rooms.get(roomId)?.users.length === 0) {
                  rooms.delete(roomId);
                }
              }, 600000);
            }
          }
        }
      }, 15000);
    }
  });
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serverless fallback HTTP signaling store for Vercel
const serverlessMessages: { [key: string]: any[] } = {};

app.post('/api/signaling', (req, res) => {
  const { roomId, message, fetchSince } = req.body;
  if (!roomId) {
    return res.status(400).json({ error: 'roomId required' });
  }

  if (!serverlessMessages[roomId]) {
    serverlessMessages[roomId] = [];
  }

  if (message) {
    message.timestamp = Date.now();
    serverlessMessages[roomId].push(message);
    if (serverlessMessages[roomId].length > 200) {
      serverlessMessages[roomId].shift();
    }
  }

  const since = Number(fetchSince) || 0;
  const recent = serverlessMessages[roomId].filter((m: any) => m.timestamp > since);
  res.json({ messages: recent, now: Date.now() });
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
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
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
