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
const DEFAULT_HIGH_PASS_FREQ = 20;
const DEFAULT_LOW_PASS_FREQ = 20000;
const ATTACK = 0.02;
const RELEASE = 0.3;
const FADE_TIME = 0.5;
const VOICE_GAIN_BOOST = 8.0;
const MIN_FILTER_FREQ = 20;
const KEEPALIVE_GAIN = 0.000001;
const KEEPALIVE_FREQ = 20;

interface Voice {
  note: number;
  filter: BiquadFilterNode;
  gain: GainNode;
  active: boolean;
}

interface NoteSourceState {
  count: number;
  velocity: number;
}

interface ActiveNoteState {
  sources: Map<string, NoteSourceState>;
}

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

interface StreamChannel {
  source: MediaElementAudioSourceNode;
  streamGain: GainNode;
  highPassFilter: BiquadFilterNode;
  lowPassFilter: BiquadFilterNode;
  analyser: AnalyserNode;
  panner: StereoPannerNode;
  audioElement: HTMLAudioElement;
  voices: Voice[];
  activeVoices: Map<number, Voice>;
  filterQ: number;
  volume: number;
  highPassFreq: number;
  lowPassFreq: number;
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
  private activeNotes: Map<number, ActiveNoteState> = new Map();
  private externalClock = false;
  private pitchBendSemitones = 0;
  private keepAliveOscillator: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;

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

  private ensureKeepAlive() {
    if (this.keepAliveOscillator) return;

    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = KEEPALIVE_FREQ;
    gain.gain.value = KEEPALIVE_GAIN;
    oscillator.connect(gain);
    gain.connect(this.ctx.destination);
    oscillator.start();

    this.keepAliveOscillator = oscillator;
    this.keepAliveGain = gain;
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
    const highPassFilter = this.ctx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = DEFAULT_HIGH_PASS_FREQ;
    highPassFilter.Q.value = 0.707;
    const lowPassFilter = this.ctx.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = this.clampLowPassFrequency(DEFAULT_LOW_PASS_FREQ);
    lowPassFilter.Q.value = 0.707;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;
    streamGain.connect(highPassFilter);
    highPassFilter.connect(lowPassFilter);
    lowPassFilter.connect(analyser);
    analyser.connect(panner);
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
      highPassFilter,
      lowPassFilter,
      analyser,
      panner,
      audioElement,
      voices,
      activeVoices: new Map(),
      filterQ: DEFAULT_Q,
      volume: DEFAULT_VOL,
      highPassFreq: DEFAULT_HIGH_PASS_FREQ,
      lowPassFreq: DEFAULT_LOW_PASS_FREQ,
      octaveShift: 0,
      muted: false,
      pan: 0,
    });

    // Activate any currently held notes on the new stream.
    const newChannel = this.channels.get(id);
    if (newChannel) {
      for (const note of this.activeNotes.keys()) {
        this.noteOnForChannel(newChannel, note, this.getEffectiveVelocity(note));
      }
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
      try { ch.highPassFilter.disconnect(); } catch { /* ok */ }
      try { ch.lowPassFilter.disconnect(); } catch { /* ok */ }
      try { ch.analyser.disconnect(); } catch { /* ok */ }
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

  private velocityToGain(velocity: number): number {
    return (Math.max(0, velocity) / 127) * VOICE_GAIN_BOOST;
  }

  private getEffectiveVelocity(note: number): number {
    const noteState = this.activeNotes.get(note);
    if (!noteState) return 0;

    let maxVelocity = 0;
    for (const sourceState of noteState.sources.values()) {
      if (sourceState.velocity > maxVelocity) {
        maxVelocity = sourceState.velocity;
      }
    }

    return maxVelocity;
  }

  private refreshNoteGain(note: number) {
    const now = this.ctx.currentTime;
    const nextGain = this.velocityToGain(this.getEffectiveVelocity(note));

    for (const [, ch] of this.channels) {
      const voice = ch.activeVoices.get(note);
      if (!voice) continue;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(nextGain, now, ATTACK);
    }
  }

  private clampFilterFrequency(freq: number): number {
    const maxFrequency = Math.max(MIN_FILTER_FREQ, Math.min(20000, this.ctx.sampleRate / 2 - 1));
    return Number.isFinite(freq) ? Math.max(MIN_FILTER_FREQ, Math.min(maxFrequency, freq)) : 440;
  }

  private getVoiceFrequency(ch: StreamChannel, note: number): number {
    return this.clampFilterFrequency(noteToFreq(note + ch.octaveShift * 12 + this.pitchBendSemitones));
  }

  private retuneActiveVoices(timeConstant = 0.005) {
    const now = this.ctx.currentTime;
    for (const [, ch] of this.channels) {
      for (const [note, voice] of ch.activeVoices) {
        voice.filter.frequency.setTargetAtTime(this.getVoiceFrequency(ch, note), now, timeConstant);
      }
    }
  }

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

    const freq = this.getVoiceFrequency(ch, note);
    const now = this.ctx.currentTime;
    const velGain = this.velocityToGain(velocity);

    voice.note = note;
    voice.active = true;
    voice.filter.frequency.setTargetAtTime(freq, now, 0.001);
    voice.filter.Q.setTargetAtTime(ch.filterQ, now, 0.001);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(velGain, now, ATTACK);

    ch.activeVoices.set(note, voice);
  }

  noteOn(note: number, velocity: number = 127, source: string = 'default'): boolean {
    if (!this.isStreamConnected()) return false;

    void this.resume().catch(() => undefined);

    const noteState = this.activeNotes.get(note) ?? { sources: new Map<string, NoteSourceState>() };
    const sourceState = noteState.sources.get(source);

    if (sourceState) {
      sourceState.count += 1;
      sourceState.velocity = Math.max(sourceState.velocity, velocity);
    } else {
      noteState.sources.set(source, { count: 1, velocity });
    }

    const wasActive = this.activeNotes.has(note);
    this.activeNotes.set(note, noteState);

    if (wasActive) {
      this.refreshNoteGain(note);
      return true;
    }

    for (const [, ch] of this.channels) {
      this.noteOnForChannel(ch, note, velocity);
    }

    return true;
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

  noteOff(note: number, source: string = 'default') {
    const noteState = this.activeNotes.get(note);
    const sourceState = noteState?.sources.get(source);
    if (!noteState || !sourceState) return;

    if (sourceState.count > 1) {
      sourceState.count -= 1;
      return;
    }

    noteState.sources.delete(source);
    if (noteState.sources.size > 0) {
      this.refreshNoteGain(note);
      return;
    }

    this.activeNotes.delete(note);
    for (const [, ch] of this.channels) {
      this.noteOffForChannel(ch, note);
    }
  }

  updateNoteSourceVelocity(note: number, velocity: number, source: string = 'default') {
    const noteState = this.activeNotes.get(note);
    const sourceState = noteState?.sources.get(source);
    if (!noteState || !sourceState) return;

    sourceState.velocity = velocity;
    this.refreshNoteGain(note);
  }

  allNotesOff(source?: string) {
    if (source) {
      for (const [note, noteState] of Array.from(this.activeNotes.entries())) {
        if (!noteState.sources.has(source)) continue;

        noteState.sources.delete(source);
        if (noteState.sources.size === 0) {
          this.activeNotes.delete(note);
          for (const [, ch] of this.channels) {
            this.noteOffForChannel(ch, note);
          }
        } else {
          this.refreshNoteGain(note);
        }
      }
      return;
    }

    this.activeNotes.clear();
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

  private clampHighPassFrequency(freq: number): number {
    const maxFrequency = Math.max(MIN_FILTER_FREQ, Math.min(20000, this.ctx.sampleRate / 2 - 1));
    return Number.isFinite(freq) ? Math.max(MIN_FILTER_FREQ, Math.min(maxFrequency, freq)) : DEFAULT_HIGH_PASS_FREQ;
  }

  private clampLowPassFrequency(freq: number): number {
    const maxFrequency = Math.max(MIN_FILTER_FREQ, Math.min(20000, this.ctx.sampleRate / 2 - 1));
    return Number.isFinite(freq) ? Math.max(MIN_FILTER_FREQ, Math.min(maxFrequency, freq)) : DEFAULT_LOW_PASS_FREQ;
  }

  setStreamHighPass(id: string, freq: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.highPassFreq = this.clampHighPassFrequency(freq);
    ch.highPassFilter.frequency.setTargetAtTime(ch.highPassFreq, this.ctx.currentTime, 0.01);
  }

  getStreamHighPass(id: string): number {
    return this.channels.get(id)?.highPassFreq ?? DEFAULT_HIGH_PASS_FREQ;
  }

  setStreamLowPass(id: string, freq: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.lowPassFreq = this.clampLowPassFrequency(freq);
    ch.lowPassFilter.frequency.setTargetAtTime(ch.lowPassFreq, this.ctx.currentTime, 0.01);
  }

  getStreamLowPass(id: string): number {
    return this.channels.get(id)?.lowPassFreq ?? DEFAULT_LOW_PASS_FREQ;
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

  getStreamAnalyser(id: string): AnalyserNode | null {
    return this.channels.get(id)?.analyser ?? null;
  }

  setStreamOctave(id: string, shift: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.octaveShift = shift;
    this.retuneActiveVoices(0.001);
  }

  getStreamOctave(id: string): number {
    return this.channels.get(id)?.octaveShift ?? 0;
  }

  setPitchBendSemitones(semitones: number) {
    this.pitchBendSemitones = Number.isFinite(semitones) ? Math.max(-24, Math.min(24, semitones)) : 0;
    this.retuneActiveVoices(0.005);
  }

  getPitchBendSemitones(): number {
    return this.pitchBendSemitones;
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
    const safeVolume = Number.isFinite(vol) ? Math.max(0, vol) : 0.8;
    this.masterGain.gain.setTargetAtTime(safeVolume, this.ctx.currentTime, 0.01);
  }

  getMasterVolume(): number {
    return this.masterGain.gain.value;
  }

  getActiveNotes(): number[] {
    return Array.from(this.activeNotes.keys());
  }

  setExternalClock(enabled: boolean) {
    this.externalClock = enabled;
  }

  getExternalClock() {
    return this.externalClock;
  }

  resume() {
    this.ensureKeepAlive();
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
