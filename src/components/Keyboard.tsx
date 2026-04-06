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
  const [latchMode, setLatchMode] = useState(false);
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

  // Computer keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;

      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined && !heldKeys.current.has(e.key)) {
        heldKeys.current.add(e.key);
        if (latchMode) {
          toggleNote(note);
        } else {
          triggerNoteOn(note);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined) {
        heldKeys.current.delete(e.key);
        if (!latchMode) {
          triggerNoteOff(note);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [latchMode, triggerNoteOn, triggerNoteOff, toggleNote]);

  // Visual piano: 3 octaves starting at C3
  const startNote = 48;
  const keys: { note: number; black: boolean; name: string }[] = [];
  for (let i = 0; i < 37; i++) {
    const note = startNote + i;
    keys.push({ note, black: isBlackKey(note), name: noteName(note) });
  }

  const keyLabel = (note: number): string => {
    const entry = Object.entries(KEY_MAP).find(([, n]) => n === note);
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

  const whiteKeys = keys.filter(k => !k.black);
  const blackKeys = keys.filter(k => k.black);

  return (
    <div className="mb-3">
      <div className="flex items-center gap-3 mb-1.5 px-1">
        <button
          className={`px-3 py-1 border rounded-sm cursor-pointer font-mono text-[10px] font-semibold tracking-wide ${
            latchMode
              ? 'bg-[#1a3a1a] border-[#4a4] text-[#6c6]'
              : 'bg-[#1a1a1a] border-[#333] text-[#888]'
          }`}
          onClick={() => setLatchMode(prev => !prev)}
        >
          {latchMode ? 'LATCH ON' : 'LATCH'}
        </button>
        {latchMode && (
          <button
            className="px-2.5 py-1 border border-[#533] rounded-sm bg-[#1a1111] text-[#c88] cursor-pointer font-mono text-[10px] hover:bg-[#2a1818]"
            onClick={releaseAll}
          >
            RELEASE ALL
          </button>
        )}
        {!streamConnected && <span className="text-[#555] text-[10px] ml-auto italic">Select a live source to play</span>}
      </div>
      <div className="relative h-[140px] flex">
        {whiteKeys.map(k => {
          const active = activeNotes.has(k.note);
          return (
            <div
              key={k.note}
              className={`relative cursor-pointer flex flex-col items-center justify-end flex-1 h-full border rounded-b transition-[background] duration-50 z-[1] pb-1.5 ${
                active
                  ? 'bg-[#1a3a5a] border-[#3a6a9a] shadow-[0_0_12px_rgba(58,106,154,0.4)]'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] hover:bg-[#222]'
              }`}
              onMouseDown={() => handleKeyClick(k.note)}
              onMouseUp={() => handleKeyRelease(k.note)}
              onMouseLeave={() => handleKeyLeave(k.note)}
            >
              <span className={`text-[9px] font-semibold ${active ? 'text-[#8ab]' : 'text-[#444]'}`}>{keyLabel(k.note)}</span>
              <span className={`text-[8px] ${active ? 'text-[#6a8aaa]' : 'text-[#333]'}`}>{k.name}</span>
            </div>
          );
        })}
        {blackKeys.map(k => {
          const whitesBefore = keys.filter(wk => !wk.black && wk.note < k.note).length;
          const leftPercent = ((whitesBefore - 0.3) / whiteKeys.length) * 100;
          const active = activeNotes.has(k.note);
          return (
            <div
              key={k.note}
              className={`absolute w-[3.2%] h-[60%] cursor-pointer flex flex-col items-center justify-end rounded-b-sm transition-[background] duration-50 z-[2] pb-1 ${
                active
                  ? 'bg-[#1a3050] border border-[#2a5080] shadow-[0_0_10px_rgba(42,80,128,0.5)]'
                  : 'bg-[#0a0a0a] border border-[#222] hover:bg-[#151515]'
              }`}
              style={{ left: `${leftPercent}%` }}
              onMouseDown={() => handleKeyClick(k.note)}
              onMouseUp={() => handleKeyRelease(k.note)}
              onMouseLeave={() => handleKeyLeave(k.note)}
            >
              <span className={`text-[9px] font-semibold ${active ? 'text-[#8ab]' : 'text-[#444]'}`}>{keyLabel(k.note)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
