import { RoomState, VideoState, ChatMessage, EmojiReaction, SignalingMessage } from '../types';

type MessageHandler = (data: any) => void;

class SocketClient {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private roomId: string = '';
  private userId: string = '';
  private isConnecting: boolean = false;
  private reconnectTimer: any = null;

  public init(roomId: string, userId: string, userName: string, userColor: string, isHost: boolean) {
    this.roomId = roomId;
    this.userId = userId;

    // Initialize BroadcastChannel as local mesh fallback across browser tabs
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.broadcastChannel = new BroadcastChannel(`cinesync_room_${roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.senderId !== this.userId) {
            this.emitLocal(msg.type, msg.data, msg.senderId);
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported in this environment');
    }

    this.connectWebSocket(roomId, userId, userName, userColor, isHost);
  }

  private connectWebSocket(roomId: string, userId: string, userName: string, userColor: string, isHost: boolean) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Send Join Room Packet
        this.send({
          type: 'join-room',
          roomId,
          userId,
          userName,
          userColor,
          isHost,
        });

        this.emitLocal('connection:status', { connected: true, mode: 'websocket' });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emitLocal(msg.type, msg.data ?? msg, msg.senderId);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error, falling back to local mesh/HTTP:', err);
        this.emitLocal('connection:status', { connected: false, mode: 'fallback' });
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.emitLocal('connection:status', { connected: false, mode: 'reconnecting' });
        // Attempt reconnect after 3 seconds
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.connectWebSocket(roomId, userId, userName, userColor, isHost);
          }, 3000);
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.warn('WebSocket init failed, using BroadcastChannel:', err);
      this.emitLocal('connection:status', { connected: true, mode: 'broadcast' });
    }
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(enriched));
    }

    // 2. Broadcast locally across tabs (so friends on multiple tabs/windows stay 100% in sync)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(enriched);
      } catch (e) {
        // channel closed or busy
      }
    }
  }

  // High-level CineSync Actions
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

  public disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
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
