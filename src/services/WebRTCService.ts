/**
 * WebRTC service for peer-to-peer connection with a live coder.
 *
 * DataChannel carries JSON messages for:
 * - Note events (so the live coder can see what you're playing)
 * - BPM/tempo sharing
 * - Arbitrary messages
 *
 * Audio channel (future): receive the live coder's audio for monitoring.
 *
 * Signaling: copy-paste (no server needed for prototype).
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';
export type PeerRole = 'leader' | 'follower' | 'none';
export type WebRTCCallback = () => void;
export type MessageCallback = (msg: Record<string, unknown>) => void;

class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private state: ConnectionState = 'disconnected';
  private role: PeerRole = 'none';
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: WebRTCCallback[] = [];
  private messageListeners: MessageCallback[] = [];

  getState() { return this.state; }
  getRole() { return this.role; }
  setRole(role: PeerRole) { this.role = role; this.notifyListeners(); }

  onChange(cb: WebRTCCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  onMessage(cb: MessageCallback) {
    this.messageListeners.push(cb);
    return () => { this.messageListeners = this.messageListeners.filter(l => l !== cb); };
  }

  async createOffer(): Promise<string> {
    this.cleanup();
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.dataChannel = this.pc.createDataChannel('sync', { ordered: true });
    this.setupDataChannel(this.dataChannel);
    this.pc.oniceconnectionstatechange = () => this.handleIceState();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForIceGathering();

    this.state = 'connecting';
    this.notifyListeners();
    return JSON.stringify(this.pc.localDescription);
  }

  async acceptOffer(offerJson: string): Promise<string> {
    this.cleanup();
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.pc.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.setupDataChannel(this.dataChannel);
    };
    this.pc.oniceconnectionstatechange = () => this.handleIceState();

    await this.pc.setRemoteDescription(JSON.parse(offerJson));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceGathering();

    this.state = 'connecting';
    this.notifyListeners();
    return JSON.stringify(this.pc.localDescription);
  }

  async acceptAnswer(answerJson: string) {
    if (!this.pc) throw new Error('No peer connection');
    await this.pc.setRemoteDescription(JSON.parse(answerJson));
  }

  sendMessage(msg: Record<string, unknown>) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(msg));
    }
  }

  // Send note events to peer (so they can see/react)
  sendNoteOn(note: number, velocity: number) {
    this.sendMessage({ type: 'noteOn', note, velocity });
  }

  sendNoteOff(note: number) {
    this.sendMessage({ type: 'noteOff', note });
  }

  startLeaderClock(bpm = 120) {
    this.stopLeaderClock();
    const intervalMs = 60000 / bpm;
    this.clockInterval = setInterval(() => {
      this.sendMessage({ type: 'clock', time: Date.now(), bpm });
    }, intervalMs);
  }

  stopLeaderClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  disconnect() {
    this.stopLeaderClock();
    this.cleanup();
    this.state = 'disconnected';
    this.role = 'none';
    this.notifyListeners();
  }

  private setupDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      this.state = 'connected';
      this.notifyListeners();
    };
    dc.onclose = () => {
      this.state = 'disconnected';
      this.notifyListeners();
    };
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          for (const cb of this.messageListeners) cb(msg);
        } catch { /* ignore */ }
      }
    };
  }

  private handleIceState() {
    if (!this.pc) return;
    const s = this.pc.iceConnectionState;
    if (s === 'connected' || s === 'completed') {
      this.state = 'connected';
    } else if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      this.state = 'disconnected';
    }
    this.notifyListeners();
  }

  private async waitForIceGathering(): Promise<void> {
    if (!this.pc || this.pc.iceGatheringState === 'complete') return;
    return new Promise((resolve) => {
      this.pc!.onicegatheringstatechange = () => {
        if (this.pc?.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 5000);
    });
  }

  private cleanup() {
    if (this.dataChannel) { this.dataChannel.close(); this.dataChannel = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
  }

  private notifyListeners() {
    for (const l of this.listeners) l();
  }
}

export const webrtcService = new WebRTCService();
