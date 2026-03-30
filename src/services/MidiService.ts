/**
 * Web MIDI service for the resonant filter instrument.
 * Routes MIDI note on/off to the audio engine.
 * Supports CC mapping for filter Q and other params.
 */

import { audioEngine } from './AudioEngine';

export type MidiDeviceInfo = { id: string; name: string };
export type MidiUpdateCallback = () => void;

class MidiService {
  private access: WebMidi.MIDIAccess | null = null;
  private selectedInput: WebMidi.MIDIInput | null = null;
  private selectedOutput: WebMidi.MIDIOutput | null = null;
  private listeners: MidiUpdateCallback[] = [];
  private ccCallbacks: ((cc: number, value: number) => void)[] = [];

  async init(): Promise<boolean> {
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.notifyListeners();
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

  onCC(cb: (cc: number, value: number) => void) {
    this.ccCallbacks.push(cb);
    return () => { this.ccCallbacks = this.ccCallbacks.filter(c => c !== cb); };
  }

  onChange(cb: MidiUpdateCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notifyListeners() {
    for (const l of this.listeners) l();
  }

  private handleMidiMessage = (e: WebMidi.MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length === 0) return;
    const status = data[0];

    // Note on: 0x90-0x9F
    if ((status & 0xF0) === 0x90 && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      if (velocity > 0) {
        audioEngine.noteOn(note, velocity);
      } else {
        audioEngine.noteOff(note);
      }
    }

    // Note off: 0x80-0x8F
    if ((status & 0xF0) === 0x80 && data.length >= 3) {
      audioEngine.noteOff(data[1]);
    }

    // CC: 0xB0-0xBF
    if ((status & 0xF0) === 0xB0 && data.length >= 3) {
      const cc = data[1];
      const value = data[2];

      // CC1 (mod wheel) → filter Q
      if (cc === 1) {
        const q = 1 + (value / 127) * 99; // 1-100
        audioEngine.setFilterQ(q);
      }

      for (const cb of this.ccCallbacks) cb(cc, value);
    }
  };
}

export const midiService = new MidiService();
