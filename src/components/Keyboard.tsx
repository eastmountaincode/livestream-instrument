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
  octaveShift: number;
  setOctaveShift: React.Dispatch<React.SetStateAction<number>>;
}

export function Keyboard({ streamConnected, octaveShift, setOctaveShift }: Props) {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [latchMode, setLatchMode] = useState(false);
  const heldKeys = useRef<Set<string>>(new Set());
  const prevOctaveShift = useRef(0);

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

  // Toggle a note on/off (for latch mode)
  const toggleNote = useCallback((note: number, velocity = 100) => {
    setActiveNotes(prev => {
      if (prev.has(note)) {
        audioEngine.noteOff(note);
        webrtcService.sendNoteOff(note);
        const next = new Set(prev);
        next.delete(note);
        return next;
      } else {
        audioEngine.noteOn(note, velocity);
        webrtcService.sendNoteOn(note, velocity);
        return new Set(prev).add(note);
      }
    });
  }, []);

  const releaseAll = useCallback(() => {
    audioEngine.allNotesOff();
    setActiveNotes(new Set());
  }, []);

  // Transpose active notes when octave shift changes
  useEffect(() => {
    const delta = octaveShift - prevOctaveShift.current;
    if (delta === 0) return;
    prevOctaveShift.current = octaveShift;

    setActiveNotes(prev => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      for (const note of prev) {
        audioEngine.noteOff(note);
        webrtcService.sendNoteOff(note);
        const shifted = note + delta * 12;
        audioEngine.noteOn(shifted, 100);
        webrtcService.sendNoteOn(shifted, 100);
        next.add(shifted);
      }
      return next;
    });
  }, [octaveShift]);

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
        const shiftedNote = note + octaveShift * 12;
        if (latchMode) {
          toggleNote(shiftedNote);
        } else {
          triggerNoteOn(shiftedNote);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined) {
        heldKeys.current.delete(e.key);
        if (!latchMode) {
          triggerNoteOff(note + octaveShift * 12);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [octaveShift, latchMode, triggerNoteOn, triggerNoteOff, toggleNote]);

  // Visual piano: 3 octaves
  const startNote = 48 + octaveShift * 12;
  const keys: { note: number; black: boolean; name: string }[] = [];
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

  const handleKeyClick = (note: number) => {
    if (latchMode) {
      toggleNote(note);
    } else {
      triggerNoteOn(note);
    }
  };

  const handleKeyRelease = (note: number) => {
    if (!latchMode) {
      triggerNoteOff(note);
    }
  };

  const handleKeyLeave = (note: number) => {
    if (!latchMode && activeNotes.has(note)) {
      triggerNoteOff(note);
    }
  };

  return (
    <div className="keyboard-container">
      <div className="keyboard-header">
        <span className="key-hint">Z/X = octave down/up</span>
        <button
          className={`latch-btn ${latchMode ? 'latched' : ''}`}
          onClick={() => setLatchMode(prev => !prev)}
        >
          {latchMode ? 'LATCH ON' : 'LATCH'}
        </button>
        {latchMode && (
          <button className="release-btn" onClick={releaseAll}>
            RELEASE ALL
          </button>
        )}
        {!streamConnected && <span className="hint">Select a live source to play</span>}
      </div>
      <div className="piano">
        {keys.filter(k => !k.black).map(k => (
          <div
            key={k.note}
            className={`piano-key white ${activeNotes.has(k.note) ? 'active' : ''}`}
            onMouseDown={() => handleKeyClick(k.note)}
            onMouseUp={() => handleKeyRelease(k.note)}
            onMouseLeave={() => handleKeyLeave(k.note)}
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
              onMouseDown={() => handleKeyClick(k.note)}
              onMouseUp={() => handleKeyRelease(k.note)}
              onMouseLeave={() => handleKeyLeave(k.note)}
            >
              <span className="key-label">{keyLabel(k.note)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
