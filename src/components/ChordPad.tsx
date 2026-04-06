import { useState, useCallback, useRef, useEffect } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { webrtcService } from '../services/WebRTCService';

// --- Chord definitions (intervals from root) ---
const CHORD_TYPES: Record<string, { label: string; intervals: number[]; short: string }> = {
  'maj':      { label: 'Major',         intervals: [0, 4, 7],          short: '' },
  'min':      { label: 'Minor',         intervals: [0, 3, 7],          short: 'm' },
  'dim':      { label: 'Diminished',    intervals: [0, 3, 6],          short: 'dim' },
  'aug':      { label: 'Augmented',     intervals: [0, 4, 8],          short: 'aug' },
  'sus2':     { label: 'Suspended 2nd', intervals: [0, 2, 7],          short: 'sus2' },
  'sus4':     { label: 'Suspended 4th', intervals: [0, 5, 7],          short: 'sus4' },
  '7':        { label: 'Dominant 7th',  intervals: [0, 4, 7, 10],      short: '7' },
  'maj7':     { label: 'Major 7th',     intervals: [0, 4, 7, 11],      short: 'maj7' },
  'min7':     { label: 'Minor 7th',     intervals: [0, 3, 7, 10],      short: 'm7' },
  'dim7':     { label: 'Diminished 7th',intervals: [0, 3, 6, 9],       short: 'dim7' },
  'min7b5':   { label: 'Half-Dim 7th',  intervals: [0, 3, 6, 10],      short: 'm7b5' },
  'aug7':     { label: 'Aug 7th',       intervals: [0, 4, 8, 10],      short: 'aug7' },
  '9':        { label: 'Dominant 9th',  intervals: [0, 4, 7, 10, 14],  short: '9' },
  'maj9':     { label: 'Major 9th',     intervals: [0, 4, 7, 11, 14],  short: 'maj9' },
  'min9':     { label: 'Minor 9th',     intervals: [0, 3, 7, 10, 14],  short: 'm9' },
  'add9':     { label: 'Add 9',         intervals: [0, 4, 7, 14],      short: 'add9' },
  '11':       { label: '11th',          intervals: [0, 4, 7, 10, 14, 17], short: '11' },
  'min11':    { label: 'Minor 11th',    intervals: [0, 3, 7, 10, 14, 17], short: 'm11' },
  '13':       { label: '13th',          intervals: [0, 4, 7, 10, 14, 21], short: '13' },
  '6':        { label: 'Major 6th',     intervals: [0, 4, 7, 9],       short: '6' },
  'min6':     { label: 'Minor 6th',     intervals: [0, 3, 7, 9],       short: 'm6' },
  'power':    { label: 'Power (5th)',   intervals: [0, 7],              short: '5' },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_NOTES = NOTE_NAMES.map((name, i) => ({ name, semitone: i }));

// Common chord type groups for the UI
const CHORD_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Triads',    types: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'power'] },
  { label: '7ths',      types: ['7', 'maj7', 'min7', 'dim7', 'min7b5', 'aug7'] },
  { label: '9ths+',     types: ['9', 'maj9', 'min9', 'add9', '11', 'min11', '13'] },
  { label: '6ths',      types: ['6', 'min6'] },
];

interface Props {
  streamConnected: boolean;
}

export function ChordPad({ streamConnected }: Props) {
  const octave = 3; // Base octave 3 (C3 = MIDI 48)
  const [selectedRoot, setSelectedRoot] = useState(0); // C
  const [selectedType, setSelectedType] = useState('maj');
  const [latched, setLatched] = useState(false);
  const [activeChordNotes, setActiveChordNotes] = useState<number[]>([]);
  const [inversion, setInversion] = useState(0);
  const prevNotes = useRef<number[]>([]);

  // Build chord notes from root + type + octave + inversion
  const buildChord = useCallback((root: number, type: string, oct: number, inv: number): number[] => {
    const chordDef = CHORD_TYPES[type];
    if (!chordDef) return [];
    const baseNote = (oct + 1) * 12 + root; // MIDI note
    let notes = chordDef.intervals.map(interval => baseNote + interval);

    // Apply inversion: move bottom notes up an octave
    const effectiveInv = Math.min(inv, notes.length - 1);
    for (let i = 0; i < effectiveInv; i++) {
      notes[i] += 12;
    }
    notes.sort((a, b) => a - b);

    return notes;
  }, []);

  // Play a chord (release previous, play new)
  const playChord = useCallback((notes: number[]) => {
    // Release previous notes
    for (const n of prevNotes.current) {
      if (!notes.includes(n)) {
        audioEngine.noteOff(n);
        webrtcService.sendNoteOff(n);
      }
    }
    // Play new notes (skip if already playing)
    for (const n of notes) {
      if (!prevNotes.current.includes(n)) {
        audioEngine.noteOn(n, 100);
        webrtcService.sendNoteOn(n, 100);
      }
    }
    prevNotes.current = notes;
    setActiveChordNotes(notes);
  }, []);

  const releaseAll = useCallback(() => {
    for (const n of prevNotes.current) {
      audioEngine.noteOff(n);
      webrtcService.sendNoteOff(n);
    }
    prevNotes.current = [];
    setActiveChordNotes([]);
  }, []);

  // When root/type/octave/inversion changes and notes are playing, update the chord
  useEffect(() => {
    if (prevNotes.current.length > 0) {
      const notes = buildChord(selectedRoot, selectedType, octave, inversion);
      playChord(notes);
    }
  }, [selectedRoot, selectedType, octave, inversion, buildChord, playChord]);

  const handleChordTrigger = (root: number, type: string) => {
    setSelectedRoot(root);
    setSelectedType(type);
    const notes = buildChord(root, type, octave, inversion);
    playChord(notes);
  };

  const handleLatchToggle = () => {
    if (latched) {
      // Unlatch: release all
      setLatched(false);
      releaseAll();
    } else {
      setLatched(true);
    }
  };

  const chordLabel = `${NOTE_NAMES[selectedRoot]}${CHORD_TYPES[selectedType]?.short || ''}`;
  const maxInversion = (CHORD_TYPES[selectedType]?.intervals.length || 3) - 1;

  return (
    <div className="bg-[#141414] rounded-md p-3 mb-3">
      <div className="flex items-center gap-3 mb-2.5 flex-wrap">
        <h3 className="text-[13px] font-semibold text-[#aaa] m-0">Chord Pad</h3>
        <div className="text-base font-bold text-[#8ab] min-w-[60px]">
          {activeChordNotes.length > 0 ? chordLabel : '---'}
        </div>
        <button
          className={`px-3 py-1 border rounded-sm cursor-pointer font-mono text-[10px] font-semibold tracking-wide ${
            latched
              ? 'bg-[#1a3a1a] border-[#4a4] text-[#6c6]'
              : 'bg-[#1a1a1a] border-[#333] text-[#888]'
          }`}
          onClick={handleLatchToggle}
        >
          {latched ? 'LATCH ON' : 'LATCH OFF'}
        </button>
        <div className="flex items-center gap-1 text-[11px] text-[#888]">
          <button
            className="w-5 h-5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer text-xs flex items-center justify-center p-0"
            onClick={() => setInversion(Math.max(0, inversion - 1))}
          >-</button>
          <span>Inv {inversion}</span>
          <button
            className="w-5 h-5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer text-xs flex items-center justify-center p-0"
            onClick={() => setInversion(Math.min(maxInversion, inversion + 1))}
          >+</button>
        </div>
        <button
          className="px-2.5 py-1 border border-[#533] rounded-sm bg-[#1a1111] text-[#c88] cursor-pointer font-mono text-[10px] ml-auto hover:bg-[#2a1818]"
          onClick={releaseAll}
        >Release</button>
      </div>

      {/* Root note selector */}
      <div className="flex gap-[3px] mb-2.5">
        {ROOT_NOTES.map(({ name, semitone }) => (
          <button
            key={semitone}
            className={`flex-1 py-1.5 px-0.5 border rounded-sm cursor-pointer font-mono text-[11px] font-semibold text-center ${
              selectedRoot === semitone
                ? 'bg-[#1a2a4a] border-[#3a5a8a] text-[#8ab]'
                : name.includes('#')
                  ? 'bg-[#111] border-[#2a2a2a] text-[#888] hover:border-[#444] hover:text-white'
                  : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#bbb] hover:border-[#444] hover:text-white'
            }`}
            onClick={() => {
              setSelectedRoot(semitone);
              if (latched && prevNotes.current.length > 0) {
                // Will auto-update via useEffect
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Chord type grid */}
      {CHORD_GROUPS.map(group => (
        <div key={group.label} className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] text-[#555] min-w-[40px] text-right">{group.label}</span>
          <div className="flex gap-[3px] flex-wrap">
            {group.types.map(type => {
              const def = CHORD_TYPES[type];
              if (!def) return null;
              return (
                <button
                  key={type}
                  className={`py-[5px] px-2 border rounded-sm cursor-pointer font-mono text-[10px] min-w-[44px] text-center ${
                    selectedType === type
                      ? 'bg-[#1a2a4a] border-[#3a5a8a] text-[#8ab]'
                      : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#aaa] hover:border-[#444] hover:text-[#ddd]'
                  }`}
                  onClick={() => handleChordTrigger(selectedRoot, type)}
                  title={def.label}
                >
                  {NOTE_NAMES[selectedRoot]}{def.short}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Quick root+chord grid: all 12 roots as rows, common chords as columns */}
      <div className="mt-3 border border-[#222] rounded overflow-hidden">
        <div className="flex bg-[#111]">
          <span className="min-w-[32px] py-[3px] px-1 text-[9px] text-[#555] text-center">Quick</span>
          {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
            <span key={type} className="flex-1 py-[3px] px-0.5 text-[9px] text-[#666] text-center font-semibold">{CHORD_TYPES[type].short || 'M'}</span>
          ))}
        </div>
        {ROOT_NOTES.map(({ name, semitone }) => (
          <div key={semitone} className="flex border-t border-[#1a1a1a]">
            <span className={`min-w-[32px] py-[3px] px-1 text-[10px] font-semibold text-center bg-[#111] flex items-center justify-center ${name.includes('#') ? 'text-[#666]' : 'text-[#888]'}`}>{name}</span>
            {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
              <button
                key={type}
                className={`flex-1 py-1 px-0.5 border-none border-l border-[#1a1a1a] cursor-pointer font-mono text-[9px] text-center ${
                  selectedRoot === semitone && selectedType === type && activeChordNotes.length > 0
                    ? 'bg-[#1a3a5a] text-[#8bc] font-semibold'
                    : 'bg-[#161616] text-[#777] hover:bg-[#222] hover:text-[#ccc]'
                }`}
                onClick={() => handleChordTrigger(semitone, type)}
              >
                {name}{CHORD_TYPES[type].short || ''}
              </button>
            ))}
          </div>
        ))}
      </div>

      {!streamConnected && <p className="text-[#555] text-[10px] ml-auto italic mt-2">Select a live source first</p>}
    </div>
  );
}
