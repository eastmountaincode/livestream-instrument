/**
 * Resonant Filter Instrument Engine
 *
 * Each stream gets its own bank of resonant bandpass filters with independent
 * Q (resonance) and volume controls. Notes activate across all streams.
 *
 * Signal chain per stream:
 *   audioElement → mono → filter(bandpass, Q) → voiceGain → streamGain → masterGain → ...
 *
 * Master chain:
 *   masterGain → compressor → analyser → destination
 */

const VOICES_PER_STREAM = 16;
const DEFAULT_Q = 30;
const DEFAULT_VOL = 0.8;
const ATTACK = 0.02;
const RELEASE = 0.3;
const FADE_TIME = 0.5;
const VOICE_GAIN_BOOST = 8.0;

interface Voice {
  note: number;
  filter: BiquadFilterNode;
  gain: GainNode;
  active: boolean;
}

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

interface StreamChannel {
  source: MediaElementAudioSourceNode;
  streamGain: GainNode;
  panner: StereoPannerNode;
  audioElement: HTMLAudioElement;
  voices: Voice[];
  activeVoices: Map<number, Voice>;
  filterQ: number;
  volume: number;
  octaveShift: number;
  muted: boolean;
  pan: number;
}

export class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;

  private channels: Map<string, StreamChannel> = new Map();
  private externalClock = false;

  constructor() {
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.15;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  // --- Stream management ---

  addStream(id: string, audioElement: HTMLAudioElement) {
    if (this.channels.has(id)) {
      this.removeStream(id);
    }

    const source = this.ctx.createMediaElementSource(audioElement);
    const merger = this.ctx.createChannelMerger(1);
    const monoOut = this.ctx.createGain();
    monoOut.gain.value = 1.0;

    source.connect(merger);
    merger.connect(monoOut);

    const streamGain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;
    streamGain.connect(panner);
    panner.connect(this.masterGain);

    // Build voice pool for this stream
    const voices: Voice[] = [];
    for (let i = 0; i < VOICES_PER_STREAM; i++) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 440;
      filter.Q.value = DEFAULT_Q;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      monoOut.connect(filter);
      filter.connect(gain);
      gain.connect(streamGain);

      voices.push({ note: -1, filter, gain, active: false });
    }

    // Fade in
    const now = this.ctx.currentTime;
    streamGain.gain.setValueAtTime(0, now);
    streamGain.gain.linearRampToValueAtTime(DEFAULT_VOL, now + FADE_TIME);

    this.channels.set(id, {
      source,
      streamGain,
      panner,
      audioElement,
      voices,
      activeVoices: new Map(),
      filterQ: DEFAULT_Q,
      volume: DEFAULT_VOL,
      octaveShift: 0,
      muted: false,
      pan: 0,
    });

    // Activate any currently held notes on the new stream
    for (const [, ch] of this.channels) {
      if (ch === this.channels.get(id)) continue;
      for (const [note] of ch.activeVoices) {
        this.noteOnForChannel(this.channels.get(id)!, note, 127);
      }
      break; // only need one existing channel to know which notes are held
    }
  }

  removeStream(id: string) {
    const ch = this.channels.get(id);
    if (!ch) return;

    const now = this.ctx.currentTime;
    ch.streamGain.gain.cancelScheduledValues(0);
    ch.streamGain.gain.setValueAtTime(ch.streamGain.gain.value, now);
    ch.streamGain.gain.linearRampToValueAtTime(0, now + FADE_TIME);

    setTimeout(() => {
      for (const voice of ch.voices) {
        try { voice.filter.disconnect(); } catch { /* ok */ }
        try { voice.gain.disconnect(); } catch { /* ok */ }
      }
      try { ch.source.disconnect(); } catch { /* ok */ }
      try { ch.streamGain.disconnect(); } catch { /* ok */ }
      try { ch.panner.disconnect(); } catch { /* ok */ }
      ch.audioElement.pause();
      ch.audioElement.src = '';
    }, FADE_TIME * 1000 + 100);

    this.channels.delete(id);
  }

  disconnectAllStreams() {
    for (const id of Array.from(this.channels.keys())) {
      this.removeStream(id);
    }
  }

  isStreamConnected(): boolean {
    return this.channels.size > 0;
  }

  getActiveStreamIds(): string[] {
    return Array.from(this.channels.keys());
  }

  // --- Note on/off (across all channels) ---

  private noteOnForChannel(ch: StreamChannel, note: number, velocity: number) {
    if (ch.activeVoices.has(note)) return;

    let voice = ch.voices.find(v => !v.active);
    if (!voice) {
      const oldest = ch.activeVoices.entries().next().value;
      if (oldest) {
        const [oldNote, oldVoice] = oldest;
        ch.activeVoices.delete(oldNote);
        voice = oldVoice;
      } else {
        return;
      }
    }

    const shiftedNote = note + ch.octaveShift * 12;
    const freq = noteToFreq(shiftedNote);
    const now = this.ctx.currentTime;
    const velGain = (velocity / 127) * VOICE_GAIN_BOOST;

    voice.note = note;
    voice.active = true;
    voice.filter.frequency.setTargetAtTime(freq, now, 0.001);
    voice.filter.Q.setTargetAtTime(ch.filterQ, now, 0.001);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(velGain, now, ATTACK);

    ch.activeVoices.set(note, voice);
  }

  noteOn(note: number, velocity: number = 127) {
    if (!this.isStreamConnected()) return;
    for (const [, ch] of this.channels) {
      this.noteOnForChannel(ch, note, velocity);
    }
  }

  private noteOffForChannel(ch: StreamChannel, note: number) {
    const voice = ch.activeVoices.get(note);
    if (!voice) return;

    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, RELEASE);
    voice.active = false;
    voice.note = -1;
    ch.activeVoices.delete(note);
  }

  noteOff(note: number) {
    for (const [, ch] of this.channels) {
      this.noteOffForChannel(ch, note);
    }
  }

  allNotesOff() {
    const now = this.ctx.currentTime;
    for (const [, ch] of this.channels) {
      for (const voice of ch.voices) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.01);
        voice.active = false;
        voice.note = -1;
      }
      ch.activeVoices.clear();
    }
  }

  // --- Per-stream controls ---

  setStreamFilterQ(id: string, q: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.filterQ = Math.max(1, Math.min(100, q));
    const now = this.ctx.currentTime;
    for (const voice of ch.voices) {
      voice.filter.Q.setTargetAtTime(ch.filterQ, now, 0.01);
    }
  }

  getStreamFilterQ(id: string): number {
    return this.channels.get(id)?.filterQ ?? DEFAULT_Q;
  }

  setStreamVolume(id: string, vol: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.volume = vol;
    this.applyGains();
  }

  getStreamVolume(id: string): number {
    return this.channels.get(id)?.volume ?? DEFAULT_VOL;
  }

  setStreamMuted(id: string, muted: boolean) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.muted = muted;
    this.applyGains();
  }

  getStreamMuted(id: string): boolean {
    return this.channels.get(id)?.muted ?? false;
  }

  private soloId: string | null = null;

  setStreamSolo(id: string | null) {
    this.soloId = id;
    this.applyGains();
  }

  getStreamSolo(): string | null {
    return this.soloId;
  }

  private applyGains() {
    const now = this.ctx.currentTime;
    for (const [id, ch] of this.channels) {
      const audible = this.soloId ? id === this.soloId : !ch.muted;
      ch.streamGain.gain.cancelScheduledValues(0);
      ch.streamGain.gain.setTargetAtTime(audible ? ch.volume : 0, now, 0.01);
    }
  }

  setStreamPan(id: string, pan: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.pan = Math.max(-1, Math.min(1, pan));
    ch.panner.pan.setTargetAtTime(ch.pan, this.ctx.currentTime, 0.01);
  }

  getStreamPan(id: string): number {
    return this.channels.get(id)?.pan ?? 0;
  }

  setStreamOctave(id: string, shift: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.octaveShift = shift;
    // Update frequencies of any currently active voices
    const now = this.ctx.currentTime;
    for (const [note, voice] of ch.activeVoices) {
      const freq = noteToFreq(note + ch.octaveShift * 12);
      voice.filter.frequency.setTargetAtTime(freq, now, 0.001);
    }
  }

  getStreamOctave(id: string): number {
    return this.channels.get(id)?.octaveShift ?? 0;
  }

  // --- Global controls (kept for backwards compat) ---

  setFilterQ(q: number) {
    for (const [id] of this.channels) {
      this.setStreamFilterQ(id, q);
    }
  }

  getFilterQ(): number {
    // Return first channel's Q or default
    const first = this.channels.values().next().value;
    return first ? first.filterQ : DEFAULT_Q;
  }

  setMasterVolume(vol: number) {
    this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
  }

  getActiveNotes(): number[] {
    // Collect from first channel (all channels have the same active notes)
    const first = this.channels.values().next().value;
    return first ? Array.from(first.activeVoices.keys()) : [];
  }

  setExternalClock(enabled: boolean) {
    this.externalClock = enabled;
  }

  getExternalClock() {
    return this.externalClock;
  }

  resume() {
    return this.ctx.resume();
  }
}

// Lazy init to avoid AudioContext crash during SSR
let _instance: AudioEngine;
export const audioEngine = new Proxy({} as AudioEngine, {
  get(_target, prop) {
    if (!_instance) _instance = new AudioEngine();
    const val = (_instance as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? val.bind(_instance) : val;
  },
});
