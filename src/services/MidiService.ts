/**
 * Web MIDI service for the resonant filter instrument.
 * Routes MIDI note on/off to the audio engine.
 * Supports pitch bend and CC mapping for mixer params.
 */

import { audioEngine } from './AudioEngine';

const MIDI_SOURCE = 'midi';
const PITCH_BEND_RANGE_SEMITONES = 12;

export type MidiDeviceInfo = { id: string; name: string };
export type MidiUpdateCallback = () => void;
export type MidiNoteEvent = { type: 'on' | 'off'; note: number; velocity: number };
export type MidiPitchBendEvent = { value: number; normalized: number; semitones: number };
export type MidiMessageEventInfo = { status: number; data: number[]; label: string; inputId?: string; inputName?: string };
export type MidiClockEvent = { receivedAt: number };
export type MidiTransportEvent = { type: 'start' | 'continue' | 'stop'; receivedAt: number };

interface HeldMidiNote {
  count: number;
  velocity: number;
}

class MidiService {
  private access: MIDIAccess | null = null;
  private selectedInput: MIDIInput | null = null;
  private selectedOutput: MIDIOutput | null = null;
  private listeners: MidiUpdateCallback[] = [];
  private messageCallbacks: ((event: MidiMessageEventInfo) => void)[] = [];
  private ccCallbacks: ((cc: number, value: number) => void)[] = [];
  private noteCallbacks: ((event: MidiNoteEvent) => void)[] = [];
  private pitchBendCallbacks: ((event: MidiPitchBendEvent) => void)[] = [];
  private clockCallbacks: ((event: MidiClockEvent) => void)[] = [];
  private transportCallbacks: ((event: MidiTransportEvent) => void)[] = [];
  private inputVolume = 1;
  private activeNotes: Map<number, HeldMidiNote> = new Map();
  private handleMidiMessage = (event: Event) => this.handleMidiMessageEvent(event);
  private handleStateChange = () => this.handleMidiStateChange();
  private initPromise: Promise<boolean> | null = null;

  migrateRuntimeState() {
    this.listeners ??= [];
    this.messageCallbacks ??= [];
    this.ccCallbacks ??= [];
    this.noteCallbacks ??= [];
    this.pitchBendCallbacks ??= [];
    this.clockCallbacks ??= [];
    this.transportCallbacks ??= [];
    this.activeNotes ??= new Map();
    this.inputVolume = Number.isFinite(this.inputVolume) ? Math.max(0, this.inputVolume) : 1;
    this.handleMidiMessage = (event: Event) => this.handleMidiMessageEvent(event);
    this.handleStateChange = () => this.handleMidiStateChange();
    this.initPromise ??= null;
    this.configureAccess();
  }

  async init(): Promise<boolean> {
    this.migrateRuntimeState();
    if (this.access) {
      this.configureAccess();
      return true;
    }
    if (this.initPromise) return this.initPromise;

    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      console.warn('Web MIDI not available');
      return false;
    }

    this.initPromise = this.requestAccess();
    const ok = await this.initPromise;
    this.initPromise = null;
    return ok;
  }

  private async requestAccess(): Promise<boolean> {
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.configureAccess();
      return true;
    } catch {
      console.warn('Web MIDI not available');
      return false;
    }
  }

  getInputs(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const result: MidiDeviceInfo[] = [];
    this.access.inputs.forEach((input) => {
      result.push({ id: input.id, name: input.name || input.id });
    });
    return result;
  }

  getOutputs(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const result: MidiDeviceInfo[] = [];
    this.access.outputs.forEach((output) => {
      result.push({ id: output.id, name: output.name || output.id });
    });
    return result;
  }

  selectInput(id: string | null) {
    if (!id || !this.access) {
      this.selectedInput = null;
      this.notifyListeners();
      return;
    }
    this.selectedInput = this.access.inputs.get(id) || null;
    this.syncInputHandlers();
    this.notifyListeners();
  }

  selectOutput(id: string | null) {
    if (!id || !this.access) {
      this.selectedOutput = null;
      return;
    }
    this.selectedOutput = this.access.outputs.get(id) || null;
    this.notifyListeners();
  }

  getSelectedInputId() { return this.selectedInput?.id || null; }
  getSelectedOutputId() { return this.selectedOutput?.id || null; }

  setInputVolume(volume: number) {
    this.inputVolume = Number.isFinite(volume) ? Math.max(0, volume) : 1;
    for (const [note, state] of this.activeNotes) {
      audioEngine.updateNoteSourceVelocity(note, this.scaleVelocity(state.velocity), MIDI_SOURCE);
    }
  }

  onCC(cb: (cc: number, value: number) => void) {
    this.migrateRuntimeState();
    this.ccCallbacks.push(cb);
    return () => { this.ccCallbacks = this.ccCallbacks.filter(c => c !== cb); };
  }

  onNote(cb: (event: MidiNoteEvent) => void) {
    this.migrateRuntimeState();
    this.noteCallbacks.push(cb);
    return () => { this.noteCallbacks = this.noteCallbacks.filter(c => c !== cb); };
  }

  onPitchBend(cb: (event: MidiPitchBendEvent) => void) {
    this.migrateRuntimeState();
    this.pitchBendCallbacks.push(cb);
    return () => { this.pitchBendCallbacks = this.pitchBendCallbacks.filter(c => c !== cb); };
  }

  onClock(cb: (event: MidiClockEvent) => void) {
    this.migrateRuntimeState();
    this.clockCallbacks.push(cb);
    return () => { this.clockCallbacks = this.clockCallbacks.filter(c => c !== cb); };
  }

  onTransport(cb: (event: MidiTransportEvent) => void) {
    this.migrateRuntimeState();
    this.transportCallbacks.push(cb);
    return () => { this.transportCallbacks = this.transportCallbacks.filter(c => c !== cb); };
  }

  onMessage(cb: (event: MidiMessageEventInfo) => void) {
    this.migrateRuntimeState();
    this.messageCallbacks.push(cb);
    return () => { this.messageCallbacks = this.messageCallbacks.filter(c => c !== cb); };
  }

  onChange(cb: MidiUpdateCallback) {
    this.migrateRuntimeState();
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notifyListeners() {
    for (const l of this.listeners) l();
  }

  private notifyMessage(event: MidiMessageEventInfo) {
    for (const cb of this.messageCallbacks) cb(event);
  }

  private ensureSelectedInput() {
    if (!this.access) return;
    if (this.selectedInput && this.access.inputs.has(this.selectedInput.id)) return;

    this.selectedInput = null;

    const firstInput = this.access.inputs.values().next().value as MIDIInput | undefined;
    if (firstInput) {
      this.selectedInput = firstInput;
    }
  }

  private configureAccess() {
    if (!this.access) return;
    this.access.onstatechange = this.handleStateChange;
    this.ensureSelectedInput();
    this.syncInputHandlers();
    this.notifyListeners();
  }

  private handleMidiStateChange() {
    this.ensureSelectedInput();
    this.syncInputHandlers();
    this.notifyListeners();
  }

  private syncInputHandlers() {
    if (!this.access) return;
    this.access.inputs.forEach(input => {
      if (typeof input.open === 'function') {
        void input.open().catch(() => {
          // Some browser/device pairs reject open() even though implicit listening works.
        });
      }
      input.onmidimessage = this.handleMidiMessage;
    });
  }

  private notifyNote(event: MidiNoteEvent) {
    for (const cb of this.noteCallbacks) cb(event);
  }

  private notifyPitchBend(event: MidiPitchBendEvent) {
    for (const cb of this.pitchBendCallbacks) cb(event);
  }

  private notifyClock(event: MidiClockEvent) {
    for (const cb of this.clockCallbacks) cb(event);
  }

  private notifyTransport(event: MidiTransportEvent) {
    for (const cb of this.transportCallbacks) cb(event);
  }

  private sendOutput(data: number[]): boolean {
    if (!this.selectedOutput) return false;
    try {
      this.selectedOutput.send(data);
      return true;
    } catch {
      return false;
    }
  }

  sendNoteOn(note: number, velocity = 100, channel = 0): boolean {
    return this.sendOutput([0x90 | Math.min(15, Math.max(0, channel)), Math.min(127, Math.max(0, note)), Math.min(127, Math.max(1, velocity))]);
  }

  sendNoteOff(note: number, channel = 0): boolean {
    return this.sendOutput([0x80 | Math.min(15, Math.max(0, channel)), Math.min(127, Math.max(0, note)), 0]);
  }

  sendClock(): boolean {
    return this.sendOutput([0xF8]);
  }

  sendStart(): boolean {
    return this.sendOutput([0xFA]);
  }

  sendContinue(): boolean {
    return this.sendOutput([0xFB]);
  }

  sendStop(): boolean {
    return this.sendOutput([0xFC]);
  }

  private scaleVelocity(velocity: number) {
    return Math.max(0, Math.round(velocity * this.inputVolume));
  }

  private getMessageLabel(status: number): string {
    const command = status & 0xF0;
    if (command === 0x80) return 'Note Off';
    if (command === 0x90) return 'Note On';
    if (command === 0xB0) return 'CC';
    if (command === 0xE0) return 'Pitch Bend';
    return `MIDI 0x${status.toString(16).toUpperCase()}`;
  }

  private handleMidiMessageEvent(e: Event) {
    const data = (e as MIDIMessageEvent).data;
    if (!data || data.length === 0) return;
    const status = data[0];
    const eventTarget = e.currentTarget ?? e.target;
    const input = eventTarget && 'id' in eventTarget && 'name' in eventTarget
      ? eventTarget as MIDIInput
      : undefined;
    this.notifyMessage({
      status,
      data: Array.from(data),
      label: this.getMessageLabel(status),
      inputId: input?.id,
      inputName: input?.name || input?.id,
    });

    if (status === 0xF8) {
      this.notifyClock({ receivedAt: e.timeStamp });
    } else if (status === 0xFA) {
      this.notifyTransport({ type: 'start', receivedAt: e.timeStamp });
    } else if (status === 0xFB) {
      this.notifyTransport({ type: 'continue', receivedAt: e.timeStamp });
    } else if (status === 0xFC) {
      this.notifyTransport({ type: 'stop', receivedAt: e.timeStamp });
    }

    // Note on: 0x90-0x9F
    if ((status & 0xF0) === 0x90 && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      if (velocity > 0) {
        const held = this.activeNotes.get(note);
        if (held) {
          held.count += 1;
          held.velocity = Math.max(held.velocity, velocity);
        } else {
          this.activeNotes.set(note, { count: 1, velocity });
        }
        audioEngine.noteOn(note, this.scaleVelocity(velocity), MIDI_SOURCE);
        this.notifyNote({ type: 'on', note, velocity });
      } else {
        this.releaseMidiNote(note);
      }
    }

    // Note off: 0x80-0x8F
    if ((status & 0xF0) === 0x80 && data.length >= 3) {
      this.releaseMidiNote(data[1]);
    }

    // Pitch bend: 0xE0-0xEF, 14-bit little-endian value centered at 8192
    if ((status & 0xF0) === 0xE0 && data.length >= 3) {
      const value = (data[2] << 7) | data[1];
      const offset = value - 8192;
      const normalized = offset >= 0 ? offset / 8191 : offset / 8192;
      const semitones = Math.max(-1, Math.min(1, normalized)) * PITCH_BEND_RANGE_SEMITONES;

      audioEngine.setPitchBendSemitones(semitones);
      this.notifyPitchBend({ value, normalized, semitones });
    }

    // CC: 0xB0-0xBF
    if ((status & 0xF0) === 0xB0 && data.length >= 3) {
      const cc = data[1];
      const value = data[2];

      for (const cb of this.ccCallbacks) cb(cc, value);
    }
  }

  private releaseMidiNote(note: number) {
    const held = this.activeNotes.get(note);
    if (!held) return;

    if (held.count > 1) {
      held.count -= 1;
    } else {
      this.activeNotes.delete(note);
    }

    audioEngine.noteOff(note, MIDI_SOURCE);
    this.notifyNote({ type: 'off', note, velocity: 0 });
  }
}

const midiGlobal = globalThis as typeof globalThis & { __cicadaMidiService?: MidiService };

if (midiGlobal.__cicadaMidiService) {
  Object.setPrototypeOf(midiGlobal.__cicadaMidiService, MidiService.prototype);
  midiGlobal.__cicadaMidiService.migrateRuntimeState();
} else {
  midiGlobal.__cicadaMidiService = new MidiService();
}

export const midiService = midiGlobal.__cicadaMidiService;
