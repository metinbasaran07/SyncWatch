/**
 * CineSync WebRTC Media & Mesh Engine (Firestore P2P Signaling)
 * - Full P2P Mesh for Multi-user Camera & Audio
 * - 1080p60 Motion Screen/Tab Sharing
 * - Push-to-Talk (PTT) with Instant Track Gating
 * - Live Speaking Volume Analyzer
 */

import { firebaseRoomService } from './firebaseRoomService';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Public OpenRelay TURN servers for symmetric NAT / cellular / mobile networks
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelay',
      credential: 'openrelay',
    },
    {
      urls: ['turns:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelay',
      credential: 'openrelay',
    },
  ],
  iceCandidatePoolSize: 10,
};

type RemoteStreamsChangeCallback = (remoteStreams: Map<string, MediaStream>) => void;
type SpeakingCallback = (isSpeaking: boolean, volume: number) => void;

class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private onRemoteStreamsChange: RemoteStreamsChangeCallback | null = null;
  private onSpeakingChanged: SpeakingCallback | null = null;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private screenAudioSource: MediaStreamAudioSourceNode | null = null;
  private micAudioSource: MediaStreamAudioSourceNode | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private onScreenShareEnded: (() => void) | null = null;
  private isPushToTalkMode: boolean = false;
  private isPushToTalkActive: boolean = false;
  private currentRoomId: string = '';
  private currentUserId: string = '';

  public init(roomId: string, userId: string) {
    this.currentRoomId = roomId;
    this.currentUserId = userId;
  }

  public setCallbacks(onStreams: RemoteStreamsChangeCallback, onSpeaking?: SpeakingCallback) {
    this.onRemoteStreamsChange = onStreams;
    if (onSpeaking) this.onSpeakingChanged = onSpeaking;
  }

  public setOnScreenShareEnded(cb: (() => void) | null) {
    this.onScreenShareEnded = cb;
  }

  public getRemoteStreams(): Map<string, MediaStream> {
    return this.remoteStreams;
  }

  public setPushToTalkMode(enabled: boolean) {
    this.isPushToTalkMode = enabled;
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !enabled || this.isPushToTalkActive;
      }
    }
  }

  public triggerPushToTalk(active: boolean) {
    this.isPushToTalkActive = active;
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = active || !this.isPushToTalkMode;
        if (this.currentRoomId && this.currentUserId) {
          firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
            isSpeaking: active,
          });
        }
      }
    }
  }

  /**
   * Initializes local user camera and microphone
   */
  public async startLocalMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream | null> {
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: video
            ? {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 30, max: 30 },
              }
            : false,
          audio: audio
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : false,
        });
      } catch (errFirst) {
        console.warn('Initial getUserMedia fallback:', errFirst);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio });
        } catch (errSecond) {
          if (video && audio) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            } catch (errAudio) {
              stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
          }
        }
      }

      if (!stream) {
        throw new Error('No media stream available');
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }
      this.localStream = stream;

      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack && this.isPushToTalkMode) {
        audioTrack.enabled = this.isPushToTalkActive;
      } else if (audioTrack) {
        audioTrack.enabled = true;
      }

      this.setupAudioMeter(this.localStream);

      // Attach new tracks to all existing peers
      this.peers.forEach((peer) => {
        const senders = peer.getSenders();
        this.localStream!.getTracks().forEach((track) => {
          const sender = senders.find((s) => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track).catch(() => {});
          } else {
            peer.addTrack(track, this.localStream!);
          }
        });
      });

      if (this.currentRoomId && this.currentUserId) {
        firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
          hasCamera: this.localStream.getVideoTracks().length > 0 && this.localStream.getVideoTracks()[0].enabled,
          hasMic: this.localStream.getAudioTracks().length > 0 && this.localStream.getAudioTracks()[0].enabled,
        });
      }

      return this.localStream;
    } catch (err) {
      console.warn('getUserMedia error (camera or mic not available/denied):', err);
      return null;
    }
  }

  public async startHighQualityScreenShare(): Promise<MediaStream | null> {
    try {
      if (this.screenStream) {
        this.stopScreenShare();
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        } as any,
      });

      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = 'motion';
        videoTrack.onended = () => {
          this.stopScreenShare();
          if (this.onScreenShareEnded) {
            this.onScreenShareEnded();
          }
        };

        // Replace video track on all existing peers
        this.peers.forEach((peer) => {
          const senders = peer.getSenders();
          let videoSender = senders.find((s) => s.track?.kind === 'video');
          if (!videoSender) {
            videoSender = senders.find((s) => (s as any).kind === 'video');
          }
          if (videoSender) {
            videoSender.replaceTrack(videoTrack).catch(() => {});
          } else {
            try {
              peer.addTrack(videoTrack, this.screenStream!);
            } catch (e) {}
          }
        });
      }

      // Handle Screen / Tab Audio (e.g. Netflix, YouTube tab audio)
      const screenAudioTrack = this.screenStream.getAudioTracks()[0];
      if (screenAudioTrack) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          try {
            if (!this.audioCtx || this.audioCtx.state === 'closed') {
              this.audioCtx = new AudioCtxClass();
            }
            if (this.audioCtx.state === 'suspended') {
              this.audioCtx.resume().catch(() => {});
            }

            const destination = this.audioCtx.createMediaStreamDestination();
            this.audioDestination = destination;

            const screenSource = this.audioCtx.createMediaStreamSource(new MediaStream([screenAudioTrack]));
            this.screenAudioSource = screenSource;
            screenSource.connect(destination);

            // Also connect microphone if present so friends can hear both your voice and the film!
            if (this.localStream && this.localStream.getAudioTracks().length > 0) {
              const micTrack = this.localStream.getAudioTracks()[0];
              if (micTrack) {
                const micSource = this.audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
                this.micAudioSource = micSource;
                micSource.connect(destination);
              }
            }

            const mixedAudioTrack = destination.stream.getAudioTracks()[0];
            if (mixedAudioTrack) {
              this.peers.forEach((peer) => {
                const senders = peer.getSenders();
                const audioSender = senders.find((s) => s.track?.kind === 'audio');
                if (audioSender) {
                  audioSender.replaceTrack(mixedAudioTrack).catch(() => {});
                }
              });
            }
          } catch (audioErr) {
            console.warn('Audio mixing fallback to raw screen audio track:', audioErr);
            this.peers.forEach((peer) => {
              const senders = peer.getSenders();
              const audioSender = senders.find((s) => s.track?.kind === 'audio');
              if (audioSender) {
                audioSender.replaceTrack(screenAudioTrack).catch(() => {});
              }
            });
          }
        }
      }

      if (this.currentRoomId && this.currentUserId) {
        firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
          isSharingScreen: true,
        });
      }

      return this.screenStream;
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err);
      return null;
    }
  }

  public stopScreenShare() {
    if (this.screenAudioSource) {
      try {
        this.screenAudioSource.disconnect();
      } catch (e) {}
      this.screenAudioSource = null;
    }
    if (this.micAudioSource) {
      try {
        this.micAudioSource.disconnect();
      } catch (e) {}
      this.micAudioSource = null;
    }
    this.audioDestination = null;

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;

      // Restore camera video track and local mic audio track
      const localVideo = this.localStream?.getVideoTracks()[0];
      const localAudio = this.localStream?.getAudioTracks()[0];

      this.peers.forEach((peer) => {
        const senders = peer.getSenders();
        if (localVideo) {
          const videoSender = senders.find((s) => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(localVideo).catch(() => {});
          }
        }
        if (localAudio) {
          const audioSender = senders.find((s) => s.track?.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(localAudio).catch(() => {});
          }
        }
      });

      if (this.currentRoomId && this.currentUserId) {
        firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
          isSharingScreen: false,
        });
      }
    }
  }

  public toggleCamera(enabled: boolean) {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
        if (this.currentRoomId && this.currentUserId) {
          firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
            hasCamera: enabled,
          });
        }
      }
    }
  }

  public toggleMic(enabled: boolean) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
        if (this.currentRoomId && this.currentUserId) {
          firebaseRoomService.updateParticipantState(this.currentRoomId, this.currentUserId, {
            hasMic: enabled,
          });
        }
      }
    }
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  // --- WebRTC Peer Mesh Signaling via Firestore ---
  public async createPeer(targetUserId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    if (this.peers.has(targetUserId)) {
      const existingPeer = this.peers.get(targetUserId)!;
      if (existingPeer.connectionState === 'closed' || existingPeer.connectionState === 'failed') {
        this.removePeer(targetUserId);
      } else {
        if (isInitiator && !existingPeer.localDescription && existingPeer.signalingState === 'stable') {
          try {
            const offer = await existingPeer.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            await existingPeer.setLocalDescription(offer);
            firebaseRoomService.sendSignal(
              this.currentRoomId,
              this.currentUserId,
              targetUserId,
              'offer',
              offer
            );
          } catch (err) {
            console.error('Error creating WebRTC offer on existing peer:', err);
          }
        }
        return existingPeer;
      }
    }

    const peer = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(targetUserId, peer);

    // Attach active tracks (screen share if active, or local webcam/mic)
    const activeVideoTrack =
      this.screenStream?.getVideoTracks()[0] || this.localStream?.getVideoTracks()[0];
    const activeAudioTrack =
      this.audioDestination?.stream.getAudioTracks()[0] || this.localStream?.getAudioTracks()[0];

    let hasAddedAudio = false;
    let hasAddedVideo = false;

    if (activeAudioTrack) {
      try {
        peer.addTrack(activeAudioTrack, this.localStream || new MediaStream([activeAudioTrack]));
        hasAddedAudio = true;
      } catch (e) {}
    }
    if (activeVideoTrack) {
      try {
        peer.addTrack(
          activeVideoTrack,
          this.screenStream || this.localStream || new MediaStream([activeVideoTrack])
        );
        hasAddedVideo = true;
      } catch (e) {}
    }

    if (!hasAddedAudio) {
      try {
        peer.addTransceiver('audio', { direction: 'sendrecv' });
      } catch (e) {}
    }
    if (!hasAddedVideo) {
      try {
        peer.addTransceiver('video', { direction: 'sendrecv' });
      } catch (e) {}
    }

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.remoteStreams.set(targetUserId, stream);
        if (this.onRemoteStreamsChange) {
          this.onRemoteStreamsChange(new Map(this.remoteStreams));
        }
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && this.currentRoomId) {
        firebaseRoomService.sendSignal(
          this.currentRoomId,
          this.currentUserId,
          targetUserId,
          'candidate',
          event.candidate
        );
      }
    };

    peer.onconnectionstatechange = () => {
      if (
        peer.connectionState === 'disconnected' ||
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        this.remoteStreams.delete(targetUserId);
        this.peers.delete(targetUserId);
        if (this.onRemoteStreamsChange) {
          this.onRemoteStreamsChange(new Map(this.remoteStreams));
        }
      }
    };

    if (isInitiator) {
      try {
        const offer = await peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await peer.setLocalDescription(offer);
        firebaseRoomService.sendSignal(
          this.currentRoomId,
          this.currentUserId,
          targetUserId,
          'offer',
          offer
        );
      } catch (err) {
        console.error('Error creating WebRTC offer:', err);
      }
    }

    return peer;
  }

  private async drainCandidates(userId: string, peer: RTCPeerConnection) {
    const queued = this.pendingCandidates.get(userId);
    if (!queued || queued.length === 0) return;
    this.pendingCandidates.delete(userId);
    for (const cand of queued) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('Error adding drained candidate:', e);
      }
    }
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit) {
    let peer = this.peers.get(senderId);
    if (!peer) {
      peer = await this.createPeer(senderId, false);
    }

    try {
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      await this.drainCandidates(senderId, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      firebaseRoomService.sendSignal(
        this.currentRoomId,
        this.currentUserId,
        senderId,
        'answer',
        answer
      );
    } catch (err) {
      console.error('Error handling WebRTC offer:', err);
    }
  }

  public async handleAnswer(senderId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(senderId);
    if (peer) {
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        await this.drainCandidates(senderId, peer);
      } catch (err) {
        console.error('Error handling WebRTC answer:', err);
      }
    }
  }

  public async handleCandidate(senderId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(senderId);
    if (peer && peer.remoteDescription && peer.remoteDescription.type) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    } else {
      if (!this.pendingCandidates.has(senderId)) {
        this.pendingCandidates.set(senderId, []);
      }
      this.pendingCandidates.get(senderId)!.push(candidate);
    }
  }

  public handleIncomingSignal(senderId: string, type: string, data: any) {
    if (type === 'offer') {
      this.handleOffer(senderId, data);
    } else if (type === 'answer') {
      this.handleAnswer(senderId, data);
    } else if (type === 'candidate') {
      this.handleCandidate(senderId, data);
    }
  }

  public removePeer(userId: string) {
    this.pendingCandidates.delete(userId);
    const peer = this.peers.get(userId);
    if (peer) {
      peer.close();
      this.peers.delete(userId);
    }
    this.remoteStreams.delete(userId);
    if (this.onRemoteStreamsChange) {
      this.onRemoteStreamsChange(new Map(this.remoteStreams));
    }
  }

  private setupAudioMeter(stream: MediaStream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      this.audioCtx = new AudioCtxClass();
      if (this.audioCtx.state === 'suspended') {
        const resumeAudio = () => {
          this.audioCtx?.resume();
          window.removeEventListener('click', resumeAudio);
        };
        window.addEventListener('click', resumeAudio);
      }

      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(1, avg / 128);
        const isSpeaking = normalized > 0.15;

        if (this.onSpeakingChanged) {
          this.onSpeakingChanged(isSpeaking, normalized);
        }

        this.animFrameId = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('Audio meter init error:', e);
    }
  }

  public cleanup() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.audioCtx) this.audioCtx.close();
    if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
    if (this.screenStream) this.screenStream.getTracks().forEach((t) => t.stop());
    this.peers.forEach((peer) => peer.close());
    this.peers.clear();
    this.remoteStreams.clear();
  }
}

export const webrtc = new WebRTCManager();
