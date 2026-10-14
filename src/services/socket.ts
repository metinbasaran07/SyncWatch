import { RoomState, VideoState, ChatMessage, EmojiReaction, SignalingMessage } from '../types';

type MessageHandler = (data: any) => void;

class SocketClient {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private roomId: string = '';
  private userId: string = '';
  private userName: string = '';
  private userColor: string = '';
  private isHost: boolean = false;
  private isConnecting: boolean = false;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private pollTimer: any = null;
  private lastPollTimestamp: number = 0;

  public init(roomId: string, userId: string, userName: string, userColor: string, isHost: boolean) {
    this.roomId = roomId;
    this.userId = userId;
    this.userName = userName;
    this.userColor = userColor;
    this.isHost = isHost;

    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        if (this.broadcastChannel) {
          this.broadcastChannel.close();
        }
        this.broadcastChannel = new BroadcastChannel(`cinesync_room_${roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.senderId !== this.userId) {
            this.emitLocal(msg.type, msg.data, msg.senderId);
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported');
    }

    this.connectWebSocket();
    this.startHttpPollingFallback();
  }

  private connectWebSocket() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Send Join Room Packet immediately
        this.send({
          type: 'join-room',
          roomId: this.roomId,
          userId: this.userId,
          userName: this.userName,
          userColor: this.userColor,
          isHost: this.isHost,
        });

        this.emitLocal('connection:status', { connected: true, mode: 'websocket' });

        // Heartbeat keep-alive every 15 seconds
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping', roomId: this.roomId, userId: this.userId }));
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') return;
          this.emitLocal(msg.type, msg.data ?? msg, msg.senderId);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error, utilizing HTTP sync:', err);
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.emitLocal('connection:status', { connected: false, mode: 'reconnecting' });

        // Rapid auto-reconnect after 1.5s
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.connectWebSocket();
          }, 1500);
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.warn('WebSocket connection init failed:', err);
    }
  }

  // HTTP polling fallback for cross-device resilience
  private startHttpPollingFallback() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.lastPollTimestamp = Date.now();

    this.pollTimer = setInterval(async () => {
      // If WebSocket is actively open, we don't need heavy HTTP polling
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      if (!this.roomId) return;

      try {
        const res = await fetch('/api/signaling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: this.roomId,
            fetchSince: this.lastPollTimestamp,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          this.lastPollTimestamp = json.now || Date.now();
          if (Array.isArray(json.messages)) {
            for (const msg of json.messages) {
              if (msg.senderId !== this.userId) {
                this.emitLocal(msg.type, msg.data ?? msg, msg.senderId);
              }
            }
          }
        }
      } catch (e) {
        // network silent retry
      }
    }, 2000);
  }

  public on(event: string, handler: MessageHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  public off(event: string, handler: MessageHandler) {
    this.listeners.get(event)?.delete(handler);
  }

  private emitLocal(event: string, data: any, senderId?: string) {
    this.listeners.get(event)?.forEach(handler => handler({ data, senderId }));
    this.listeners.get('*')?.forEach(handler => handler({ event, data, senderId }));
  }

  public send(payload: any) {
    const enriched = {
      ...payload,
      roomId: payload.roomId || this.roomId,
      senderId: payload.senderId || this.userId,
      timestamp: Date.now(),
    };

    // 1. Send via WebSocket if open
    let sentViaWs = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(enriched));
      sentViaWs = true;
    }

    // 2. BroadcastChannel local across tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(enriched);
      } catch (e) {}
    }

    // 3. If WS is closed or error, send via HTTP signaling endpoint so other devices receive it
    if (!sentViaWs && this.roomId) {
      fetch('/api/signaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          message: enriched,
        }),
      }).catch(() => {});
    }
  }

  public syncVideo(videoState: Partial<VideoState>) {
    this.send({
      type: 'sync:video',
      data: videoState,
    });
  }

  public sendChatMessage(message: ChatMessage) {
    this.send({
      type: 'chat:message',
      data: message,
    });
  }

  public sendReaction(reaction: EmojiReaction) {
    this.send({
      type: 'chat:reaction',
      data: reaction,
    });
  }

  public updateUserState(data: { hasCamera?: boolean; hasMic?: boolean; isSpeaking?: boolean; isSharingScreen?: boolean }) {
    this.send({
      type: 'user:state_update',
      userId: this.userId,
      data,
    });
  }

  public sendSignal(type: 'offer' | 'answer' | 'candidate', data: any, targetId?: string) {
    this.send({
      type: `signal:${type}`,
      targetId,
      data,
    });
  }

  public updateVote(voteData: any) {
    this.send({
      type: 'vote:update',
      data: voteData,
    });
  }

  public updatePassword(password: string) {
    this.send({
      type: 'room:password_update',
      data: { password },
    });
  }

  public disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.listeners.clear();
  }
}

export const socket = new SocketClient();
