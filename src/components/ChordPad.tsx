import { useState, useCallback, useRef, useEffect } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { webrtcService } from '../services/WebRTCService';

const CHORD_PAD_SOURCE = 'chord-pad';

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
  inputVolume: number;
}

export function ChordPad({ streamConnected, inputVolume }: Props) {
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
        audioEngine.noteOff(n, CHORD_PAD_SOURCE);
        webrtcService.sendNoteOff(n);
      }
    }
    // Play new notes (skip if already playing)
    for (const n of notes) {
      if (!prevNotes.current.includes(n)) {
        const scaledVelocity = Math.max(0, Math.round(100 * inputVolume));
        audioEngine.noteOn(n, scaledVelocity, CHORD_PAD_SOURCE);
        webrtcService.sendNoteOn(n, 100);
      }
    }
    prevNotes.current = notes;
    setActiveChordNotes(notes);
  }, [inputVolume]);

  const releaseAll = useCallback(() => {
    for (const n of prevNotes.current) {
      audioEngine.noteOff(n, CHORD_PAD_SOURCE);
      webrtcService.sendNoteOff(n);
    }
    prevNotes.current = [];
    setActiveChordNotes([]);
  }, []);

  useEffect(() => {
    const scaledVelocity = Math.max(0, Math.round(100 * inputVolume));
    for (const note of prevNotes.current) {
      audioEngine.updateNoteSourceVelocity(note, scaledVelocity, CHORD_PAD_SOURCE);
    }
  }, [inputVolume]);

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
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-black pb-2">
        <h3 className="m-0 text-[11px] font-black uppercase text-black">Chord Memory</h3>
        <div className="min-w-[68px] border-2 border-black bg-white px-2 py-1 text-center font-mono text-base font-black text-black">
          {activeChordNotes.length > 0 ? chordLabel : '---'}
        </div>
        <button
          className={`border-2 px-3 py-1 font-mono text-[10px] font-black uppercase ${
            latched
              ? 'border-black bg-black text-white'
              : 'border-black bg-white text-black hover:bg-black hover:text-white'
          }`}
          onClick={handleLatchToggle}
        >
          {latched ? 'LATCH ON' : 'LATCH OFF'}
        </button>
        <div className="flex items-center gap-1 text-[11px] font-black uppercase text-black">
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white"
            onClick={() => setInversion(Math.max(0, inversion - 1))}
          >-</button>
          <span>Inv {inversion}</span>
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white"
            onClick={() => setInversion(Math.min(maxInversion, inversion + 1))}
          >+</button>
        </div>
        <button
          className="ml-auto border-2 border-black bg-white px-2.5 py-1 font-mono text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
          onClick={releaseAll}
        >Release</button>
      </div>

      {/* Root note selector */}
      <div className="grid grid-cols-12 gap-1">
        {ROOT_NOTES.map(({ name, semitone }) => (
          <button
            key={semitone}
            className={`border-2 px-0.5 py-1.5 text-center font-mono text-[11px] font-black ${
              selectedRoot === semitone
                ? 'border-black bg-black text-white'
                : name.includes('#')
                  ? 'border-black bg-black text-white hover:bg-[#2a2a2a]'
                  : 'border-black bg-white text-black hover:bg-black hover:text-white'
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
        <div key={group.label} className="grid gap-1 sm:grid-cols-[48px_minmax(0,1fr)] sm:items-start">
          <span className="pt-1 text-right text-[10px] font-black uppercase text-black/55">{group.label}</span>
          <div className="flex flex-wrap gap-1">
            {group.types.map(type => {
              const def = CHORD_TYPES[type];
              if (!def) return null;
              return (
                <button
                  key={type}
                  className={`min-w-[48px] border-2 px-2 py-[5px] text-center font-mono text-[10px] font-black ${
                    selectedType === type
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-black hover:text-white'
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
      <div className="border-2 border-black">
        <div className="flex border-b-2 border-black bg-[#f2f0e8]">
          <span className="min-w-[36px] px-1 py-[3px] text-center text-[9px] font-black uppercase text-black/55">Quick</span>
          {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
            <span key={type} className="flex-1 px-0.5 py-[3px] text-center text-[9px] font-black text-black/60">{CHORD_TYPES[type].short || 'M'}</span>
          ))}
        </div>
        {ROOT_NOTES.map(({ name, semitone }) => (
          <div key={semitone} className="flex border-t border-black first:border-t-0">
            <span className={`flex min-w-[36px] items-center justify-center px-1 py-[3px] text-center text-[10px] font-black ${name.includes('#') ? 'bg-black text-white' : 'bg-white text-black'}`}>{name}</span>
            {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
              <button
                key={type}
                className={`flex-1 border-l border-black px-0.5 py-1 text-center font-mono text-[9px] font-black ${
                  selectedRoot === semitone && selectedType === type && activeChordNotes.length > 0
                    ? 'bg-black text-white'
                    : 'bg-white text-black hover:bg-black hover:text-white'
                }`}
                onClick={() => handleChordTrigger(semitone, type)}
              >
                {name}{CHORD_TYPES[type].short || ''}
              </button>
            ))}
          </div>
        ))}
      </div>

      {!streamConnected && <p className="m-0 border-2 border-black px-2 py-1 text-[10px] font-black uppercase text-black/55">Select a live source first</p>}
    </div>
  );
}
