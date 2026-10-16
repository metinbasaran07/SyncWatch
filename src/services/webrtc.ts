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
  private peerTransceivers: Map<string, {
    mic?: RTCRtpTransceiver;
    cam?: RTCRtpTransceiver;
    screenVid?: RTCRtpTransceiver;
    screenAud?: RTCRtpTransceiver;
  }> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map(); // Camera & mic streams
  private remoteScreenStreams: Map<string, MediaStream> = new Map(); // Dedicated screen share streams (Netflix / tab video + audio)
  private onRemoteStreamsChange: RemoteStreamsChangeCallback | null = null;
  private onRemoteScreenStreamsChange: ((screenStreams: Map<string, MediaStream>) => void) | null = null;
  private onSpeakingChanged: SpeakingCallback | null = null;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private isPushToTalkMode: boolean = false;
  private isPushToTalkActive: boolean = false;
  private currentRoomId: string = '';
  private currentUserId: string = '';

  public init(roomId: string, userId: string) {
    this.currentRoomId = roomId;
    this.currentUserId = userId;
  }

  public setCallbacks(
    onStreams: RemoteStreamsChangeCallback,
    onSpeaking?: SpeakingCallback,
    onScreenStreams?: (screenStreams: Map<string, MediaStream>) => void
  ) {
    this.onRemoteStreamsChange = onStreams;
    if (onSpeaking) this.onSpeakingChanged = onSpeaking;
    if (onScreenStreams) this.onRemoteScreenStreamsChange = onScreenStreams;
  }

  public getRemoteStreams(): Map<string, MediaStream> {
    return this.remoteStreams;
  }

  public getRemoteScreenStreams(): Map<string, MediaStream> {
    return this.remoteScreenStreams;
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

      // Attach new tracks to all existing peers using their camera & mic transceivers
      const micTrack = this.localStream.getAudioTracks()[0] || null;
      const camTrack = this.localStream.getVideoTracks()[0] || null;

      this.peers.forEach((peer, peerId) => {
        const transceivers = this.peerTransceivers.get(peerId);
        if (transceivers) {
          if (transceivers.mic && micTrack) transceivers.mic.sender.replaceTrack(micTrack).catch(() => {});
          if (transceivers.cam && camTrack) transceivers.cam.sender.replaceTrack(camTrack).catch(() => {});
        } else {
          // Fallback track replacement
          const senders = peer.getSenders();
          if (camTrack) {
            const videoSender = senders.find((s) => s.track?.kind === 'video');
            if (videoSender) videoSender.replaceTrack(camTrack).catch(() => {});
            else peer.addTrack(camTrack, this.localStream!);
          }
          if (micTrack) {
            const audioSender = senders.find((s) => s.track?.kind === 'audio');
            if (audioSender) audioSender.replaceTrack(micTrack).catch(() => {});
            else peer.addTrack(micTrack, this.localStream!);
          }
        }
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

      // Capture browser tab/screen with pristine 1080p60 video and stereo audio
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
      const audioTrack = this.screenStream.getAudioTracks()[0] || null;

      if (videoTrack) {
        videoTrack.contentHint = 'motion';
        videoTrack.onended = () => {
          this.stopScreenShare();
        };

        // Attach screen share tracks to the dedicated screen transceivers on each peer
        this.peers.forEach((peer, peerId) => {
          const transceivers = this.peerTransceivers.get(peerId);
          if (transceivers?.screenVid) {
            transceivers.screenVid.sender.replaceTrack(videoTrack).catch(() => {});
            if (audioTrack && transceivers.screenAud) {
              transceivers.screenAud.sender.replaceTrack(audioTrack).catch(() => {});
            }
          } else {
            // Fallback for peers
            const senders = peer.getSenders();
            const videoSender = senders.find((s) => s.track?.kind === 'video' && s !== transceivers?.cam?.sender);
            if (videoSender) {
              videoSender.replaceTrack(videoTrack).catch(() => {});
            } else {
              peer.addTrack(videoTrack, this.screenStream!);
              if (audioTrack) peer.addTrack(audioTrack, this.screenStream!);
            }
          }
        });
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
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;

      // Reset screen share tracks to null on all peers without interrupting camera or mic
      this.peers.forEach((peer, peerId) => {
        const transceivers = this.peerTransceivers.get(peerId);
        if (transceivers?.screenVid) {
          transceivers.screenVid.sender.replaceTrack(null).catch(() => {});
        }
        if (transceivers?.screenAud) {
          transceivers.screenAud.sender.replaceTrack(null).catch(() => {});
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

    // Dedicated Pre-allocated Transceivers:
    // 0: mic (audio)
    // 1: camera (video)
    // 2: screen share video (video)
    // 3: screen share audio (audio - Netflix/tab sound)
    let micTransceiver: RTCRtpTransceiver | undefined;
    let camTransceiver: RTCRtpTransceiver | undefined;
    let screenVidTransceiver: RTCRtpTransceiver | undefined;
    let screenAudTransceiver: RTCRtpTransceiver | undefined;

    try {
      micTransceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });
      camTransceiver = peer.addTransceiver('video', { direction: 'sendrecv' });
      screenVidTransceiver = peer.addTransceiver('video', { direction: 'sendrecv' });
      screenAudTransceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });

      this.peerTransceivers.set(targetUserId, {
        mic: micTransceiver,
        cam: camTransceiver,
        screenVid: screenVidTransceiver,
        screenAud: screenAudTransceiver,
      });

      // Bind local camera/mic if active
      if (this.localStream) {
        const aTrack = this.localStream.getAudioTracks()[0];
        const vTrack = this.localStream.getVideoTracks()[0];
        if (aTrack && micTransceiver) micTransceiver.sender.replaceTrack(aTrack).catch(() => {});
        if (vTrack && camTransceiver) camTransceiver.sender.replaceTrack(vTrack).catch(() => {});
      }

      // Bind local screen share if active
      if (this.screenStream) {
        const svTrack = this.screenStream.getVideoTracks()[0];
        const saTrack = this.screenStream.getAudioTracks()[0];
        if (svTrack && screenVidTransceiver) screenVidTransceiver.sender.replaceTrack(svTrack).catch(() => {});
        if (saTrack && screenAudTransceiver) screenAudTransceiver.sender.replaceTrack(saTrack).catch(() => {});
      }
    } catch (e) {
      console.warn('Transceiver allocation fallback:', e);
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          try { peer.addTrack(track, this.localStream!); } catch (err) {}
        });
      }
    }

    peer.ontrack = (event) => {
      const track = event.track;

      // A track is screen share ONLY if:
      // - It has motion contentHint (explicitly set on getDisplayMedia video tracks)
      // - OR its label explicitly indicates screen/window capture and is NOT a webcam/camera
      const isMotionScreen = track.contentHint === 'motion';
      const isScreenLabel =
        (track.label.toLowerCase().includes('screen') || track.label.toLowerCase().includes('window')) &&
        !track.label.toLowerCase().includes('camera');
      const isScreenShareTrack = isMotionScreen || isScreenLabel;

      if (isScreenShareTrack) {
        let screenStream = this.remoteScreenStreams.get(targetUserId);
        if (!screenStream) {
          screenStream = new MediaStream();
        }
        // Remove existing track of same kind and add new one
        screenStream.getTracks().filter((t) => t.kind === track.kind).forEach((t) => screenStream!.removeTrack(t));
        screenStream.addTrack(track);

        const newScreenStream = new MediaStream(screenStream.getTracks());
        this.remoteScreenStreams.set(targetUserId, newScreenStream);

        const notifyScreen = () => {
          if (this.onRemoteScreenStreamsChange) {
            this.onRemoteScreenStreamsChange(new Map(this.remoteScreenStreams));
          }
        };

        track.onunmute = () => notifyScreen();
        track.onended = () => {
          newScreenStream.removeTrack(track);
          if (newScreenStream.getTracks().length === 0) {
            this.remoteScreenStreams.delete(targetUserId);
          }
          notifyScreen();
        };

        notifyScreen();
      } else {
        // Camera & Microphone stream
        let cameraStream = this.remoteStreams.get(targetUserId);
        if (!cameraStream) {
          cameraStream = new MediaStream();
        }
        cameraStream.getTracks().filter((t) => t.kind === track.kind).forEach((t) => cameraStream!.removeTrack(t));
        cameraStream.addTrack(track);

        // Produce a fresh MediaStream instance so React components detect stream changes
        const newCameraStream = new MediaStream(cameraStream.getTracks());
        this.remoteStreams.set(targetUserId, newCameraStream);

        const notifyCamera = () => {
          if (this.onRemoteStreamsChange) {
            this.onRemoteStreamsChange(new Map(this.remoteStreams));
          }
        };

        track.onunmute = () => notifyCamera();
        track.onended = () => {
          newCameraStream.removeTrack(track);
          if (newCameraStream.getTracks().length === 0) {
            this.remoteStreams.delete(targetUserId);
          }
          notifyCamera();
        };

        notifyCamera();
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
      // Do not remove on transient 'disconnected', only on definitive 'failed' or 'closed'
      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        this.removePeer(targetUserId);
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
      if (peer.signalingState !== 'stable') {
        try {
          await peer.setLocalDescription({ type: 'rollback' });
        } catch (e) {
          this.removePeer(senderId);
          peer = await this.createPeer(senderId, false);
        }
      }
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
    if (!candidate || !candidate.candidate) return;
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
    this.peerTransceivers.delete(userId);
    const peer = this.peers.get(userId);
    if (peer) {
      peer.close();
      this.peers.delete(userId);
    }
    this.remoteStreams.delete(userId);
    this.remoteScreenStreams.delete(userId);
    if (this.onRemoteStreamsChange) {
      this.onRemoteStreamsChange(new Map(this.remoteStreams));
    }
    if (this.onRemoteScreenStreamsChange) {
      this.onRemoteScreenStreamsChange(new Map(this.remoteScreenStreams));
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
    this.peerTransceivers.clear();
    this.remoteStreams.clear();
    this.remoteScreenStreams.clear();
  }
}

export const webrtc = new WebRTCManager();
