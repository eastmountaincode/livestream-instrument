/**
 * Web MIDI service for the resonant filter instrument.
 * Routes MIDI note on/off to the audio engine.
 * Supports CC mapping for filter Q and other params.
 */

import { audioEngine } from './AudioEngine';

const MIDI_SOURCE = 'midi';

export type MidiDeviceInfo = { id: string; name: string };
export type MidiUpdateCallback = () => void;
export type MidiNoteEvent = { type: 'on' | 'off'; note: number; velocity: number };

interface HeldMidiNote {
  count: number;
  velocity: number;
}

class MidiService {
  private access: MIDIAccess | null = null;
  private selectedInput: MIDIInput | null = null;
  private selectedOutput: MIDIOutput | null = null;
  private listeners: MidiUpdateCallback[] = [];
  private ccCallbacks: ((cc: number, value: number) => void)[] = [];
  private noteCallbacks: ((event: MidiNoteEvent) => void)[] = [];
  private inputVolume = 1;
  private activeNotes: Map<number, HeldMidiNote> = new Map();

  async init(): Promise<boolean> {
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.ensureSelectedInput();
        this.notifyListeners();
      };
      this.ensureSelectedInput();
      this.notifyListeners();
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
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null;
    }
    if (!id || !this.access) {
      this.selectedInput = null;
      this.notifyListeners();
      return;
    }
    this.selectedInput = this.access.inputs.get(id) || null;
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = this.handleMidiMessage;
    }
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
    this.ccCallbacks.push(cb);
    return () => { this.ccCallbacks = this.ccCallbacks.filter(c => c !== cb); };
  }

  onNote(cb: (event: MidiNoteEvent) => void) {
    this.noteCallbacks.push(cb);
    return () => { this.noteCallbacks = this.noteCallbacks.filter(c => c !== cb); };
  }

  onChange(cb: MidiUpdateCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notifyListeners() {
    for (const l of this.listeners) l();
  }

  private ensureSelectedInput() {
    if (!this.access) return;
    if (this.selectedInput && this.access.inputs.has(this.selectedInput.id)) return;

    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null;
      this.selectedInput = null;
    }

    const firstInput = this.access.inputs.values().next().value as MIDIInput | undefined;
    if (firstInput) {
      this.selectedInput = firstInput;
      this.selectedInput.onmidimessage = this.handleMidiMessage;
    }
  }

  private notifyNote(event: MidiNoteEvent) {
    for (const cb of this.noteCallbacks) cb(event);
  }

  private scaleVelocity(velocity: number) {
    return Math.max(0, Math.round(velocity * this.inputVolume));
  }

  private handleMidiMessage = (e: Event) => {
    if (!(e instanceof MIDIMessageEvent)) return;
    const data = e.data;
    if (!data || data.length === 0) return;
    const status = data[0];

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

    // CC: 0xB0-0xBF
    if ((status & 0xF0) === 0xB0 && data.length >= 3) {
      const cc = data[1];
      const value = data[2];

      for (const cb of this.ccCallbacks) cb(cc, value);
    }
  };

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

export const midiService = new MidiService();
