export type VideoSourceType = 'youtube' | 'direct' | 'screenshare';

export interface VideoState {
  sourceType: VideoSourceType;
  sourceUrl: string;
  sourceTitle: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  lastUpdated: number;
  updatedBy: string;
  playbackRate: number;
}

export interface RoomUser {
  id: string;
  name: string;
  avatarColor: string;
  isHost: boolean;
  hasCamera: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  isSharingScreen: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
  isEncrypted?: boolean;
}

export interface EmojiReaction {
  id: string;
  emoji: string;
  senderName: string;
  timestamp: number;
  xOffset: number; // For float animation
}

export interface MovieSuggestion {
  id: string;
  title: string;
  year: number;
  genre: string[];
  duration: string;
  rating: number;
  description: string;
  suggestedReason: string;
  trailerYoutubeUrl?: string;
  directWatchUrl?: string;
  posterBgColor?: string;
  votes: { [userId: string]: 'up' | 'down' };
}

export interface RoomState {
  id: string;
  name: string;
  isLocked: boolean;
  hasPassword: boolean;
  hostId: string;
  video: VideoState;
  users: RoomUser[];
  activeVote?: {
    id: string;
    movie: MovieSuggestion;
    yesVotes: string[];
    noVotes: string[];
    initiatedBy: string;
    expiresAt: number;
  };
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate' | 'user-joined' | 'user-left' | 'sync:video' | 'chat:message' | 'chat:reaction' | 'room:state' | 'vote:update';
  roomId: string;
  senderId: string;
  targetId?: string;
  data: any;
}
