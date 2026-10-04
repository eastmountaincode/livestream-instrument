import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import { webrtcService } from '../services/WebRTCService';
import { getChordBank, getChordPadState, getChordPadTight, saveChordPadTight, saveChordBank, saveChordPadState, type ChordPadState } from '../services/storage';
import {
  buildRelatedChordBank,
  buildChordNotes,
  CHORD_TYPES,
  chordKey,
  clampInversion,
  DEFAULT_CHORD,
  DEFAULT_CHORD_VELOCITY,
  getChordLabel,
  NOTE_NAMES,
  PAD_DISPLAY_ORDER,
  setChordBankPad,
  normalizeChordSpec,
  ROOT_NOTES,
  scaleChordVelocity,
  type ChordPerformanceEvent,
  type ChordSpec,
} from '../music/chords';

const CHORD_PAD_SOURCE = 'chord-pad';
const COMMON_CHORD_TYPES = ['maj', 'min', 'maj7', 'min7', 'min9', 'maj9', 'min11', 'sus4'];
const MPK_MINI_IV_PAD_NOTES = [36, 37, 38, 39, 40, 41, 42, 43];
const MPK_MINI_IV_PAD_INDEX = new Map(MPK_MINI_IV_PAD_NOTES.map((note, index) => [note, index]));

const AUTO_CHORD_RETRY_DELAY_MS = 250;
const MAX_AUTO_CHORD_RETRIES = 20;

function notesMatch(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

function isChordTriggerKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

function getInitialChordPadState(): ChordPadState | null {
  const saved = getChordPadState();
  if (!saved || !CHORD_TYPES[saved.selectedType]) return null;

  return {
    selectedRoot: Math.min(11, Math.max(0, saved.selectedRoot)),
    selectedType: saved.selectedType,
    inversion: clampInversion(saved.selectedType, saved.inversion),
    active: saved.active,
  };
}

interface Props {
  streamConnected: boolean;
  inputVolume: number;
  autoPlayDefaultChord?: boolean;
  midiPadsEnabled?: boolean;
  onSelectionChange?: (chord: ChordSpec) => void;
  onPerformanceEvent?: (event: ChordPerformanceEvent) => void;
}

export function ChordPad({
  streamConnected,
  inputVolume,
  autoPlayDefaultChord = false,
  midiPadsEnabled = true,
  onSelectionChange,
  onPerformanceEvent,
}: Props) {
  const octave = 3; // Base octave 3 (C3 = MIDI 48)
  const [initialChordPadState] = useState(() => getInitialChordPadState());
  const [chordBank, setChordBank] = useState(() => getChordBank());
  const [padEditMode, setPadEditMode] = useState<'assign' | 'clear' | null>(null);
  const [selectedRoot, setSelectedRoot] = useState(() => initialChordPadState?.selectedRoot ?? DEFAULT_CHORD.root);
  const [selectedType, setSelectedType] = useState(() => initialChordPadState?.selectedType ?? DEFAULT_CHORD.type);
  const [latched, setLatched] = useState(true);
  const [tight, setTight] = useState(() => getChordPadTight());
  useEffect(() => {
    audioEngine.setChordPadTight(tight);
    saveChordPadTight(tight);
  }, [tight]);
  const [activeChordKey, setActiveChordKey] = useState<string | null>(null);
  const [inversion, setInversion] = useState(() => initialChordPadState?.inversion ?? 0);
  const [autoChordRetry, setAutoChordRetry] = useState(0);
  const prevNotes = useRef<number[]>([]);
  const activeChordRef = useRef<{ root: number; type: string; inversion: number } | null>(null);
  const autoChordPlayedRef = useRef(false);
  const shouldAutoPlayInitialChordRef = useRef(initialChordPadState?.active ?? autoPlayDefaultChord);
  const performanceEventIdRef = useRef(0);
  const performanceChordRef = useRef<ChordSpec | null>(null);
  const activeMidiPadNoteRef = useRef<string | null>(null);
  const activeScreenPadRef = useRef<number | null>(null);

  const rememberChordState = useCallback((root: number, type: string, inv: number, active: boolean) => {
    if (!CHORD_TYPES[type]) return;
    saveChordPadState({
      selectedRoot: root,
      selectedType: type,
      inversion: clampInversion(type, inv),
      active,
    });
  }, []);

  // Play a chord (release previous, play new)
  const playChord = useCallback((notes: number[], velocity = DEFAULT_CHORD_VELOCITY) => {
    if (!streamConnected || !audioEngine.isStreamConnected()) return false;

    const previousNotes = prevNotes.current;
    const acceptedNotes: number[] = [];

    for (const n of previousNotes) {
      webrtcService.sendNoteOff(n);
    }

    audioEngine.allNotesOff(CHORD_PAD_SOURCE);

    for (const n of notes) {
      const scaledVelocity = scaleChordVelocity(velocity, inputVolume);
      const accepted = audioEngine.noteOn(n, scaledVelocity, CHORD_PAD_SOURCE);
      if (!accepted) continue;
      webrtcService.sendNoteOn(n, velocity);
      acceptedNotes.push(n);
    }
    prevNotes.current = acceptedNotes;
    return acceptedNotes.length > 0;
  }, [inputVolume, streamConnected]);

  const setChordActivity = useCallback((root: number, type: string, inv: number, active: boolean) => {
    activeChordRef.current = active ? { root, type, inversion: inv } : null;
    setActiveChordKey(active ? chordKey(root, type) : null);
    rememberChordState(root, type, inv, active);
  }, [rememberChordState]);

  const activateChord = useCallback((root: number, type: string, inv: number, velocity = DEFAULT_CHORD_VELOCITY) => {
    const notes = buildChordNotes({ root, type, inversion: inv }, octave);
    const played = playChord(notes, velocity);
    setChordActivity(root, type, inv, played);
    return played;
  }, [octave, playChord, setChordActivity]);

  const emitPerformanceEvent = useCallback((
    type: ChordPerformanceEvent['type'],
    chord: ChordSpec,
    momentary: boolean,
  ) => {
    if (!onPerformanceEvent) return;
    performanceEventIdRef.current += 1;
    onPerformanceEvent({
      id: performanceEventIdRef.current,
      type,
      chord,
      occurredAt: performance.now(),
      momentary,
    });
  }, [onPerformanceEvent]);

  const releaseAll = useCallback(() => {
    const activeChord = activeChordRef.current;
    const performanceChord = performanceChordRef.current;
    for (const n of prevNotes.current) {
      webrtcService.sendNoteOff(n);
    }
    audioEngine.allNotesOff(CHORD_PAD_SOURCE);
    prevNotes.current = [];
    activeMidiPadNoteRef.current = null;
    activeScreenPadRef.current = null;
    autoChordPlayedRef.current = true;
    setChordActivity(
      activeChord?.root ?? selectedRoot,
      activeChord?.type ?? selectedType,
      activeChord?.inversion ?? inversion,
      false,
    );
    if (performanceChord) {
      emitPerformanceEvent('end', performanceChord, !latched);
      performanceChordRef.current = null;
    }
  }, [emitPerformanceEvent, inversion, latched, selectedRoot, selectedType, setChordActivity]);

  useEffect(() => {
    const handleWindowBlur = () => {
      if (!latched) releaseAll();
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [latched, releaseAll]);

  useEffect(() => {
    const scaledVelocity = scaleChordVelocity(DEFAULT_CHORD_VELOCITY, inputVolume);
    for (const note of prevNotes.current) {
      audioEngine.updateNoteSourceVelocity(note, scaledVelocity, CHORD_PAD_SOURCE);
    }
  }, [inputVolume]);

  useEffect(() => {
    onSelectionChange?.({ root: selectedRoot, type: selectedType, inversion });
  }, [inversion, onSelectionChange, selectedRoot, selectedType]);

  // When root/type/octave/inversion changes and notes are playing, update the chord
  useEffect(() => {
    if (prevNotes.current.length > 0) {
      const notes = buildChordNotes({ root: selectedRoot, type: selectedType, inversion }, octave);
      if (notesMatch(notes, prevNotes.current)) {
        const activityTimer = window.setTimeout(() => {
          setChordActivity(selectedRoot, selectedType, inversion, true);
        }, 0);
        return () => window.clearTimeout(activityTimer);
      }
      const played = playChord(notes);
      const activityTimer = window.setTimeout(() => {
        setChordActivity(selectedRoot, selectedType, inversion, played);
      }, 0);
      return () => window.clearTimeout(activityTimer);
    }
  }, [selectedRoot, selectedType, octave, inversion, playChord, setChordActivity]);

  useEffect(() => {
    if (!shouldAutoPlayInitialChordRef.current || !streamConnected || autoChordPlayedRef.current) return;

    const notes = buildChordNotes({ root: selectedRoot, type: selectedType, inversion }, octave);
    if (playChord(notes)) {
      autoChordPlayedRef.current = true;
      const activityTimer = window.setTimeout(() => {
        setChordActivity(selectedRoot, selectedType, inversion, true);
      }, 0);
      return () => window.clearTimeout(activityTimer);
    }

    if (autoChordRetry >= MAX_AUTO_CHORD_RETRIES) return;
    const retryTimer = window.setTimeout(() => {
      setAutoChordRetry(retry => retry + 1);
    }, AUTO_CHORD_RETRY_DELAY_MS);

    return () => window.clearTimeout(retryTimer);
  }, [autoChordRetry, inversion, octave, playChord, selectedRoot, selectedType, setChordActivity, streamConnected]);

  const startChord = useCallback((
    root: number,
    type: string,
    nextInversion = inversion,
    velocity = DEFAULT_CHORD_VELOCITY,
  ) => {
    const chord = normalizeChordSpec({ root, type, inversion: nextInversion });
    setSelectedRoot(chord.root);
    setSelectedType(chord.type);
    setInversion(chord.inversion);
    autoChordPlayedRef.current = true;
    performanceChordRef.current = chord;
    activateChord(chord.root, chord.type, chord.inversion, velocity);
    emitPerformanceEvent('start', chord, !latched);
  }, [activateChord, emitPerformanceEvent, inversion, latched]);

  const handleLatchedChordTrigger = useCallback((
    root: number,
    type: string,
    nextInversion = inversion,
    velocity = DEFAULT_CHORD_VELOCITY,
  ) => {
    if (activeChordKey === chordKey(root, type)) {
      releaseAll();
      return;
    }
    startChord(root, type, nextInversion, velocity);
  }, [activeChordKey, inversion, releaseAll, startChord]);

  const handleChordPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, root: number, type: string, nextInversion = inversion) => {
    if (latched || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startChord(root, type, nextInversion);
  };

  const handleChordPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (latched) return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    releaseAll();
  };

  const handleChordKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, root: number, type: string, nextInversion = inversion) => {
    if (latched || event.repeat || !isChordTriggerKey(event.key)) return;

    event.preventDefault();
    startChord(root, type, nextInversion);
  };

  const handleChordKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (latched || !isChordTriggerKey(event.key)) return;

    event.preventDefault();
    releaseAll();
  };

  const editPad = useCallback((index: number) => {
    if (!padEditMode) return false;
    const chord = padEditMode === 'assign'
      ? { root: selectedRoot, type: selectedType, inversion } : null;
    const nextBank = setChordBankPad(chordBank, index, chord);
    setChordBank(nextBank);
    saveChordBank(nextBank);
    setPadEditMode(null);
    return true;
  }, [chordBank, inversion, padEditMode, selectedRoot, selectedType]);

  useEffect(() => {
    if (!padEditMode) return;
    const cancelEdit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPadEditMode(null);
    };
    window.addEventListener('keydown', cancelEdit);
    return () => window.removeEventListener('keydown', cancelEdit);
  }, [padEditMode]);

  useEffect(() => midiService.onNote(event => {
    const triggerId = `${event.isPad ? 'pad' : 'key'}:${event.note}`;
    // Release by identity even if the mode or assignment changed while held.
    if (event.type === 'off' && !latched && activeMidiPadNoteRef.current === triggerId) {
      activeMidiPadNoteRef.current = null;
      releaseAll();
      return;
    }
    if (event.type !== 'on') return;
    if (!event.isPad || !midiPadsEnabled) return;
    const padIndex = MPK_MINI_IV_PAD_INDEX.get(event.note);
    if (padIndex === undefined) return;
    if (editPad(padIndex)) return;
    const chord = chordBank[padIndex];
    if (!chord) return;

    if (event.type === 'on') {
      if (latched) {
        handleLatchedChordTrigger(chord.root, chord.type, chord.inversion);
      } else {
        activeMidiPadNoteRef.current = triggerId;
        startChord(chord.root, chord.type, chord.inversion);
      }
      return;
    }

  }), [chordBank, editPad, handleLatchedChordTrigger, latched, midiPadsEnabled, releaseAll, startChord]);

  const handleLatchToggle = () => {
    if (latched) {
      // Unlatch: release all
      setLatched(false);
      releaseAll();
    } else {
      setLatched(true);
    }
  };

  const chordLabel = getChordLabel({ root: selectedRoot, type: selectedType, inversion });
  const maxInversion = (CHORD_TYPES[selectedType]?.intervals.length || 3) - 1;
  const bankChordsByKey = useMemo(
    () => new Map(chordBank.filter((chord): chord is ChordSpec => chord !== null).map(chord => [chordKey(chord.root, chord.type), chord])),
    [chordBank],
  );
  const handleBuildChordBank = () => {
    setPadEditMode(null);
    const nextBank = buildRelatedChordBank({ root: selectedRoot, type: selectedType, inversion });
    setChordBank(nextBank);
    saveChordBank(nextBank);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-black pb-2">
        <div className="flex h-7 min-w-[60px] items-center justify-center border-2 border-black bg-white px-2 font-mono text-[11px] font-black text-black">
          {chordLabel}
        </div>
        <button
          className={`h-7 border-2 px-2 font-mono text-[10px] font-black uppercase ${
            latched
              ? 'border-black bg-black text-white'
              : 'border-black bg-white text-black hover:bg-black hover:text-white'
          }`}
          onClick={handleLatchToggle}
          aria-pressed={latched}
        >
          {latched ? 'Latch On' : 'Latch Off'}
        </button>
        <button
          type="button"
          className={`h-7 border-2 px-2 font-mono text-[10px] font-black uppercase ${
            tight
              ? 'border-black bg-black text-white'
              : 'border-black bg-white text-black hover:bg-black hover:text-white'
          }`}
          onClick={() => setTight(value => !value)}
          aria-pressed={tight}
          title="Fast attack and short release for chord hits"
        >
          Tight
        </button>
        <div className="flex items-center gap-1 text-[11px] font-black uppercase text-black">
          <button
            className="icon-button flex h-7 w-7 items-center justify-center border-2 border-black p-0"
            onClick={() => {
              const nextInversion = Math.max(0, inversion - 1);
              setInversion(nextInversion);
              if (prevNotes.current.length === 0) {
                rememberChordState(selectedRoot, selectedType, nextInversion, false);
              }
            }}
            aria-label="Decrease chord inversion"
            title="Decrease chord inversion"
          >
            <Minus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <span>Inv {inversion}</span>
          <button
            className="icon-button flex h-7 w-7 items-center justify-center border-2 border-black p-0"
            onClick={() => {
              const nextInversion = Math.min(maxInversion, inversion + 1);
              setInversion(nextInversion);
              if (prevNotes.current.length === 0) {
                rememberChordState(selectedRoot, selectedType, nextInversion, false);
              }
            }}
            aria-label="Increase chord inversion"
            title="Increase chord inversion"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
        <button
          type="button"
          className="ml-auto h-7 border-2 border-black bg-white px-2 font-mono text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
          onClick={handleBuildChordBank}
          title="Build eight chord variations from the selected chord."
        >
          Build Bank From Current
        </button>
        <button
          className="h-7 border-2 border-black bg-white px-2 font-mono text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
          onClick={releaseAll}
        >Release</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Chord pad assignments" className="grid w-[280px] max-w-full shrink-0 auto-rows-[44px] grid-cols-4 gap-1">
          {PAD_DISPLAY_ORDER.map(index => {
            const chord = chordBank[index];
            const label = chord ? getChordLabel(chord) : '—';
            const active = !!chord && activeChordKey === chordKey(chord.root, chord.type);
            return (
              <button
                key={index}
                type="button"
                disabled={!chord && !padEditMode}
                className={`min-w-0 break-words border-2 border-black px-1 py-1 font-mono text-[10px] font-black leading-tight ${
                  active ? 'bg-black text-white' : 'bg-white text-black hover:bg-black hover:text-white'
                }`}
                onClick={() => {
                  if (editPad(index)) return;
                  if (latched && chord) handleLatchedChordTrigger(chord.root, chord.type, chord.inversion);
                }}
                onPointerDown={event => {
                  if (!padEditMode && chord && !latched && event.button === 0) {
                    activeScreenPadRef.current = index;
                    handleChordPointerDown(event, chord.root, chord.type, chord.inversion);
                  }
                }}
                onPointerUp={event => { if (activeScreenPadRef.current === index) handleChordPointerEnd(event); }}
                onPointerCancel={event => { if (activeScreenPadRef.current === index) handleChordPointerEnd(event); }}
                onKeyDown={event => {
                  if (!padEditMode && chord && !latched && !event.repeat && isChordTriggerKey(event.key)) {
                    activeScreenPadRef.current = index;
                    handleChordKeyDown(event, chord.root, chord.type, chord.inversion);
                  }
                }}
                onKeyUp={event => { if (activeScreenPadRef.current === index) handleChordKeyUp(event); }}
                aria-label={`Pad ${index + 1}: ${chord ? label : 'Empty'}`}
                title={chord ? `${NOTE_NAMES[chord.root]} ${CHORD_TYPES[chord.type].label}` : undefined}
                aria-pressed={active}
              >
                <span className="block text-[9px] opacity-60">{index + 1}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          {(['assign', 'clear'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              className={`h-7 border-2 border-black px-2 font-mono text-[10px] font-black uppercase ${padEditMode === mode ? 'bg-black text-white' : 'bg-white text-black hover:bg-black hover:text-white'}`}
              aria-pressed={padEditMode === mode}
              onClick={() => setPadEditMode(current => current === mode ? null : mode)}
            >
              {mode === 'assign' ? 'Assign' : 'Clear'}
            </button>
          ))}
        </div>
      </div>

      {/* Root+chord grid: all 12 roots as rows, common chords as columns */}
      <div className="overflow-x-auto border-2 border-black">
        <div className="min-w-[520px]">
        <div className="flex bg-soft">
          <span className="min-w-[36px] px-1 py-[3px]" aria-hidden="true" />
          {COMMON_CHORD_TYPES.map(type => (
            <span key={type} className="flex-1 px-0.5 py-[3px] text-center text-[9px] font-black text-black">{CHORD_TYPES[type].short || 'M'}</span>
          ))}
        </div>
        {ROOT_NOTES.map(({ name, semitone }) => (
          <div key={semitone} className="flex border-t border-black first:border-t-0">
            <span className={`flex min-w-[36px] items-center justify-center px-1 py-[3px] text-center text-[10px] font-black ${name.includes('#') ? 'bg-black text-white' : 'bg-white text-black'}`}>{name}</span>
            {COMMON_CHORD_TYPES.map(type => {
              const bankChord = bankChordsByKey.get(chordKey(semitone, type));
              const chordInversion = bankChord?.inversion ?? inversion;
              return (
                <button
                  key={type}
                  className={`flex-1 border-l border-black px-0.5 py-1 text-center font-mono text-[9px] font-black ${
                    activeChordKey === chordKey(semitone, type)
                      ? 'bg-black text-white'
                      : bankChord
                        ? 'bg-ground text-black hover:bg-black hover:text-white'
                      : selectedRoot === semitone && selectedType === type
                        ? 'bg-soft text-black hover:bg-black hover:text-white'
                        : 'bg-white text-black hover:bg-black hover:text-white'
                  }`}
                  onClick={() => {
                    if (latched) handleLatchedChordTrigger(semitone, type, chordInversion);
                  }}
                  onPointerDown={event => handleChordPointerDown(event, semitone, type, chordInversion)}
                  onPointerUp={handleChordPointerEnd}
                  onPointerCancel={handleChordPointerEnd}
                  onKeyDown={event => handleChordKeyDown(event, semitone, type, chordInversion)}
                  onKeyUp={handleChordKeyUp}
                  aria-label={`Play ${name} ${CHORD_TYPES[type].label}`}
                  aria-pressed={activeChordKey === chordKey(semitone, type)}
                >
                  {name}{CHORD_TYPES[type].short || ''}
                </button>
              );
            })}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
