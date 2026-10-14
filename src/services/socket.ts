import { RoomState, VideoState, ChatMessage, EmojiReaction, RoomUser } from '../types';

type MessageHandler = (payload: { data: any; senderId?: string; event?: string }) => void;

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
  private syncPollTimer: any = null;
  private lastPollTimestamp: number = 0;
  private lastRoomState: any = null;
  private seenMessageIds: Set<string> = new Set();

  public init(roomId: string, userId: string, userName: string, userColor: string, isHost: boolean) {
    this.roomId = roomId.trim().toLowerCase();
    this.userId = userId;
    this.userName = userName;
    this.userColor = userColor;
    this.isHost = isHost;

    // Reset state & timers
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.syncPollTimer) clearInterval(this.syncPollTimer);

    // 1. Setup multi-tab BroadcastChannel
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        if (this.broadcastChannel) {
          this.broadcastChannel.close();
        }
        this.broadcastChannel = new BroadcastChannel(`cinesync_room_${this.roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.senderId !== this.userId) {
            this.handleIncomingEvent(msg.type, msg.data ?? msg, msg.senderId, msg.id);
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel unavailable');
    }

    // 2. Immediate HTTP join & room state retrieval (guarantees second device sees room state in <100ms)
    this.performHttpSync('join');

    // 3. Connect WebSocket (for low-latency real-time stream when available)
    this.connectWebSocket();

    // 4. Start reliable background synchronization polling
    this.startAdaptiveSyncLoop();
  }

  private handleIncomingEvent(type: string, data: any, senderId?: string, msgId?: string) {
    if (msgId) {
      if (this.seenMessageIds.has(msgId)) return;
      this.seenMessageIds.add(msgId);
      if (this.seenMessageIds.size > 500) {
        const first = this.seenMessageIds.values().next().value;
        if (first) this.seenMessageIds.delete(first);
      }
    }

    if (type === 'room:state') {
      this.lastRoomState = data;
    }

    this.emitLocal(type, data, senderId);
  }

  private connectWebSocket() {
    if (this.isConnecting || !this.roomId) return;
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

        // Register with server on connection
        this.sendWsPayload({
          type: 'join-room',
          roomId: this.roomId,
          userId: this.userId,
          userName: this.userName,
          userColor: this.userColor,
          isHost: this.isHost,
        });

        this.emitLocal('connection:status', { connected: true, mode: 'websocket' });

        // Keep-alive heartbeat every 15 seconds
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'ping',
              roomId: this.roomId,
              userId: this.userId,
            }));
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') return;
          this.handleIncomingEvent(msg.type, msg.data !== undefined ? msg.data : msg, msg.senderId, msg.id);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket encountered error, relying on unified HTTP sync fallback:', err);
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.emitLocal('connection:status', { connected: false, mode: 'http-sync' });

        // Auto-reconnect after 2 seconds
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.connectWebSocket();
          }, 2000);
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.warn('WebSocket init exception:', err);
    }
  }

  // Unified HTTP Sync & Polling Loop
  private startAdaptiveSyncLoop() {
    if (this.syncPollTimer) clearInterval(this.syncPollTimer);
    this.lastPollTimestamp = Date.now();

    const tick = async () => {
      // 1.5s when WS closed, 3.5s when WS open for background reconciliation
      const interval = (this.ws && this.ws.readyState === WebSocket.OPEN) ? 3500 : 1500;
      await this.performHttpSync('poll');
      this.syncPollTimer = setTimeout(tick, interval);
    };

    this.syncPollTimer = setTimeout(tick, 1000);
  }

  public async performHttpSync(action: 'join' | 'poll' | 'heartbeat' = 'poll', outgoingMessage?: any) {
    if (!this.roomId) return;

    try {
      const payload: any = {
        roomId: this.roomId,
        userId: this.userId,
        userName: this.userName,
        userColor: this.userColor,
        isHost: this.isHost,
        action,
        fetchSince: this.lastPollTimestamp,
      };

      if (outgoingMessage) {
        payload.message = outgoingMessage;
      }

      const res = await fetch('/api/signaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json = await res.json();
        this.lastPollTimestamp = json.now || Date.now();

        // 1. Process full room state (users, video, name)
        if (json.room) {
          const prevUsersCount = this.lastRoomState?.users?.length || 0;
          const newUsersCount = json.room.users?.length || 0;
          this.lastRoomState = json.room;

          // Emit room state so UI stays 100% updated with all participants
          this.emitLocal('room:state', json.room, 'server');

          // If participant list changed, notify
          if (prevUsersCount !== newUsersCount && Array.isArray(json.room.users)) {
            this.emitLocal('room:users_updated', json.room.users, 'server');
          }
        }

        // 2. Process incremental events from other peers
        if (Array.isArray(json.messages)) {
          for (const ev of json.messages) {
            if (ev.senderId !== this.userId) {
              this.handleIncomingEvent(ev.type, ev.data !== undefined ? ev.data : ev, ev.senderId, ev.id);
            }
          }
        }
      }
    } catch (e) {
      // Network retry on next interval
    }
  }

  public requestRoomState() {
    // Both WS and HTTP
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsPayload({ type: 'get-room-state', roomId: this.roomId });
    }
    this.performHttpSync('poll');
  }

  public on(event: string, handler: MessageHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // If attaching 'room:state' and we already have a cached state, fire immediately!
    if (event === 'room:state' && this.lastRoomState) {
      setTimeout(() => {
        handler({ data: this.lastRoomState, senderId: 'server' });
      }, 0);
    }

    return () => this.off(event, handler);
  }

  public off(event: string, handler: MessageHandler) {
    this.listeners.get(event)?.delete(handler);
  }

  private emitLocal(event: string, data: any, senderId?: string) {
    this.listeners.get(event)?.forEach(handler => handler({ data, senderId }));
    this.listeners.get('*')?.forEach(handler => handler({ event, data, senderId }));
  }

  private sendWsPayload(payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  public send(payload: any) {
    const enriched = {
      ...payload,
      id: `cli_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      roomId: payload.roomId || this.roomId,
      senderId: payload.senderId || this.userId,
      timestamp: Date.now(),
    };

    // 1. BroadcastChannel local across tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(enriched);
      } catch (e) {}
    }

    // 2. Send via WebSocket if connected
    const sentViaWs = this.sendWsPayload(enriched);

    // 3. Send via HTTP signaling endpoint (immediate delivery if WS is disconnected, or for persistent state events)
    const isCriticalState = ['sync:video', 'chat:message', 'room:password_update', 'vote:update', 'join-room'].includes(enriched.type);
    if (!sentViaWs || isCriticalState) {
      this.performHttpSync('poll', enriched);
    }
  }

  public sendSignal(type: 'offer' | 'answer' | 'candidate', data: any, targetId: string) {
    this.send({
      type: `signal:${type}`,
      data,
      targetId,
    });
  }

  public updateUserState(state: Partial<RoomUser>) {
    this.send({
      type: 'user:state_update',
      userId: this.userId,
      data: state,
    });
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

  public updatePassword(password: string) {
    this.send({
      type: 'room:password_update',
      data: { password },
    });
  }

  public updateVote(voteData: RoomState['activeVote']) {
    this.send({
      type: 'vote:update',
      data: voteData,
    });
  }

  public disconnect() {
    if (this.syncPollTimer) clearTimeout(this.syncPollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }
}

export const socket = new SocketClient();
