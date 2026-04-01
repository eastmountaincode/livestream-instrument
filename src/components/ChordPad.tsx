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
  octaveShift: number;
}

export function ChordPad({ streamConnected, octaveShift }: Props) {
  const octave = 3 + octaveShift; // Base octave 3 (C3 = MIDI 48) + shift
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
    <div className="chord-pad">
      <div className="chord-pad-header">
        <h3>Chord Pad</h3>
        <div className="chord-display">
          {activeChordNotes.length > 0 ? chordLabel : '---'}
        </div>
        <button
          className={`latch-btn ${latched ? 'latched' : ''}`}
          onClick={handleLatchToggle}
        >
          {latched ? 'LATCH ON' : 'LATCH OFF'}
        </button>
        <div className="chord-inversion">
          <button onClick={() => setInversion(Math.max(0, inversion - 1))}>-</button>
          <span>Inv {inversion}</span>
          <button onClick={() => setInversion(Math.min(maxInversion, inversion + 1))}>+</button>
        </div>
        <button className="release-btn" onClick={releaseAll}>Release</button>
      </div>

      {/* Root note selector */}
      <div className="root-selector">
        {ROOT_NOTES.map(({ name, semitone }) => (
          <button
            key={semitone}
            className={`root-btn ${selectedRoot === semitone ? 'selected' : ''} ${name.includes('#') ? 'sharp' : ''}`}
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
        <div key={group.label} className="chord-group">
          <span className="chord-group-label">{group.label}</span>
          <div className="chord-type-row">
            {group.types.map(type => {
              const def = CHORD_TYPES[type];
              if (!def) return null;
              return (
                <button
                  key={type}
                  className={`chord-type-btn ${selectedType === type ? 'selected' : ''}`}
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
      <div className="quick-grid">
        <div className="quick-grid-header">
          <span className="quick-grid-corner">Quick</span>
          {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
            <span key={type} className="quick-col-label">{CHORD_TYPES[type].short || 'M'}</span>
          ))}
        </div>
        {ROOT_NOTES.map(({ name, semitone }) => (
          <div key={semitone} className="quick-grid-row">
            <span className={`quick-row-label ${name.includes('#') ? 'sharp' : ''}`}>{name}</span>
            {['maj', 'min', 'maj7', 'min7', 'min9', 'min11', 'sus4'].map(type => (
              <button
                key={type}
                className={`quick-btn ${selectedRoot === semitone && selectedType === type && activeChordNotes.length > 0 ? 'active' : ''}`}
                onClick={() => handleChordTrigger(semitone, type)}
              >
                {name}{CHORD_TYPES[type].short || ''}
              </button>
            ))}
          </div>
        ))}
      </div>

      {!streamConnected && <p className="hint">Select a live source first</p>}
    </div>
  );
}
