import { createSourceLevelState, updateSourceLevel, type SourceLevelState } from './sourceLeveling';
import { estimateResonanceLevelMatch, type ResonanceBand } from './resonanceLevelMatch';
import { createAudioOutputRouter } from "./audioOutputRouter";
/**
 * Resonant Filter Instrument Engine
 *
 * Each stream gets its own bank of resonant bandpass filters with independent
 * volume controls and shared global Q (resonance). Notes activate across all streams.
 *
 * Signal chain per stream:
 *   audioElement → mono → filter(bandpass, Q) → voiceGain → levelMatch → sourceLevelGain → streamGain → EQ → limiter → masterGain → ...
 *
 * Master chain:
 *   masterGain → compressor → analyser → destination
 */

import {
  type AudioOutputChannel,
} from './audioOutput';

const VOICES_PER_STREAM = 16;
const DEFAULT_Q = 30;
const DEFAULT_VOL = 0.8;
const DEFAULT_HIGH_PASS_FREQ = 20;
const DEFAULT_LOW_PASS_FREQ = 20000;
const ATTACK = 0.02;
const RELEASE = 0.3;
// Exponential time constants: ~5 ms to full level, then silent within 20 ms.
const TIGHT_ATTACK = 0.001;
const TIGHT_RELEASE = 0.003;
const TIGHT_RELEASE_END = 0.02;
const FADE_TIME = 0.5;
const VOICE_GAIN_BOOST = 8.0;
const TRACK_LIMITER_THRESHOLD_DB = -10;
const TRACK_LIMITER_KNEE_DB = 5;
const TRACK_LIMITER_RATIO = 12;
const TRACK_LIMITER_ATTACK_SECONDS = 0.003;
const TRACK_LIMITER_RELEASE_SECONDS = 0.2;
const MIN_FILTER_FREQ = 20;
const KEEPALIVE_GAIN = 0.000001;
const KEEPALIVE_FREQ = 20;
const ANALYSIS_FFT_SIZE = 8192;
const ANALYSIS_REFRESH_INTERVAL = 0.075;
const ANALYSIS_TIMER_MS = 80;
const SPECTRAL_SNAP_MIN_FREQ = 55;
const SPECTRAL_SNAP_MAX_FREQ = 5000;
const SPECTRAL_SNAP_MAX_DISTANCE_CENTS = 350;
const SPECTRAL_SNAP_TRACK_DISTANCE_CENTS = 90;
const SPECTRAL_SNAP_MIN_LEVEL_DB = -86;
const SPECTRAL_SNAP_NOISE_MARGIN_DB = 6;
const SPECTRAL_SNAP_MIN_PROMINENCE_DB = 3;
const SPECTRAL_SNAP_TOP_COUNT = 36;
const SPECTRAL_SNAP_MAX_MISSES = 2;
const HARMONIC_EVIDENCE_MAX_HARMONIC = 8;
const HARMONIC_EVIDENCE_MAX_FREQ = 5000;
const HARMONIC_EVIDENCE_PROMINENCE_FLOOR_DB = 1.5;
const HARMONIC_EVIDENCE_FULL_SCALE_DB = 12;
const HARMONIC_EVIDENCE_OUTPUT_SCALE = 0.65;
const HARMONIC_EVIDENCE_MIN_GAIN = 0.4;
const HARMONIC_EVIDENCE_COLOR_TILT = 0.85;

interface HarmonicEvidenceResponseValues {
  smoothing: number;
  bandTimeConstant: number;
  gainTimeConstant: number;
}

export type ToneMode = 'bands' | 'spectral-snap' | 'harmonic-evidence';

interface SpectralSnapPeak {
  frequency: number;
  levelDb: number;
  prominenceDb: number;
  age: number;
  misses: number;
}

interface HarmonicBand {
  harmonic: number;
  input: AudioNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  connected: boolean;
  connectionToken: number;
  targetGain: number;
}

interface Voice {
  tight: boolean;
  note: number;
  filter: BiquadFilterNode;
  gain: GainNode;
  levelReferenceGain: GainNode;
  active: boolean;
  targetFrequency: number;
  snappedFrequency: number | null;
  harmonicEvidence: number;
  harmonicBands: HarmonicBand[];
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
  levelMatchGain: GainNode;
  levelMatch: boolean;
  levelMatchReferenceQ: number;
  levelMatchPending: boolean;
  levelMatchQueued: boolean;
  sourceLevelGain: GainNode;
  sourceLevelState: SourceLevelState;
  sourceLevelSamples: Float32Array<ArrayBuffer>;
  sourceLevelUpdatedAt: number;
  sourceLevelAnalyser: AnalyserNode;
  sourceLevelHighPass: BiquadFilterNode;
  sourceLevelLowPass: BiquadFilterNode;
  rawAnalyser: AnalyserNode;
  analysisBins: Float32Array<ArrayBuffer>;
  analysisUpdatedAt: number;
  spectralSnapPeaks: SpectralSnapPeak[];
  highPassFilter: BiquadFilterNode;
  lowPassFilter: BiquadFilterNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
  panner: StereoPannerNode;
  audioElement: HTMLAudioElement;
  voices: Voice[];
  activeVoices: Map<number, Voice>;
  rendering: boolean;
  filterQ: number;
  volume: number;
  highPassFreq: number;
  lowPassFreq: number;
  octaveShift: number;
  muted: boolean;
  pan: number;
}

interface RemoveStreamOptions {
  preserveSolo?: boolean;
}

export class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  private outputRouter: ReturnType<typeof createAudioOutputRouter>;

  private channels: Map<string, StreamChannel> = new Map();
  private filterQ = DEFAULT_Q;
  private activeNotes: Map<number, ActiveNoteState> = new Map();
  private externalClock = false;
  private chordPadTight = false;
  private pitchBendSemitones = 0;
  private toneMode: ToneMode = 'harmonic-evidence';
  private harmonicEvidenceAmount = 1;
  private harmonicEvidenceColor = 0;
  private harmonicEvidenceResponse = 0.5;
  private analysisTimer: number | null = null;
  private sourceLevelTimer: number | null = null;
  private sourceLevelBackgroundIndex = 0;
  private sourceLevelBackground: StreamChannel | null = null;
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
    this.outputRouter = createAudioOutputRouter(this.ctx);

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.outputRouter.input);
    let lastContextState = this.ctx.state;
    this.ctx.addEventListener('statechange', () => {
      if (this.ctx.state === lastContextState) return;
      lastContextState = this.ctx.state;
      if (lastContextState !== 'running') console.warn('[Cicada audio context]', lastContextState);
    });
  }

  setOutputDevice(deviceId: string, channel?: AudioOutputChannel) {
    return this.outputRouter.setDevice(deviceId, channel);
  }

  setOutputChannel(channel: AudioOutputChannel) {
    this.outputRouter.setChannel(channel);
  }

  private ensureKeepAlive() {
    if (this.keepAliveOscillator) return;

    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = KEEPALIVE_FREQ;
    gain.gain.value = KEEPALIVE_GAIN;
    oscillator.connect(gain);
    gain.connect(this.outputRouter.input);
    oscillator.start();

    this.keepAliveOscillator = oscillator;
    this.keepAliveGain = gain;
  }

  // --- Stream management ---

  addStream(id: string, audioElement: HTMLAudioElement) {
    if (this.channels.has(id)) {
      this.removeStream(id, { preserveSolo: true });
    }

    const source = this.ctx.createMediaElementSource(audioElement);
    const merger = this.ctx.createChannelMerger(1);
    const monoOut = this.ctx.createGain();
    monoOut.gain.value = 1.0;

    source.connect(merger);
    merger.connect(monoOut);

    const streamGain = this.ctx.createGain();
    const levelMatchGain = this.ctx.createGain();
    const sourceLevelGain = this.ctx.createGain();
    levelMatchGain.connect(sourceLevelGain);
    sourceLevelGain.connect(streamGain);
    const rawAnalyser = this.ctx.createAnalyser();
    rawAnalyser.fftSize = ANALYSIS_FFT_SIZE;
    rawAnalyser.smoothingTimeConstant = 0.55;
    rawAnalyser.minDecibels = -100;
    rawAnalyser.maxDecibels = -10;
    monoOut.connect(rawAnalyser);
    // A measurement-only mix uses the same resonators/harmonics as the sound,
    // but excludes note velocity, envelopes, source gates and performance faders.
    // It never connects to the speakers or feeds the automatic gain back into itself.
    const sourceLevelHighPass = this.ctx.createBiquadFilter();
    sourceLevelHighPass.type = 'highpass';
    sourceLevelHighPass.frequency.value = DEFAULT_HIGH_PASS_FREQ;
    sourceLevelHighPass.Q.value = 0.707;
    const sourceLevelLowPass = this.ctx.createBiquadFilter();
    sourceLevelLowPass.type = 'lowpass';
    sourceLevelLowPass.frequency.value = this.clampLowPassFrequency(DEFAULT_LOW_PASS_FREQ);
    sourceLevelLowPass.Q.value = 0.707;
    const sourceLevelAnalyser = this.ctx.createAnalyser();
    sourceLevelAnalyser.fftSize = 8192;
    sourceLevelHighPass.connect(sourceLevelLowPass);
    sourceLevelLowPass.connect(sourceLevelAnalyser);

    const highPassFilter = this.ctx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = DEFAULT_HIGH_PASS_FREQ;
    highPassFilter.Q.value = 0.707;
    const lowPassFilter = this.ctx.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = this.clampLowPassFrequency(DEFAULT_LOW_PASS_FREQ);
    lowPassFilter.Q.value = 0.707;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = TRACK_LIMITER_THRESHOLD_DB;
    limiter.knee.value = TRACK_LIMITER_KNEE_DB;
    limiter.ratio.value = TRACK_LIMITER_RATIO;
    limiter.attack.value = TRACK_LIMITER_ATTACK_SECONDS;
    limiter.release.value = TRACK_LIMITER_RELEASE_SECONDS;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;
    streamGain.connect(highPassFilter);
    highPassFilter.connect(lowPassFilter);
    lowPassFilter.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(panner);
    panner.connect(this.masterGain);

    // Build voice pool for this stream
    const voices: Voice[] = [];
    for (let i = 0; i < VOICES_PER_STREAM; i++) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 440;
      filter.Q.value = this.filterQ;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      const levelReferenceGain = this.ctx.createGain();
      levelReferenceGain.gain.value = 0;
      filter.connect(levelReferenceGain);
      levelReferenceGain.connect(sourceLevelHighPass);
      monoOut.connect(filter);
      filter.connect(gain);
      gain.connect(levelMatchGain);

      const harmonicBands: HarmonicBand[] = [];
      for (let harmonic = 2; harmonic <= HARMONIC_EVIDENCE_MAX_HARMONIC; harmonic++) {
        const harmonicFilter = this.ctx.createBiquadFilter();
        harmonicFilter.type = 'bandpass';
        harmonicFilter.frequency.value = 440 * harmonic;
        harmonicFilter.Q.value = this.filterQ;

        const harmonicGain = this.ctx.createGain();
        harmonicGain.gain.value = 0;

        harmonicFilter.connect(harmonicGain);
        harmonicGain.connect(gain);
        harmonicGain.connect(levelReferenceGain);
        harmonicBands.push({
          harmonic,
          input: monoOut,
          filter: harmonicFilter,
          gain: harmonicGain,
          connected: false,
          connectionToken: 0,
          targetGain: 0,
        });
      }

      voices.push({
        tight: false,
        note: -1,
        filter,
        gain,
        levelReferenceGain,
        active: false,
        targetFrequency: 440,
        snappedFrequency: null,
        harmonicEvidence: 0,
        harmonicBands,
      });
    }

    // Fade in
    const now = this.ctx.currentTime;
    streamGain.gain.setValueAtTime(0, now);
    streamGain.gain.linearRampToValueAtTime(DEFAULT_VOL, now + FADE_TIME);

    this.channels.set(id, {
      source,
      streamGain,
      levelMatchGain,
      levelMatch: true,
      levelMatchReferenceQ: this.filterQ,
      levelMatchPending: false,
      levelMatchQueued: false,
      sourceLevelGain,
      sourceLevelState: createSourceLevelState(),
      sourceLevelSamples: new Float32Array(8192),
      sourceLevelAnalyser,
      sourceLevelHighPass,
      sourceLevelLowPass,
      sourceLevelUpdatedAt: now,
      rawAnalyser,
      analysisBins: new Float32Array(rawAnalyser.frequencyBinCount),
      analysisUpdatedAt: Number.NEGATIVE_INFINITY,
      spectralSnapPeaks: [],
      highPassFilter,
      lowPassFilter,
      limiter,
      analyser,
      panner,
      audioElement,
      voices,
      activeVoices: new Map(),
      rendering: true,
      filterQ: this.filterQ,
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

    this.syncChannelRendering();

    // A newly added channel must immediately respect any existing solo/mute
    // routing instead of becoming briefly audible at its default gain.
    this.applyGains();
  }

  removeStream(id: string, { preserveSolo = false }: RemoveStreamOptions = {}) {
    const ch = this.channels.get(id);
    if (!ch) {
      if (!preserveSolo && this.soloId === id) {
        this.soloId = null;
        this.applyGains();
      }
      return;
    }

    const now = this.ctx.currentTime;
    ch.streamGain.gain.cancelScheduledValues(0);
    ch.streamGain.gain.setValueAtTime(ch.streamGain.gain.value, now);
    ch.streamGain.gain.linearRampToValueAtTime(0, now + FADE_TIME);

    setTimeout(() => {
      for (const voice of ch.voices) {
        try { voice.filter.disconnect(); } catch { /* ok */ }
        for (const band of voice.harmonicBands) {
          band.connectionToken += 1;
          if (band.connected) {
            try { band.input.disconnect(band.filter); } catch { /* ok */ }
            band.connected = false;
          }
          try { band.filter.disconnect(); } catch { /* ok */ }
          try { band.gain.disconnect(); } catch { /* ok */ }
        }
        try { voice.levelReferenceGain.disconnect(); } catch { /* ok */ }
        try { voice.gain.disconnect(); } catch { /* ok */ }
      }
      try { ch.source.disconnect(); } catch { /* ok */ }
      try { ch.sourceLevelAnalyser.disconnect(); } catch { /* ok */ }
      try { ch.sourceLevelHighPass.disconnect(); } catch { /* ok */ }
      try { ch.sourceLevelLowPass.disconnect(); } catch { /* ok */ }
      try { ch.sourceLevelGain.disconnect(); } catch { /* ok */ }
      try { ch.rawAnalyser.disconnect(); } catch { /* ok */ }
      try { ch.levelMatchGain.disconnect(); } catch { /* ok */ }
      try { ch.streamGain.disconnect(); } catch { /* ok */ }
      try { ch.highPassFilter.disconnect(); } catch { /* ok */ }
      try { ch.lowPassFilter.disconnect(); } catch { /* ok */ }
      try { ch.limiter.disconnect(); } catch { /* ok */ }
      try { ch.analyser.disconnect(); } catch { /* ok */ }
      try { ch.panner.disconnect(); } catch { /* ok */ }
      ch.audioElement.pause();
      ch.audioElement.src = '';
    }, FADE_TIME * 1000 + 100);

    this.channels.delete(id);

    const removedSoloChannel = this.soloId === id;
    if (removedSoloChannel && !preserveSolo) {
      this.soloId = null;
    }

    // Keep the remaining gains frozen only while the soloed stream is being
    // replaced during a reconnect. Permanent removal releases the solo.
    if (!removedSoloChannel || !preserveSolo) {
      this.applyGains();
    }
  }

  disconnectAllStreams() {
    for (const id of Array.from(this.channels.keys())) {
      this.removeStream(id);
    }
    this.setStreamSolo(null);
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

  private getVoiceOutputGain(voice: Voice, velocity: number): number {
    const baseGain = this.velocityToGain(velocity);
    if (this.toneMode !== 'harmonic-evidence') return baseGain;

    const evidenceGain = HARMONIC_EVIDENCE_MIN_GAIN
      + (1 - HARMONIC_EVIDENCE_MIN_GAIN) * Math.sqrt(Math.max(0, Math.min(1, voice.harmonicEvidence)));
    const currentEffectGain = HARMONIC_EVIDENCE_OUTPUT_SCALE * evidenceGain;
    const amountGain = Math.max(
      0,
      1 + (currentEffectGain - 1) * this.harmonicEvidenceAmount,
    );
    return baseGain * amountGain;
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

  setChordPadTight(enabled: boolean) {
    this.chordPadTight = enabled;
    for (const ch of this.channels.values()) {
      for (const [note, voice] of ch.activeVoices) {
        voice.tight = this.isTightNote(note);
      }
    }
  }

  private isTightNote(note: number): boolean {
    return this.chordPadTight && Boolean(this.activeNotes.get(note)?.sources.has('chord-pad'));
  }

  private refreshNoteGain(note: number) {
    const now = this.ctx.currentTime;
    const velocity = this.getEffectiveVelocity(note);

    for (const [, ch] of this.channels) {
      const voice = ch.activeVoices.get(note);
      if (!voice) continue;
      voice.tight = this.isTightNote(note);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(this.getVoiceOutputGain(voice, velocity), now, voice.tight ? TIGHT_ATTACK : ATTACK);
    }
  }

  private clampFilterFrequency(freq: number): number {
    const maxFrequency = Math.max(MIN_FILTER_FREQ, Math.min(20000, this.ctx.sampleRate / 2 - 1));
    return Number.isFinite(freq) ? Math.max(MIN_FILTER_FREQ, Math.min(maxFrequency, freq)) : 440;
  }

  private centsBetween(a: number, b: number): number {
    if (a <= 0 || b <= 0) return Infinity;
    return Math.abs(1200 * Math.log2(a / b));
  }

  private interpolateFrequency(from: number, to: number, amount: number): number {
    if (from <= 0 || to <= 0) return to;
    return from * Math.pow(to / from, amount);
  }

  private refreshAnalysisBins(ch: StreamChannel): boolean {
    const now = this.ctx.currentTime;
    if (now - ch.analysisUpdatedAt < ANALYSIS_REFRESH_INTERVAL) return false;

    ch.rawAnalyser.getFloatFrequencyData(ch.analysisBins);
    ch.analysisUpdatedAt = now;
    return true;
  }

  private refreshSpectralSnapPeaks(ch: StreamChannel) {
    if (!this.refreshAnalysisBins(ch)) return;

    const binHz = this.ctx.sampleRate / ch.rawAnalyser.fftSize;
    const minBin = Math.max(2, Math.ceil(SPECTRAL_SNAP_MIN_FREQ / binHz));
    const maxBin = Math.min(ch.analysisBins.length - 3, Math.floor(SPECTRAL_SNAP_MAX_FREQ / binHz));
    const finiteLevels: number[] = [];

    for (let bin = minBin; bin <= maxBin; bin++) {
      const level = ch.analysisBins[bin];
      if (Number.isFinite(level)) finiteLevels.push(level);
    }

    finiteLevels.sort((a, b) => a - b);
    const noiseFloor = finiteLevels.length > 0
      ? finiteLevels[Math.floor(finiteLevels.length * 0.5)]
      : -100;
    const minimumLevel = Math.max(SPECTRAL_SNAP_MIN_LEVEL_DB, noiseFloor + SPECTRAL_SNAP_NOISE_MARGIN_DB);
    const candidates: SpectralSnapPeak[] = [];

    for (let bin = minBin; bin <= maxBin; bin++) {
      const left = ch.analysisBins[bin - 1];
      const center = ch.analysisBins[bin];
      const right = ch.analysisBins[bin + 1];
      if (!Number.isFinite(center) || center < minimumLevel) continue;
      if (center <= left || center < right) continue;

      const shoulderLevels = [
        ch.analysisBins[bin - 4],
        ch.analysisBins[bin - 3],
        ch.analysisBins[bin + 3],
        ch.analysisBins[bin + 4],
      ].filter(Number.isFinite);
      const localFloor = shoulderLevels.length > 0
        ? shoulderLevels.reduce((sum, level) => sum + level, 0) / shoulderLevels.length
        : noiseFloor;
      const prominenceDb = center - localFloor;
      if (prominenceDb < SPECTRAL_SNAP_MIN_PROMINENCE_DB) continue;

      const denominator = left - 2 * center + right;
      const offset = Math.abs(denominator) > 0.0001
        ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator))
        : 0;

      candidates.push({
        frequency: (bin + offset) * binHz,
        levelDb: center,
        prominenceDb,
        age: 1,
        misses: 0,
      });
    }

    candidates.sort((a, b) => (
      b.levelDb + b.prominenceDb * 0.75 - (a.levelDb + a.prominenceDb * 0.75)
    ));

    const previous = ch.spectralSnapPeaks;
    const usedPrevious = new Set<number>();
    const tracked: SpectralSnapPeak[] = [];

    for (const candidate of candidates.slice(0, SPECTRAL_SNAP_TOP_COUNT * 2)) {
      let matchIndex = -1;
      let matchDistance = SPECTRAL_SNAP_TRACK_DISTANCE_CENTS;

      for (let index = 0; index < previous.length; index++) {
        if (usedPrevious.has(index)) continue;
        const distance = this.centsBetween(candidate.frequency, previous[index].frequency);
        if (distance < matchDistance) {
          matchIndex = index;
          matchDistance = distance;
        }
      }

      if (matchIndex >= 0) {
        const match = previous[matchIndex];
        usedPrevious.add(matchIndex);
        tracked.push({
          frequency: this.interpolateFrequency(match.frequency, candidate.frequency, 0.4),
          levelDb: match.levelDb * 0.55 + candidate.levelDb * 0.45,
          prominenceDb: match.prominenceDb * 0.55 + candidate.prominenceDb * 0.45,
          age: Math.min(match.age + 1, 1000),
          misses: 0,
        });
      } else {
        tracked.push(candidate);
      }
    }

    for (let index = 0; index < previous.length; index++) {
      if (usedPrevious.has(index)) continue;
      const peak = previous[index];
      if (peak.misses >= SPECTRAL_SNAP_MAX_MISSES) continue;
      tracked.push({
        ...peak,
        levelDb: peak.levelDb - 3,
        prominenceDb: peak.prominenceDb * 0.75,
        misses: peak.misses + 1,
      });
    }

    ch.spectralSnapPeaks = tracked
      .sort((a, b) => (
        b.levelDb + b.prominenceDb + Math.min(b.age, 6) * 1.5
        - (a.levelDb + a.prominenceDb + Math.min(a.age, 6) * 1.5)
      ))
      .slice(0, SPECTRAL_SNAP_TOP_COUNT);
  }

  private updateSpectralSnapVoicesForChannel(
    ch: StreamChannel,
    timeConstant = 0.05,
    includeBackground = false,
  ) {
    if ((!includeBackground && !this.shouldAnalyzeChannel(ch)) || this.toneMode !== 'spectral-snap' || ch.activeVoices.size === 0) return;

    this.refreshSpectralSnapPeaks(ch);
    const voices = Array.from(ch.activeVoices.values());
    const pairs: Array<{ voiceIndex: number; peakIndex: number; cost: number }> = [];

    for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
      const voice = voices[voiceIndex];
      for (let peakIndex = 0; peakIndex < ch.spectralSnapPeaks.length; peakIndex++) {
        const peak = ch.spectralSnapPeaks[peakIndex];
        const targetDistance = this.centsBetween(peak.frequency, voice.targetFrequency);
        if (targetDistance > SPECTRAL_SNAP_MAX_DISTANCE_CENTS) continue;

        const switchDistance = voice.snappedFrequency
          ? Math.min(this.centsBetween(peak.frequency, voice.snappedFrequency), 300)
          : 0;
        const stabilityBonus = Math.min(peak.age, 6) * 8;
        const prominenceBonus = Math.min(peak.prominenceDb, 18) * 2;
        const levelBonus = Math.max(0, Math.min(peak.levelDb - SPECTRAL_SNAP_MIN_LEVEL_DB, 36)) * 0.4;

        pairs.push({
          voiceIndex,
          peakIndex,
          cost: targetDistance + switchDistance * 0.35 - stabilityBonus - prominenceBonus - levelBonus,
        });
      }
    }

    pairs.sort((a, b) => a.cost - b.cost);
    const assignedVoices = new Set<number>();
    const assignedPeaks = new Set<number>();
    const assignments = new Map<number, number>();

    for (const pair of pairs) {
      if (assignedVoices.has(pair.voiceIndex) || assignedPeaks.has(pair.peakIndex)) continue;
      assignedVoices.add(pair.voiceIndex);
      assignedPeaks.add(pair.peakIndex);
      assignments.set(pair.voiceIndex, pair.peakIndex);
    }

    const now = this.ctx.currentTime;
    voices.forEach((voice, voiceIndex) => {
      const peakIndex = assignments.get(voiceIndex);
      const peak = peakIndex === undefined ? null : ch.spectralSnapPeaks[peakIndex];
      const nextFrequency = peak?.frequency ?? voice.targetFrequency;
      voice.snappedFrequency = peak?.frequency ?? null;
      voice.filter.frequency.setTargetAtTime(
        this.clampFilterFrequency(nextFrequency),
        now,
        timeConstant,
      );
    });
  }

  private updateSpectralSnapVoices() {
    if (this.toneMode !== 'spectral-snap') return;
    for (const [, ch] of this.channels) {
      this.updateSpectralSnapVoicesForChannel(ch, 0.05);
    }
  }

  private measureHarmonicAtFrequency(
    ch: StreamChannel,
    frequency: number,
  ): number {
    const binHz = this.ctx.sampleRate / ch.rawAnalyser.fftSize;
    const centerBin = Math.round(frequency / binHz);
    if (centerBin < 3 || centerBin >= ch.analysisBins.length - 3) return 0;

    let peakDb = Number.NEGATIVE_INFINITY;
    for (let offset = -1; offset <= 1; offset++) {
      const level = ch.analysisBins[centerBin + offset];
      if (Number.isFinite(level)) peakDb = Math.max(peakDb, level);
    }
    if (!Number.isFinite(peakDb)) return 0;

    const radius = Math.max(6, Math.min(48, Math.round(centerBin * 0.06)));
    let localTotal = 0;
    let localCount = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      if (Math.abs(offset) <= 2) continue;
      const bin = centerBin + offset;
      if (bin < 0 || bin >= ch.analysisBins.length) continue;
      const level = ch.analysisBins[bin];
      if (!Number.isFinite(level)) continue;
      localTotal += level;
      localCount += 1;
    }
    if (localCount === 0) return 0;

    // Local spectral flattening: measure the narrow peak above its broader
    // neighborhood so bass-heavy or hissy streams do not win by default.
    const prominenceDb = peakDb - localTotal / localCount;
    return Math.max(0, Math.min(
      1,
      (prominenceDb - HARMONIC_EVIDENCE_PROMINENCE_FLOOR_DB) / HARMONIC_EVIDENCE_FULL_SCALE_DB,
    ));
  }

  private measureHarmonicEvidence(
    ch: StreamChannel,
    targetFrequency: number,
  ): { score: number; strengths: Map<number, number> } {
    const strengths = new Map<number, number>();
    let weightedEvidence = 0;
    let totalWeight = 0;

    for (let harmonic = 1; harmonic <= HARMONIC_EVIDENCE_MAX_HARMONIC; harmonic++) {
      const frequency = targetFrequency * harmonic;
      if (frequency > HARMONIC_EVIDENCE_MAX_FREQ || frequency >= this.ctx.sampleRate / 2) break;

      const strength = this.measureHarmonicAtFrequency(ch, frequency);
      const weight = 1 / harmonic;
      strengths.set(harmonic, strength);
      weightedEvidence += strength * weight;
      totalWeight += weight;
    }

    return {
      score: totalWeight > 0 ? weightedEvidence / totalWeight : 0,
      strengths,
    };
  }

  private configureHarmonicBands(
    voice: Voice,
    enabled: boolean,
    strengths: Map<number, number> | null = null,
    timeConstant = 0.04,
  ) {
    const now = this.ctx.currentTime;
    const maxFrequency = Math.min(HARMONIC_EVIDENCE_MAX_FREQ, this.ctx.sampleRate / 2 - 1);

    for (const band of voice.harmonicBands) {
      const frequency = voice.targetFrequency * band.harmonic;
      const active = enabled && frequency <= maxFrequency;
      const strength = strengths?.get(band.harmonic) ?? 0;
      const colorGain = Math.pow(
        Math.max(1, band.harmonic / 2),
        this.harmonicEvidenceColor * HARMONIC_EVIDENCE_COLOR_TILT,
      );
      const bandGain = active
        ? this.harmonicEvidenceAmount
          * (0.9 / band.harmonic)
          * colorGain
          * (0.25 + strength * 0.75)
        : 0;

      if (active) {
        band.connectionToken += 1;
        if (!band.connected) {
          band.input.connect(band.filter);
          band.connected = true;
        }
        band.filter.frequency.setTargetAtTime(frequency, now, timeConstant);
      } else if (band.connected) {
        const token = ++band.connectionToken;
        const disconnectDelayMs = Math.max(100, timeConstant * 5000);
        window.setTimeout(() => {
          if (band.connectionToken !== token || !band.connected) return;
          try { band.input.disconnect(band.filter); } catch { /* ok */ }
          band.connected = false;
        }, disconnectDelayMs);
      }
      band.targetGain = bandGain;
      band.gain.gain.setTargetAtTime(bandGain, now, timeConstant);
    }
  }

  private updateHarmonicEvidenceVoicesForChannel(ch: StreamChannel, includeBackground = false) {
    if ((!includeBackground && !this.shouldAnalyzeChannel(ch)) || this.toneMode !== 'harmonic-evidence' || ch.activeVoices.size === 0) return;
    if (!this.refreshAnalysisBins(ch)) return;

    const now = this.ctx.currentTime;
    const response = this.getHarmonicEvidenceResponseValues();
    for (const [note, voice] of ch.activeVoices) {
      const measurement = this.measureHarmonicEvidence(ch, voice.targetFrequency);
      voice.harmonicEvidence += (
        measurement.score - voice.harmonicEvidence
      ) * (voice.tight ? 1 : response.smoothing);
      this.configureHarmonicBands(
        voice,
        true,
        measurement.strengths,
        voice.tight ? TIGHT_ATTACK : response.bandTimeConstant,
      );

      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(
        this.getVoiceOutputGain(voice, this.getEffectiveVelocity(note)),
        now,
        voice.tight ? TIGHT_ATTACK : response.gainTimeConstant,
      );
    }
  }

  private getHarmonicEvidenceResponseValues(): HarmonicEvidenceResponseValues {
    const response = this.harmonicEvidenceResponse;
    const interpolate = (slow: number, neutral: number, fast: number) => response <= 0.5
      ? slow + (neutral - slow) * response * 2
      : neutral + (fast - neutral) * (response - 0.5) * 2;

    return {
      smoothing: interpolate(0.06, 0.28, 0.75),
      bandTimeConstant: interpolate(0.24, 0.06, 0.015),
      gainTimeConstant: interpolate(0.3, 0.08, 0.02),
    };
  }

  private updateAnalyzedToneVoices() {
    if (this.toneMode === 'spectral-snap') {
      this.updateSpectralSnapVoices();
      return;
    }
    if (this.toneMode !== 'harmonic-evidence') return;
    for (const [, ch] of this.channels) {
      this.updateHarmonicEvidenceVoicesForChannel(ch);
    }
  }

  private startToneAnalysis() {
    if (this.analysisTimer !== null || typeof window === 'undefined') return;
    this.analysisTimer = window.setInterval(() => {
      this.updateAnalyzedToneVoices();
      for (const ch of this.channels.values()) {
        if (ch.levelMatchPending) this.updateLevelMatch(ch);
      }
    }, ANALYSIS_TIMER_MS);
  }

  private stopToneAnalysis() {
    if (this.analysisTimer === null || typeof window === 'undefined') return;
    window.clearInterval(this.analysisTimer);
    this.analysisTimer = null;
  }

  private retuneActiveVoices(timeConstant = 0.005) {
    const now = this.ctx.currentTime;
    for (const [, ch] of this.channels) {
      ch.levelMatchPending = ch.levelMatch;
      for (const [note, voice] of ch.activeVoices) {
        voice.targetFrequency = noteToFreq(note + ch.octaveShift * 12 + this.pitchBendSemitones);
        const harmonicEvidenceEnabled = this.toneMode === 'harmonic-evidence';
        this.configureHarmonicBands(voice, harmonicEvidenceEnabled, null, timeConstant);

        if (this.toneMode !== 'spectral-snap') {
          voice.snappedFrequency = null;
          voice.filter.frequency.setTargetAtTime(
            this.clampFilterFrequency(voice.targetFrequency),
            now,
            timeConstant,
          );
        }
        if (!harmonicEvidenceEnabled) voice.harmonicEvidence = 0;
        voice.gain.gain.setTargetAtTime(
          this.getVoiceOutputGain(voice, this.getEffectiveVelocity(note)),
          now,
          voice.tight ? TIGHT_ATTACK : 0.04,
        );
      }
    }

    if (this.toneMode === 'spectral-snap') this.updateSpectralSnapVoices();
    if (this.toneMode === 'harmonic-evidence') this.updateAnalyzedToneVoices();
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

    const targetFrequency = noteToFreq(note + ch.octaveShift * 12 + this.pitchBendSemitones);
    const now = this.ctx.currentTime;

    voice.note = note;
    voice.tight = this.isTightNote(note);
    voice.active = true;
    voice.targetFrequency = targetFrequency;
    voice.snappedFrequency = null;
    voice.harmonicEvidence = 0;
    voice.filter.frequency.setTargetAtTime(this.clampFilterFrequency(targetFrequency), now, 0.001);
    voice.filter.Q.setTargetAtTime(ch.filterQ, now, 0.001);
    for (const band of voice.harmonicBands) {
      band.filter.Q.setTargetAtTime(ch.filterQ, now, 0.001);
    }
    this.configureHarmonicBands(voice, this.toneMode === 'harmonic-evidence', null, 0.001);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(this.getVoiceOutputGain(voice, velocity), now, voice.tight ? TIGHT_ATTACK : ATTACK);

    voice.levelReferenceGain.gain.setValueAtTime(this.getVoiceOutputGain(voice, 127) / VOICE_GAIN_BOOST, now);
    ch.activeVoices.set(note, voice);
    ch.levelMatchPending = ch.levelMatch;
    this.updateSpectralSnapVoicesForChannel(ch, 0.04);
    this.updateHarmonicEvidenceVoicesForChannel(ch);
    if (ch.levelMatch && !ch.levelMatchQueued) {
      // A pad starts several notes synchronously. Estimate the complete chord
      // once, instead of spending audio-trigger time on every partial chord.
      ch.levelMatchQueued = true;
      queueMicrotask(() => {
        ch.levelMatchQueued = false;
        this.updateLevelMatch(ch);
      });
    }
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
    const release = voice.tight ? TIGHT_RELEASE : RELEASE;
    voice.gain.gain.setTargetAtTime(0, now, release);
    if (voice.tight) voice.gain.gain.setValueAtTime(0, now + TIGHT_RELEASE_END);
    voice.levelReferenceGain.gain.setValueAtTime(0, now);
    voice.active = false;
    voice.note = -1;
    voice.targetFrequency = 440;
    voice.snappedFrequency = null;
    voice.harmonicEvidence = 0;
    this.configureHarmonicBands(voice, false, null, release);
    ch.activeVoices.delete(note);
    this.updateSpectralSnapVoicesForChannel(ch, 0.05);
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
        voice.levelReferenceGain.gain.setValueAtTime(0, now);
        voice.active = false;
        voice.note = -1;
        voice.targetFrequency = 440;
        voice.snappedFrequency = null;
        voice.harmonicEvidence = 0;
        this.configureHarmonicBands(voice, false, null, 0.01);
      }
      ch.activeVoices.clear();
    }
  }

  // --- Per-stream controls ---

  setStreamFilterQ(id: string, q: number) {
    if (!Number.isFinite(q)) return;
    const ch = this.channels.get(id);
    if (!ch) return;
    const next = Math.max(1, Math.min(100, q));
    if (next === ch.filterQ) return;
    ch.filterQ = next;
    if (ch.levelMatch) this.updateLevelMatch(ch);
    if (this.shouldAnalyzeChannel(ch)) this.applyChannelFilterQ(ch);
  }

  private applyChannelFilterQ(ch: StreamChannel, immediate = false) {
    const now = this.ctx.currentTime;
    // Silent Traveler destinations retain the setting without sending thousands
    // of redundant AudioParam messages during a wheel sweep. New notes receive
    // the latest Q in noteOnForChannel; source selection catches up held notes.
    const voices = this.travelerSourceId != null ? ch.activeVoices.values() : ch.voices;
    for (const voice of voices) {
      for (const filter of [voice.filter, ...voice.harmonicBands.map(band => band.filter)]) {
        if (immediate) {
          filter.Q.cancelScheduledValues(now);
          filter.Q.setValueAtTime(ch.filterQ, now);
        } else {
          filter.Q.setTargetAtTime(ch.filterQ, now, 0.01);
        }
      }
    }
  }

  setStreamLevelMatch(id: string, enabled: boolean, referenceQ?: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.levelMatch = enabled;
    ch.levelMatchReferenceQ = typeof referenceQ === 'number' && Number.isFinite(referenceQ)
      ? Math.max(1, Math.min(100, referenceQ)) : ch.filterQ;
    ch.levelMatchPending = enabled;
    if (enabled) {
      this.startToneAnalysis();
      this.updateLevelMatch(ch);
    } else {
      ch.levelMatchGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
      if (this.toneMode === 'bands' && ![...this.channels.values()].some(channel => channel.levelMatch)) {
        this.stopToneAnalysis();
      }
    }
  }

  getStreamLevelMatch(id: string) {
    const ch = this.channels.get(id);
    return { enabled: ch?.levelMatch ?? true, referenceQ: ch?.levelMatchReferenceQ ?? DEFAULT_Q };
  }

  private updateLevelMatch(ch: StreamChannel, includeBackground = false) {
    // Freeze between edits/hits and throughout releases. Never chase an
    // envelope, muted track, or a stream going silent.
    if (!ch.levelMatch) return;
    if (!includeBackground && !this.shouldAnalyzeChannel(ch)) {
      ch.levelMatchPending = true;
      return;
    }
    if (ch.filterQ === ch.levelMatchReferenceQ) {
      ch.levelMatchGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
      ch.levelMatchPending = false;
      return;
    }
    if (!ch.activeVoices.size) return;
    ch.rawAnalyser.getFloatFrequencyData(ch.analysisBins);
    const bands: ResonanceBand[] = [];
    for (const [note, voice] of ch.activeVoices) {
      const gain = this.getVoiceOutputGain(voice, this.getEffectiveVelocity(note));
      bands.push({ frequency: voice.snappedFrequency ?? voice.targetFrequency, gain });
      if (this.toneMode === 'harmonic-evidence') {
        for (const band of voice.harmonicBands) {
          if (band.connected) bands.push({ frequency: voice.targetFrequency * band.harmonic, gain: gain * band.targetGain });
        }
      }
    }
    // Include the track EQ in both estimates; it can remove much of a chord.
    const spectrum = ch.analysisBins.slice();
    const frequencies = Float32Array.from(spectrum, (_, i) => i * this.ctx.sampleRate / (spectrum.length * 2));
    const magnitude = new Float32Array(spectrum.length);
    const phase = new Float32Array(spectrum.length);
    for (const filter of [ch.highPassFilter, ch.lowPassFilter]) {
      filter.getFrequencyResponse(frequencies, magnitude, phase);
      for (let i = 0; i < spectrum.length; i++) spectrum[i] += 20 * Math.log10(Math.max(1e-12, magnitude[i]));
    }
    const correction = estimateResonanceLevelMatch(spectrum, this.ctx.sampleRate,
      bands, ch.levelMatchReferenceQ, ch.filterQ);
    if (correction === null) { ch.levelMatchPending = true; return; }
    ch.levelMatchGain.gain.setTargetAtTime(correction, this.ctx.currentTime, 0.01);
    ch.levelMatchPending = false;
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
    ch.sourceLevelHighPass.frequency.setTargetAtTime(ch.highPassFreq, this.ctx.currentTime, 0.01);
  }

  getStreamHighPass(id: string): number {
    return this.channels.get(id)?.highPassFreq ?? DEFAULT_HIGH_PASS_FREQ;
  }

  setStreamLowPass(id: string, freq: number) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.lowPassFreq = this.clampLowPassFrequency(freq);
    ch.lowPassFilter.frequency.setTargetAtTime(ch.lowPassFreq, this.ctx.currentTime, 0.01);
    ch.sourceLevelLowPass.frequency.setTargetAtTime(ch.lowPassFreq, this.ctx.currentTime, 0.01);
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

  // Independent of solo: an unavailable selected destination must mean silence,
  // never fall back to playing every source.
  private travelerSourceId: string | null = null;

  private updateSourceLevels() {
    if (this.travelerSourceId == null) return;
    const now = this.ctx.currentTime;
    // Measure only branches that actually rendered during the previous tick.
    // All media stay connected; only one silent destination warms at a time.
    for (const ch of this.channels.values()) {
      if (!ch.rendering) continue;
      const elapsed = now - ch.sourceLevelUpdatedAt;
      ch.sourceLevelUpdatedAt = now;
      if (elapsed <= 0) continue;
      if (ch.audioElement.paused || ch.audioElement.readyState < 2) {
        ch.sourceLevelState.signalSeconds = 0;
        continue;
      }
      if (!ch.activeVoices.size) {
        ch.sourceLevelState.signalSeconds = 0;
        continue; // A release or a pause must not make the next hit louder.
      }
      for (const voice of ch.activeVoices.values()) {
        const reference = this.getVoiceOutputGain(voice, 127) / VOICE_GAIN_BOOST;
        if (voice.levelReferenceGain.gain.value !== reference) {
          voice.levelReferenceGain.gain.setValueAtTime(reference, now);
        }
      }
      ch.sourceLevelAnalyser.getFloatTimeDomainData(ch.sourceLevelSamples);
      // Include the existing resonance compensation, without any user gain.
      const resonanceGain = ch.levelMatchGain.gain.value;
      for (let i = 0; i < ch.sourceLevelSamples.length; i++) ch.sourceLevelSamples[i] *= resonanceGain;
      const previousDb = ch.sourceLevelState.gainDb;
      const gain = updateSourceLevel(ch.sourceLevelState, ch.sourceLevelSamples, elapsed);
      if (ch.sourceLevelState.gainDb !== previousDb) {
        ch.sourceLevelGain.gain.setTargetAtTime(gain, now, gain < ch.sourceLevelGain.gain.value ? 0.03 : 0.15);
      }
    }
    const background = [...this.channels.values()].filter(ch => !this.shouldAnalyzeChannel(ch)
      && ch.activeVoices.size && !ch.audioElement.paused && ch.audioElement.readyState >= 2);
    this.sourceLevelBackground = background.length
      ? background[this.sourceLevelBackgroundIndex++ % background.length] : null;
    const next = this.sourceLevelBackground;
    if (next) {
      if (next.levelMatchPending) this.applyChannelFilterQ(next, true);
      this.updateHarmonicEvidenceVoicesForChannel(next, true);
      this.updateSpectralSnapVoicesForChannel(next, 0.05, true);
      if (next.levelMatchPending) this.updateLevelMatch(next, true);
    }
    this.syncChannelRendering();
  }

  private syncChannelRendering() {
    for (const ch of this.channels.values()) {
      const rendering = this.shouldAnalyzeChannel(ch) || ch === this.sourceLevelBackground;
      if (ch.rendering === rendering) continue;
      // Disconnect both audible and measurement branches. Merely setting the
      // stream gate to zero leaves every resonator processing at audio rate.
      for (const voice of ch.voices) {
        if (rendering) {
          voice.gain.connect(ch.levelMatchGain);
          voice.levelReferenceGain.connect(ch.sourceLevelHighPass);
        } else {
          voice.gain.disconnect(ch.levelMatchGain);
          voice.levelReferenceGain.disconnect(ch.sourceLevelHighPass);
        }
      }
      ch.rendering = rendering;
    }
  }

  private setSourceLeveling(enabled: boolean) {
    if (this.sourceLevelTimer != null) window.clearInterval(this.sourceLevelTimer);
    this.sourceLevelTimer = null;
    this.sourceLevelBackgroundIndex = 0;
    this.sourceLevelBackground = null;
    for (const ch of this.channels.values()) {
      ch.sourceLevelState = createSourceLevelState();
      ch.sourceLevelUpdatedAt = this.ctx.currentTime;
      ch.sourceLevelGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    }
    if (enabled) this.sourceLevelTimer = window.setInterval(() => this.updateSourceLevels(), 200);
  }

  private shouldAnalyzeChannel(ch: StreamChannel): boolean {
    return this.travelerSourceId == null || this.channels.get(this.travelerSourceId) === ch;
  }

  setTravelerSource(id: string | null) {
    if (this.travelerSourceId === id) return;
    const previous = this.travelerSourceId == null ? null : this.channels.get(this.travelerSourceId);
    const wasTraveling = this.travelerSourceId != null;
    this.travelerSourceId = id;
    if (wasTraveling !== (id != null)) this.setSourceLeveling(id != null);
    // Keep the previous source connected for its existing soft release. The
    // next metering tick parks it; Tight still closes its gate immediately.
    if (wasTraveling && id != null) this.sourceLevelBackground = previous ?? null;
    this.syncChannelRendering();
    // Refresh the selected destination before opening its gate.
    for (const ch of this.channels.values()) {
      if (this.shouldAnalyzeChannel(ch)) this.applyChannelFilterQ(ch, true);
    }
    this.updateAnalyzedToneVoices();
    for (const ch of this.channels.values()) {
      if (this.shouldAnalyzeChannel(ch)) this.updateLevelMatch(ch);
    }
    this.applyGains();
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
    const soloId = this.soloId && this.channels.has(this.soloId) ? this.soloId : null;
    for (const [id, ch] of this.channels) {
      const traveling = this.travelerSourceId != null;
      const audible = traveling ? id === this.travelerSourceId && !ch.muted : soloId ? id === soloId : !ch.muted;
      const volume = traveling ? DEFAULT_VOL : ch.volume;
      const currentGain = ch.streamGain.gain.value;
      ch.streamGain.gain.cancelScheduledValues(now);
      ch.streamGain.gain.setValueAtTime(currentGain, now);
      if (traveling && this.chordPadTight) {
        ch.streamGain.gain.setValueAtTime(audible ? volume : 0, now);
      } else {
        ch.streamGain.gain.setTargetAtTime(audible ? volume : 0, now, 0.01);
      }
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

  setToneMode(mode: ToneMode) {
    this.toneMode = mode === 'spectral-snap' || mode === 'harmonic-evidence'
      ? mode
      : 'bands';
    if (this.toneMode === 'bands') {
      if (![...this.channels.values()].some(ch => ch.levelMatch)) this.stopToneAnalysis();
    } else {
      this.startToneAnalysis();
    }
    this.retuneActiveVoices(0.04);
  }

  getToneMode(): ToneMode {
    return this.toneMode;
  }

  setHarmonicEvidenceSettings(settings: { amount: number; color: number; response: number }) {
    this.harmonicEvidenceAmount = Number.isFinite(settings.amount)
      ? Math.min(2, Math.max(0, settings.amount))
      : 1;
    this.harmonicEvidenceColor = Number.isFinite(settings.color)
      ? Math.min(1, Math.max(-1, settings.color))
      : 0;
    this.harmonicEvidenceResponse = Number.isFinite(settings.response)
      ? Math.min(1, Math.max(0, settings.response))
      : 0.5;

    // Harmonic Evidence is now the fixed tone mode, so there is no selector
    // calling setToneMode() to start analysis. Keep the analyzer alive here
    // and apply slider changes to latched/held voices without a retrigger.
    if (this.toneMode === 'harmonic-evidence') {
      this.startToneAnalysis();
      this.updateAnalyzedToneVoices();
    }
  }

  getHarmonicEvidenceSettings() {
    return {
      amount: this.harmonicEvidenceAmount,
      color: this.harmonicEvidenceColor,
      response: this.harmonicEvidenceResponse,
    };
  }

  // --- Global controls ---

  setFilterQ(q: number) {
    if (!Number.isFinite(q)) return;
    this.filterQ = Math.max(1, Math.min(100, q));
    for (const [id] of this.channels) {
      this.setStreamFilterQ(id, this.filterQ);
    }
  }

  getFilterQ(): number {
    return this.filterQ;
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
    return this.ctx.resume().then(() => this.outputRouter.recover());
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
