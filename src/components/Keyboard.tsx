import { useState, useEffect, useCallback, useRef } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { webrtcService } from '../services/WebRTCService';

// Computer keyboard → MIDI note mapping (2 octaves starting at C3)
const KEY_MAP: Record<string, number> = {
  // Lower row: C3 - B3
  'a': 48, 'w': 49, 's': 50, 'e': 51, 'd': 52,
  'f': 53, 't': 54, 'g': 55, 'y': 56, 'h': 57,
  'u': 58, 'j': 59,
  // Upper row: C4 - E5
  'k': 60, 'o': 61, 'l': 62, 'p': 63, ';': 64,
  "'": 65, ']': 66, '\\': 67,
};

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteName(midi: number): string {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

function isBlackKey(midi: number): boolean {
  const n = midi % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

interface Props {
  streamConnected: boolean;
}

export function Keyboard({ streamConnected }: Props) {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [octaveShift, setOctaveShift] = useState(0);
  const heldKeys = useRef<Set<string>>(new Set());

  const triggerNoteOn = useCallback((note: number, velocity = 100) => {
    audioEngine.noteOn(note, velocity);
    webrtcService.sendNoteOn(note, velocity);
    setActiveNotes(prev => new Set(prev).add(note));
  }, []);

  const triggerNoteOff = useCallback((note: number) => {
    audioEngine.noteOff(note);
    webrtcService.sendNoteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  // Computer keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;

      // Octave shift with z/x
      if (e.key === 'z') {
        setOctaveShift(prev => Math.max(-3, prev - 1));
        return;
      }
      if (e.key === 'x') {
        setOctaveShift(prev => Math.min(3, prev + 1));
        return;
      }

      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined && !heldKeys.current.has(e.key)) {
        heldKeys.current.add(e.key);
        triggerNoteOn(note + octaveShift * 12);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined) {
        heldKeys.current.delete(e.key);
        triggerNoteOff(note + octaveShift * 12);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [octaveShift, triggerNoteOn, triggerNoteOff]);

  // Visual piano: 3 octaves
  const startNote = 48 + octaveShift * 12;
  const keys = [];
  for (let i = 0; i < 37; i++) { // C3 to C6
    const note = startNote + i;
    const black = isBlackKey(note);
    keys.push({ note, black, name: noteName(note) });
  }

  // Find keyboard shortcut for a note
  const keyLabel = (note: number): string => {
    const shifted = note - octaveShift * 12;
    const entry = Object.entries(KEY_MAP).find(([, n]) => n === shifted);
    return entry ? entry[0].toUpperCase() : '';
  };

  return (
    <div className="keyboard-container">
      <div className="keyboard-header">
        <span className="octave-label">Octave: {octaveShift >= 0 ? '+' : ''}{octaveShift}</span>
        <span className="key-hint">Z/X = octave down/up</span>
        {!streamConnected && <span className="hint">Select a live source to play</span>}
      </div>
      <div className="piano">
        {keys.filter(k => !k.black).map(k => (
          <div
            key={k.note}
            className={`piano-key white ${activeNotes.has(k.note) ? 'active' : ''}`}
            onMouseDown={() => triggerNoteOn(k.note)}
            onMouseUp={() => triggerNoteOff(k.note)}
            onMouseLeave={() => { if (activeNotes.has(k.note)) triggerNoteOff(k.note); }}
          >
            <span className="key-label">{keyLabel(k.note)}</span>
            <span className="note-name">{k.name}</span>
          </div>
        ))}
        {keys.filter(k => k.black).map(k => {
          // Position black keys between whites
          const whitesBefore = keys.filter(wk => !wk.black && wk.note < k.note).length;
          const leftPercent = ((whitesBefore - 0.3) / keys.filter(wk => !wk.black).length) * 100;
          return (
            <div
              key={k.note}
              className={`piano-key black ${activeNotes.has(k.note) ? 'active' : ''}`}
              style={{ left: `${leftPercent}%` }}
              onMouseDown={() => triggerNoteOn(k.note)}
              onMouseUp={() => triggerNoteOff(k.note)}
              onMouseLeave={() => { if (activeNotes.has(k.note)) triggerNoteOff(k.note); }}
            >
              <span className="key-label">{keyLabel(k.note)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
