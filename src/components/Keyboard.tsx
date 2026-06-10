import { useState, useEffect, useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { webrtcService } from '../services/WebRTCService';

const KEYBOARD_SOURCE = 'keyboard';
const MIN_BASE_OCTAVE = 1;
const MAX_BASE_OCTAVE = 5;

interface KeyBinding {
  code: string;
  label: string;
  offset: number;
}

// Physical keyboard layout based on KeyboardEvent.code, so it stays consistent
// even if the user's OS keyboard layout is not US English.
const KEY_BINDINGS: KeyBinding[] = [
  { code: 'KeyA', label: 'A', offset: 0 },
  { code: 'KeyW', label: 'W', offset: 1 },
  { code: 'KeyS', label: 'S', offset: 2 },
  { code: 'KeyE', label: 'E', offset: 3 },
  { code: 'KeyD', label: 'D', offset: 4 },
  { code: 'KeyF', label: 'F', offset: 5 },
  { code: 'KeyT', label: 'T', offset: 6 },
  { code: 'KeyG', label: 'G', offset: 7 },
  { code: 'KeyY', label: 'Y', offset: 8 },
  { code: 'KeyH', label: 'H', offset: 9 },
  { code: 'KeyU', label: 'U', offset: 10 },
  { code: 'KeyJ', label: 'J', offset: 11 },
  { code: 'KeyK', label: 'K', offset: 12 },
  { code: 'KeyO', label: 'O', offset: 13 },
  { code: 'KeyL', label: 'L', offset: 14 },
  { code: 'KeyP', label: 'P', offset: 15 },
  { code: 'Semicolon', label: ';', offset: 16 },
  { code: 'Quote', label: '\'', offset: 17 },
  { code: 'BracketRight', label: ']', offset: 18 },
  { code: 'Backslash', label: '\\', offset: 19 },
];

const KEY_BINDINGS_BY_CODE = new Map(KEY_BINDINGS.map(binding => [binding.code, binding]));
const KEY_LABELS_BY_OFFSET = KEY_BINDINGS.reduce<Map<number, string[]>>((map, binding) => {
  const labels = map.get(binding.offset) ?? [];
  labels.push(binding.label);
  map.set(binding.offset, labels);
  return map;
}, new Map());

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
  inputVolume: number;
}

export function Keyboard({ streamConnected, inputVolume }: Props) {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [latchMode, setLatchMode] = useState(false);
  const [baseOctave, setBaseOctave] = useState(3);
  const [compactVisualRange, setCompactVisualRange] = useState(false);
  const heldKeyNotes = useRef<Map<string, number>>(new Map());
  const activePointerId = useRef<number | null>(null);
  const glideNote = useRef<number | null>(null);

  const triggerNoteOn = useCallback((note: number, velocity = 100) => {
    const scaledVelocity = Math.max(0, Math.round(velocity * inputVolume));
    audioEngine.noteOn(note, scaledVelocity, KEYBOARD_SOURCE);
    webrtcService.sendNoteOn(note, velocity);
    setActiveNotes(prev => new Set(prev).add(note));
  }, [inputVolume]);

  const triggerNoteOff = useCallback((note: number) => {
    audioEngine.noteOff(note, KEYBOARD_SOURCE);
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
        audioEngine.noteOff(note, KEYBOARD_SOURCE);
        webrtcService.sendNoteOff(note);
        const next = new Set(prev);
        next.delete(note);
        return next;
      } else {
        const scaledVelocity = Math.max(0, Math.round(velocity * inputVolume));
        audioEngine.noteOn(note, scaledVelocity, KEYBOARD_SOURCE);
        webrtcService.sendNoteOn(note, velocity);
        return new Set(prev).add(note);
      }
    });
  }, [inputVolume]);

  const releaseAll = useCallback(() => {
    for (const note of activeNotes) {
      webrtcService.sendNoteOff(note);
    }
    audioEngine.allNotesOff(KEYBOARD_SOURCE);
    setActiveNotes(new Set());
    heldKeyNotes.current.clear();
  }, [activeNotes]);

  useEffect(() => {
    const scaledVelocity = Math.max(0, Math.round(100 * inputVolume));
    for (const note of activeNotes) {
      audioEngine.updateNoteSourceVelocity(note, scaledVelocity, KEYBOARD_SOURCE);
    }
  }, [activeNotes, inputVolume]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const syncVisualRange = () => setCompactVisualRange(mediaQuery.matches);

    syncVisualRange();
    mediaQuery.addEventListener('change', syncVisualRange);
    return () => mediaQuery.removeEventListener('change', syncVisualRange);
  }, []);

  const nudgeBaseOctave = useCallback((delta: number) => {
    setBaseOctave(prev => Math.max(MIN_BASE_OCTAVE, Math.min(MAX_BASE_OCTAVE, prev + delta)));
  }, []);

  // Computer keyboard input
  useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null) => (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target)) return;
      if (e.repeat) return;

      if (e.code === 'ArrowDown') {
        e.preventDefault();
        nudgeBaseOctave(-1);
        return;
      }

      if (e.code === 'ArrowUp') {
        e.preventDefault();
        nudgeBaseOctave(1);
        return;
      }

      if (e.code === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        releaseAll();
        return;
      }

      const binding = KEY_BINDINGS_BY_CODE.get(e.code);
      if (!binding || heldKeyNotes.current.has(e.code)) return;

      const note = (baseOctave + 1) * 12 + binding.offset;
      heldKeyNotes.current.set(e.code, note);
      e.preventDefault();

      if (!streamConnected) return;

      if (note !== undefined) {
        if (latchMode) {
          toggleNote(note);
        } else {
          triggerNoteOn(note);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const note = heldKeyNotes.current.get(e.code);
      if (note === undefined) return;

      heldKeyNotes.current.delete(e.code);
      if (!latchMode) {
        triggerNoteOff(note);
      }
    };

    const handleWindowBlur = () => {
      heldKeyNotes.current.clear();
      if (!latchMode) {
        releaseAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [baseOctave, latchMode, nudgeBaseOctave, releaseAll, streamConnected, toggleNote, triggerNoteOff, triggerNoteOn]);

  // Visual piano: 3 octaves on desktop, cleaner C-E span on narrow screens.
  const startNote = 48;
  const visualKeyCount = compactVisualRange ? 17 : 37;
  const keys: { note: number; black: boolean; name: string }[] = [];
  for (let i = 0; i < visualKeyCount; i++) {
    const note = startNote + i;
    keys.push({ note, black: isBlackKey(note), name: noteName(note) });
  }

  const keyLabel = (note: number): string => {
    const offset = note - ((baseOctave + 1) * 12);
    return (KEY_LABELS_BY_OFFSET.get(offset) ?? []).join(' ');
  };

  const noteFromPointer = (event: ReactPointerEvent): number | null => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const keyElement = element instanceof HTMLElement
      ? element.closest<HTMLElement>('[data-key-note]')
      : null;
    const note = Number(keyElement?.dataset.keyNote);

    return Number.isFinite(note) ? note : null;
  };

  const switchGlideNote = useCallback((nextNote: number | null) => {
    const currentNote = glideNote.current;
    if (currentNote === nextNote) return;

    if (currentNote !== null) {
      triggerNoteOff(currentNote);
    }

    glideNote.current = nextNote;

    if (nextNote !== null) {
      triggerNoteOn(nextNote);
    }
  }, [triggerNoteOff, triggerNoteOn]);

  const endGlide = useCallback(() => {
    switchGlideNote(null);
    activePointerId.current = null;
  }, [switchGlideNote]);

  const handlePointerDown = (event: ReactPointerEvent) => {
    const note = noteFromPointer(event);
    if (note === null) return;

    event.preventDefault();

    if (latchMode) {
      toggleNote(note);
      return;
    }

    activePointerId.current = event.pointerId;
    switchGlideNote(note);
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    if (activePointerId.current !== event.pointerId) return;

    event.preventDefault();
    switchGlideNote(noteFromPointer(event));
  };

  const handlePointerEnd = (event: ReactPointerEvent) => {
    if (activePointerId.current !== event.pointerId) return;

    event.preventDefault();
    endGlide();
  };

  const whiteKeys = keys.filter(k => !k.black);
  const blackKeys = keys.filter(k => k.black);
  const blackKeyWidthPercent = (100 / whiteKeys.length) * 0.64;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-black pb-2">
        <button
          className={`border-2 px-3 py-1 font-mono text-[10px] font-black uppercase ${
            latchMode
              ? 'border-black bg-black text-white'
              : 'border-black bg-white text-black hover:bg-black hover:text-white'
          }`}
          onClick={() => setLatchMode(prev => !prev)}
        >
          {latchMode ? 'Latch On' : 'Latch'}
        </button>
        <div className="flex items-center gap-1 text-[11px] font-black uppercase text-black">
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white disabled:opacity-30"
            onClick={() => nudgeBaseOctave(-1)}
            disabled={baseOctave <= MIN_BASE_OCTAVE}
          >
            -
          </button>
          <span>Keys C{baseOctave}-G{baseOctave + 1}</span>
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white disabled:opacity-30"
            onClick={() => nudgeBaseOctave(1)}
            disabled={baseOctave >= MAX_BASE_OCTAVE}
          >
            +
          </button>
        </div>
        {latchMode && (
          <button
            className="border-2 border-black bg-[#f3d85a] px-2.5 py-1 font-mono text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
            onClick={releaseAll}
          >
            Release All
          </button>
        )}
        {!streamConnected && <span className="ml-auto border-2 border-black px-2 py-1 text-[10px] font-black uppercase text-black/55">Select a live source to play</span>}
      </div>
      <div
        className={`relative flex touch-none select-none ${compactVisualRange ? 'h-[104px]' : 'h-[168px]'} overflow-hidden border-2 border-black bg-white`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
      >
        {whiteKeys.map((k, index) => {
          const active = activeNotes.has(k.note);
          const rightBorder = index === whiteKeys.length - 1 ? 'border-r-0' : 'border-r-2 border-black';
          return (
            <div
              key={k.note}
              data-key-note={k.note}
              className={`relative z-[1] flex h-full flex-1 cursor-pointer flex-col items-center justify-end pb-1 ${rightBorder} ${
                active
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-[#f2f0e8]'
              }`}
            >
              <span className={`text-[9px] font-black ${active ? 'text-white' : 'text-black/55'}`}>{keyLabel(k.note)}</span>
              <span className={`text-[8px] font-bold ${active ? 'text-white/70' : 'text-black/40'}`}>{k.name}</span>
            </div>
          );
        })}
        {blackKeys.map(k => {
          const whitesBefore = keys.filter(wk => !wk.black && wk.note < k.note).length;
          const leftPercent = ((whitesBefore - 0.32) / whiteKeys.length) * 100;
          const active = activeNotes.has(k.note);
          return (
            <div
              key={k.note}
              data-key-note={k.note}
              className={`absolute z-[2] flex h-[60%] cursor-pointer flex-col items-center justify-end border-2 border-black pb-1 ${
                active
                  ? 'bg-[#f3d85a] text-black'
                  : 'bg-black text-white hover:bg-[#2a2a2a]'
              }`}
              style={{ left: `${leftPercent}%`, width: `${blackKeyWidthPercent}%` }}
            >
              <span className={`text-[9px] font-black ${active ? 'text-black' : 'text-white/65'}`}>{keyLabel(k.note)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
