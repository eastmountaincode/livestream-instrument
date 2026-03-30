/**
 * Resonant Filter Instrument Engine
 *
 * The live stream flows continuously into a bank of resonant bandpass filters.
 * Each MIDI note / keyboard key activates a filter tuned to that pitch.
 * Press a key → the stream "sings" at that frequency.
 * Hold a chord → the stream becomes a chord.
 *
 * Supports crossfading between two stream sources.
 *
 * Signal chain per voice:
 *   streamMix → BiquadFilter(bandpass, freq=noteHz, Q=high) → GainNode(envelope) → voiceMix
 *
 * Crossfade chain:
 *   sourceA → gainA ─┐
 *                     ├─→ streamMix → [voices]
 *   sourceB → gainB ─┘
 *
 * Master chain:
 *   voiceMix → masterGain → compressor → analyser → destination
 */

const MAX_VOICES = 24;
const DEFAULT_Q = 30;
const ATTACK = 0.02;
const RELEASE = 0.3;
const CROSSFADE_TIME = 3.0; // seconds
const VOICE_GAIN_BOOST = 8.0; // Resonant filters on broadband noise need significant gain

export interface Voice {
  note: number;
  filter: BiquadFilterNode;
  gain: GainNode;
  active: boolean;
}

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

interface StreamSlot {
  source: MediaElementAudioSourceNode | null;
  gain: GainNode;
  audioElement: HTMLAudioElement | null;
}

export class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  voiceMix: GainNode;
  streamMix: GainNode; // mix point for crossfade

  // Two stream slots for crossfading
  private slotA: StreamSlot;
  private slotB: StreamSlot;
  private activeSlot: 'A' | 'B' = 'A';

  // Voice pool
  private voices: Voice[] = [];
  private activeVoices: Map<number, Voice> = new Map();

  private filterQ = DEFAULT_Q;

  constructor() {
    this.ctx = new AudioContext();

    // Stream mix node (crossfade destination)
    this.streamMix = this.ctx.createGain();
    this.streamMix.gain.value = 1.0;

    // Crossfade slots
    this.slotA = {
      source: null,
      gain: this.ctx.createGain(),
      audioElement: null,
    };
    this.slotA.gain.gain.value = 1.0;
    this.slotA.gain.connect(this.streamMix);

    this.slotB = {
      source: null,
      gain: this.ctx.createGain(),
      audioElement: null,
    };
    this.slotB.gain.gain.value = 0.0;
    this.slotB.gain.connect(this.streamMix);

    this.voiceMix = this.ctx.createGain();
    this.voiceMix.gain.value = 1.0;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.15;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.voiceMix.connect(this.masterGain);
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Pre-allocate voice pool — each voice reads from streamMix
    for (let i = 0; i < MAX_VOICES; i++) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 440;
      filter.Q.value = this.filterQ;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      // streamMix → filter → gain → voiceMix
      this.streamMix.connect(filter);
      filter.connect(gain);
      gain.connect(this.voiceMix);

      this.voices.push({ note: -1, filter, gain, active: false });
    }
  }

  // --- Stream connection with crossfade ---

  /**
   * Connect a new stream. If one is already playing, crossfade to the new one.
   */
  connectStream(audioElement: HTMLAudioElement) {
    // Always put the new stream in the inactive slot
    const incomingSlot = this.activeSlot === 'A' ? this.slotB : this.slotA;
    const outgoingSlot = this.activeSlot === 'A' ? this.slotA : this.slotB;
    const hasOutgoing = outgoingSlot.source !== null;

    // Clean up any previous source in the incoming slot (e.g. leftover from last crossfade)
    this.cleanupSlot(incomingSlot);

    // Set up the incoming slot
    incomingSlot.source = this.ctx.createMediaElementSource(audioElement);
    incomingSlot.source.connect(incomingSlot.gain);
    incomingSlot.audioElement = audioElement;

    const now = this.ctx.currentTime;

    // Cancel any in-progress automation on both slots
    incomingSlot.gain.gain.cancelScheduledValues(0);
    outgoingSlot.gain.gain.cancelScheduledValues(0);

    if (hasOutgoing) {
      // Crossfade: fade in new, fade out old
      incomingSlot.gain.gain.setValueAtTime(0, now);
      incomingSlot.gain.gain.linearRampToValueAtTime(1.0, now + CROSSFADE_TIME);

      outgoingSlot.gain.gain.setValueAtTime(1.0, now);
      outgoingSlot.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_TIME);

      // Clean up old slot after crossfade completes
      setTimeout(() => {
        this.cleanupSlot(outgoingSlot);
      }, CROSSFADE_TIME * 1000 + 500);
    } else {
      // No previous stream, just fade in
      incomingSlot.gain.gain.setValueAtTime(0, now);
      incomingSlot.gain.gain.linearRampToValueAtTime(1.0, now + 0.5);
    }

    // Flip active slot
    this.activeSlot = this.activeSlot === 'A' ? 'B' : 'A';
  }

  private cleanupSlot(slot: StreamSlot) {
    if (slot.source) {
      try { slot.source.disconnect(); } catch { /* ok */ }
      slot.source = null;
    }
    if (slot.audioElement) {
      slot.audioElement.pause();
      slot.audioElement.src = '';
      slot.audioElement = null;
    }
    slot.gain.gain.cancelScheduledValues(0);
    slot.gain.gain.value = 0;
  }

  disconnectStream() {
    for (const slot of [this.slotA, this.slotB]) {
      if (slot.source) {
        try { slot.source.disconnect(); } catch { /* ok */ }
        slot.source = null;
      }
      if (slot.audioElement) {
        slot.audioElement.pause();
        slot.audioElement.src = '';
        slot.audioElement = null;
      }
      slot.gain.gain.value = 0;
    }
    this.activeSlot = 'A';
    this.slotA.gain.gain.value = 1.0;

    for (const voice of this.voices) {
      voice.gain.gain.value = 0;
      voice.active = false;
    }
    this.activeVoices.clear();
  }

  isStreamConnected(): boolean {
    return this.slotA.source !== null || this.slotB.source !== null;
  }

  // --- Note on/off ---

  noteOn(note: number, velocity: number = 127) {
    if (!this.isStreamConnected()) return;

    if (this.activeVoices.has(note)) return;

    let voice = this.voices.find(v => !v.active);
    if (!voice) {
      const oldest = this.activeVoices.entries().next().value;
      if (oldest) {
        const [oldNote, oldVoice] = oldest;
        this.activeVoices.delete(oldNote);
        voice = oldVoice;
      } else {
        return;
      }
    }

    const freq = noteToFreq(note);
    const now = this.ctx.currentTime;
    const velGain = (velocity / 127) * VOICE_GAIN_BOOST;

    voice.note = note;
    voice.active = true;
    voice.filter.frequency.setTargetAtTime(freq, now, 0.001);
    voice.filter.Q.setTargetAtTime(this.filterQ, now, 0.001);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(velGain, now, ATTACK);

    this.activeVoices.set(note, voice);
  }

  noteOff(note: number) {
    const voice = this.activeVoices.get(note);
    if (!voice) return;

    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, RELEASE);
    voice.active = false;
    voice.note = -1;
    this.activeVoices.delete(note);
  }

  allNotesOff() {
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.01);
      voice.active = false;
      voice.note = -1;
    }
    this.activeVoices.clear();
  }

  // --- Controls ---

  setFilterQ(q: number) {
    this.filterQ = Math.max(1, Math.min(100, q));
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      voice.filter.Q.setTargetAtTime(this.filterQ, now, 0.01);
    }
  }

  getFilterQ() {
    return this.filterQ;
  }

  // Volume can go up to 4.0 (400%) for quiet sources
  setMasterVolume(vol: number) {
    this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
  }

  getActiveNotes(): number[] {
    return Array.from(this.activeVoices.keys());
  }

  resume() {
    return this.ctx.resume();
  }
}

export const audioEngine = new AudioEngine();
