import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import {
  getChordSequencerState,
  saveChordSequencerState,
  type ChordSequenceEvent,
  type SequencerClockSource,
} from '../services/storage';
import { webrtcService } from '../services/WebRTCService';
import {
  buildChordNotes,
  DEFAULT_CHORD_VELOCITY,
  getChordLabel,
  normalizeChordSpec,
  scaleChordVelocity,
  type ChordPerformanceEvent,
  type ChordSpec,
} from '../music/chords';
import { cx, UiButton } from './ui';

const SEQUENCER_SOURCE = 'chord-sequencer';
const STEP_GROUP_SIZE = 16;
const MAX_STEPS = 64;
const MIDI_CLOCKS_PER_STEP = 6;
const DEFAULT_GATE = 0.5;
const DEFAULT_VELOCITY = DEFAULT_CHORD_VELOCITY;

interface Props {
  streamConnected: boolean;
  inputVolume: number;
  selectedChord: ChordSpec;
  performanceEvent: ChordPerformanceEvent | null;
  clockSource: SequencerClockSource;
}

interface RecordedHold {
  step: number;
  startedAt: number;
  chord: ChordSpec;
}

interface ActiveSequenceNotes {
  notes: number[];
  acceptedNotes: number[];
}

function cloneEvent(event: ChordSequenceEvent): ChordSequenceEvent {
  return { ...event, chord: { ...event.chord } };
}

function cloneSteps(steps: Array<ChordSequenceEvent | null>): Array<ChordSequenceEvent | null> {
  return steps.map(event => event ? cloneEvent(event) : null);
}

function findCoveringOrigin(steps: Array<ChordSequenceEvent | null>, index: number): number | null {
  for (let candidate = index; candidate >= 0; candidate--) {
    const event = steps[candidate];
    if (event && candidate + event.tieSteps >= index) return candidate;
  }
  return null;
}

function placeEvent(
  steps: Array<ChordSequenceEvent | null>,
  index: number,
  event: ChordSequenceEvent,
): Array<ChordSequenceEvent | null> {
  const next = cloneSteps(steps);

  for (let candidate = 0; candidate < index; candidate++) {
    const previous = next[candidate];
    if (previous && candidate + previous.tieSteps >= index) {
      previous.tieSteps = Math.max(0, index - candidate - 1);
    }
  }

  next[index] = cloneEvent(event);
  return next;
}

function getMaximumTieSteps(
  steps: Array<ChordSequenceEvent | null>,
  index: number,
  patternLength: number,
): number {
  let maximum = Math.max(0, patternLength - index - 1);
  for (let candidate = index + 1; candidate < patternLength; candidate++) {
    if (steps[candidate]) {
      maximum = candidate - index - 1;
      break;
    }
  }
  return maximum;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function notesMatch(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((note, index) => note === right[index]);
}

interface DraftIntegerInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'min' | 'max' | 'step' | 'onChange' | 'onBlur' | 'onKeyDown'
> {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

function DraftIntegerInput({ value, min, max, onCommit, ...inputProps }: DraftIntegerInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const skipNextBlurCommitRef = useRef(false);

  const commit = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }

    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const next = clampInteger(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      {...inputProps}
      type="number"
      min={min}
      max={max}
      step="1"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          skipNextBlurCommitRef.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ChordSequencer({
  streamConnected,
  inputVolume,
  selectedChord,
  performanceEvent,
  clockSource,
}: Props) {
  const [initialState] = useState(() => getChordSequencerState());
  const [steps, setSteps] = useState(() => cloneSteps(initialState.steps));
  const [bpm, setBpm] = useState(initialState.bpm);
  const [patternLength, setPatternLength] = useState(initialState.length);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [follow, setFollow] = useState(true);
  const [page, setPage] = useState(0);
  const [currentStep, setCurrentStep] = useState(-1);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [externalBpm, setExternalBpm] = useState<number | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const stepsRef = useRef(steps);
  const bpmRef = useRef(bpm);
  const patternLengthRef = useRef(patternLength);
  const clockSourceRef = useRef(clockSource);
  const playingRef = useRef(false);
  const recordingRef = useRef(false);
  const followRef = useRef(follow);
  const currentStepRef = useRef(-1);
  const selectedStepRef = useRef<number | null>(null);
  const selectedChordRef = useRef(selectedChord);
  const inputVolumeRef = useRef(inputVolume);
  const streamConnectedRef = useRef(streamConnected);
  const clockPulseRef = useRef(0);
  const lastExternalClockAtRef = useRef<number | null>(null);
  const externalStepDurationRef = useRef(125);
  const noteOffTimerRef = useRef<number | null>(null);
  const activeNotesRef = useRef<ActiveSequenceNotes>({ notes: [], acceptedNotes: [] });
  const recordedHoldRef = useRef<RecordedHold | null>(null);
  const midiHeldNoteRef = useRef<number | null>(null);
  const processedPerformanceEventRef = useRef(0);
  const historyRef = useRef<Array<Array<ChordSequenceEvent | null>>>([]);

  const currentChordLabel = getChordLabel(selectedChord);
  const selectedEvent = selectedStep === null ? null : steps[selectedStep];
  const maximumSelectedTie = selectedStep === null
    ? 0
    : getMaximumTieSteps(steps, selectedStep, patternLength);
  const editorEvent = selectedEvent ?? {
    chord: normalizeChordSpec(selectedChord),
    gate: DEFAULT_GATE,
    tieSteps: 0,
    velocity: DEFAULT_VELOCITY,
  };
  const activePageCount = Math.max(1, Math.ceil(patternLength / STEP_GROUP_SIZE));

  useEffect(() => {
    inputVolumeRef.current = inputVolume;
  }, [inputVolume]);

  useEffect(() => {
    streamConnectedRef.current = streamConnected;
  }, [streamConnected]);

  useEffect(() => {
    selectedChordRef.current = selectedChord;
  }, [selectedChord]);

  useEffect(() => {
    saveChordSequencerState({ bpm, length: patternLength, clockSource, steps });
  }, [bpm, clockSource, patternLength, steps]);

  const commitSteps = useCallback((next: Array<ChordSequenceEvent | null>) => {
    if (next === stepsRef.current) return;
    historyRef.current = [...historyRef.current.slice(-29), stepsRef.current];
    setCanUndo(true);
    stepsRef.current = next;
    setSteps(next);
  }, []);

  const releaseSequenceChord = useCallback(() => {
    if (noteOffTimerRef.current !== null) {
      window.clearTimeout(noteOffTimerRef.current);
      noteOffTimerRef.current = null;
    }

    for (const note of activeNotesRef.current.acceptedNotes) {
      webrtcService.sendNoteOff(note);
    }
    for (const note of activeNotesRef.current.notes) {
      midiService.sendNoteOff(note);
    }

    audioEngine.allNotesOff(SEQUENCER_SOURCE);
    activeNotesRef.current = { notes: [], acceptedNotes: [] };
  }, []);

  const getStepDurationMs = useCallback(() => {
    if (clockSourceRef.current === 'midi') return externalStepDurationRef.current;
    return 60_000 / bpmRef.current / 4;
  }, []);

  const playSequenceEvent = useCallback((event: ChordSequenceEvent, sustainsAcrossLoop: boolean) => {
    const notes = buildChordNotes(event.chord);
    if (sustainsAcrossLoop && notesMatch(activeNotesRef.current.notes, notes)) {
      if (noteOffTimerRef.current !== null) {
        window.clearTimeout(noteOffTimerRef.current);
        noteOffTimerRef.current = null;
      }
      return;
    }

    releaseSequenceChord();

    const acceptedNotes: number[] = [];
    const internalVelocity = scaleChordVelocity(event.velocity, inputVolumeRef.current);

    for (const note of notes) {
      if (streamConnectedRef.current && audioEngine.noteOn(note, internalVelocity, SEQUENCER_SOURCE)) {
        acceptedNotes.push(note);
        webrtcService.sendNoteOn(note, event.velocity);
      }
      midiService.sendNoteOn(note, event.velocity);
    }

    activeNotesRef.current = { notes, acceptedNotes };
    if (sustainsAcrossLoop) return;

    const durationMs = Math.max(12, (event.tieSteps + event.gate) * getStepDurationMs());
    noteOffTimerRef.current = window.setTimeout(releaseSequenceChord, durationMs);
  }, [getStepDurationMs, releaseSequenceChord]);

  const showStep = useCallback((index: number) => {
    const normalizedIndex = Math.min(patternLengthRef.current - 1, Math.max(0, index));
    currentStepRef.current = normalizedIndex;
    setCurrentStep(normalizedIndex);
    if (followRef.current) setPage(Math.floor(normalizedIndex / STEP_GROUP_SIZE));

    const event = stepsRef.current[normalizedIndex];
    if (event) {
      const sustainsAcrossLoop = normalizedIndex === 0
        && event.tieSteps >= patternLengthRef.current - 1;
      playSequenceEvent(event, sustainsAcrossLoop);
    }
  }, [playSequenceEvent]);

  const advanceStep = useCallback(() => {
    const next = (currentStepRef.current + 1 + patternLengthRef.current) % patternLengthRef.current;
    showStep(next);
  }, [showStep]);

  const beginPlayback = useCallback((restart: boolean, broadcastTransport: boolean) => {
    if (restart || currentStepRef.current < 0) {
      clockPulseRef.current = 0;
      showStep(0);
    }

    playingRef.current = true;
    setPlaying(true);

    if (broadcastTransport && clockSourceRef.current === 'internal') {
      if (restart) midiService.sendStart();
      else midiService.sendContinue();
    }
  }, [showStep]);

  const stopPlayback = useCallback((broadcastTransport: boolean) => {
    playingRef.current = false;
    setPlaying(false);
    recordedHoldRef.current = null;
    releaseSequenceChord();
    if (broadcastTransport && clockSourceRef.current === 'internal') midiService.sendStop();
  }, [releaseSequenceChord]);

  useEffect(() => {
    if (clockSourceRef.current === clockSource) return;
    if (playingRef.current) stopPlayback(clockSourceRef.current === 'internal');
    clockSourceRef.current = clockSource;
    setExternalBpm(null);
    lastExternalClockAtRef.current = null;
    clockPulseRef.current = 0;
  }, [clockSource, stopPlayback]);

  useEffect(() => {
    if (!playing || clockSource !== 'internal') return;

    let timerId = 0;
    let nextPulseAt = performance.now() + 60_000 / bpmRef.current / 24;

    const tick = () => {
      const now = performance.now();
      let catchUp = 0;
      while (now >= nextPulseAt && catchUp < 12) {
        midiService.sendClock();
        clockPulseRef.current += 1;
        if (clockPulseRef.current % MIDI_CLOCKS_PER_STEP === 0) advanceStep();
        nextPulseAt += 60_000 / bpmRef.current / 24;
        catchUp += 1;
      }
      timerId = window.setTimeout(tick, Math.max(4, nextPulseAt - performance.now()));
    };

    timerId = window.setTimeout(tick, Math.max(4, nextPulseAt - performance.now()));
    return () => window.clearTimeout(timerId);
  }, [advanceStep, clockSource, playing]);

  useEffect(() => {
    const unsubscribeClock = midiService.onClock(event => {
      if (clockSourceRef.current !== 'midi') return;

      const previousClockAt = lastExternalClockAtRef.current;
      lastExternalClockAtRef.current = event.receivedAt;
      if (previousClockAt !== null) {
        const pulseDuration = Math.max(1, event.receivedAt - previousClockAt);
        externalStepDurationRef.current = externalStepDurationRef.current * 0.8 + pulseDuration * 6 * 0.2;
      }
      if (!playingRef.current) return;

      clockPulseRef.current += 1;
      if (clockPulseRef.current % MIDI_CLOCKS_PER_STEP === 0) {
        const estimatedBpm = 60_000 / (externalStepDurationRef.current * 4);
        setExternalBpm(estimatedBpm);
        advanceStep();
      }
    });

    const unsubscribeTransport = midiService.onTransport(event => {
      if (clockSourceRef.current !== 'midi') return;
      if (event.type === 'start') beginPlayback(true, false);
      if (event.type === 'continue') beginPlayback(false, false);
      if (event.type === 'stop') stopPlayback(false);
    });

    return () => {
      unsubscribeClock();
      unsubscribeTransport();
    };
  }, [advanceStep, beginPlayback, stopPlayback]);

  useEffect(() => () => {
    releaseSequenceChord();
    midiService.sendStop();
  }, [releaseSequenceChord]);

  const finalizeRecordedHold = useCallback((endedAt: number) => {
    const hold = recordedHoldRef.current;
    if (!hold) return;

    const durationInSteps = Math.max(0.05, (endedAt - hold.startedAt) / getStepDurationMs());
    let tieSteps = Math.floor(durationInSteps);
    let gate = durationInSteps - tieSteps;
    if (tieSteps === 0) {
      gate = Math.min(0.99, Math.max(0.05, gate));
    } else if (gate < 0.05) {
      tieSteps -= 1;
      gate = 0.99;
    }

    tieSteps = Math.min(
      tieSteps,
      getMaximumTieSteps(stepsRef.current, hold.step, patternLengthRef.current),
    );

    const existing = stepsRef.current[hold.step];
    if (existing) {
      const next = cloneSteps(stepsRef.current);
      next[hold.step] = { ...existing, gate, tieSteps };
      commitSteps(next);
    }
    recordedHoldRef.current = null;
  }, [commitSteps, getStepDurationMs]);

  useEffect(() => {
    if (!performanceEvent || performanceEvent.id === processedPerformanceEventRef.current) return;
    processedPerformanceEventRef.current = performanceEvent.id;
    if (!recordingRef.current) return;

    if (performanceEvent.type === 'start') {
      if (recordedHoldRef.current) finalizeRecordedHold(performanceEvent.occurredAt);
      const targetStep = playingRef.current
        ? Math.max(0, currentStepRef.current)
        : selectedStepRef.current ?? 0;
      const nextEvent: ChordSequenceEvent = {
        chord: normalizeChordSpec(performanceEvent.chord),
        gate: DEFAULT_GATE,
        tieSteps: 0,
        velocity: DEFAULT_VELOCITY,
      };
      commitSteps(placeEvent(stepsRef.current, targetStep, nextEvent));
      selectedStepRef.current = targetStep;
      setSelectedStep(targetStep);
      setPage(Math.floor(targetStep / STEP_GROUP_SIZE));
      recordedHoldRef.current = performanceEvent.momentary
        ? { step: targetStep, startedAt: performanceEvent.occurredAt, chord: performanceEvent.chord }
        : null;
      return;
    }

    if (performanceEvent.type === 'end') finalizeRecordedHold(performanceEvent.occurredAt);
  }, [commitSteps, finalizeRecordedHold, performanceEvent]);

  useEffect(() => midiService.onNote(event => {
    if (!recordingRef.current) return;

    if (event.type === 'on') {
      if (recordedHoldRef.current) finalizeRecordedHold(performance.now());
      const targetStep = playingRef.current
        ? Math.max(0, currentStepRef.current)
        : selectedStepRef.current ?? 0;
      const chord = normalizeChordSpec({
        ...selectedChordRef.current,
        root: event.note % 12,
      });
      const nextEvent: ChordSequenceEvent = {
        chord,
        gate: DEFAULT_GATE,
        tieSteps: 0,
        velocity: event.velocity || DEFAULT_VELOCITY,
      };
      commitSteps(placeEvent(stepsRef.current, targetStep, nextEvent));
      selectedStepRef.current = targetStep;
      setSelectedStep(targetStep);
      setPage(Math.floor(targetStep / STEP_GROUP_SIZE));
      recordedHoldRef.current = { step: targetStep, startedAt: performance.now(), chord };
      midiHeldNoteRef.current = event.note;
      return;
    }

    if (midiHeldNoteRef.current === event.note) {
      finalizeRecordedHold(performance.now());
      midiHeldNoteRef.current = null;
    }
  }), [commitSteps, finalizeRecordedHold]);

  const updateSelectedEvent = useCallback((patch: Partial<ChordSequenceEvent>) => {
    const index = selectedStepRef.current;
    if (index === null) return;
    const event = stepsRef.current[index];
    if (!event) return;
    const next = cloneSteps(stepsRef.current);
    next[index] = { ...event, ...patch, chord: patch.chord ? normalizeChordSpec(patch.chord) : event.chord };
    commitSteps(next);
  }, [commitSteps]);

  const handleStepClick = (index: number) => {
    const origin = findCoveringOrigin(stepsRef.current, index);
    if (origin !== null) {
      if (selectedStepRef.current === origin) {
        const next = cloneSteps(stepsRef.current);
        next[origin] = null;
        commitSteps(next);
        selectedStepRef.current = null;
        setSelectedStep(null);
        return;
      }

      selectedStepRef.current = origin;
      setSelectedStep(origin);
      return;
    }

    const event: ChordSequenceEvent = {
      chord: normalizeChordSpec(selectedChord),
      gate: DEFAULT_GATE,
      tieSteps: 0,
      velocity: DEFAULT_VELOCITY,
    };
    commitSteps(placeEvent(stepsRef.current, index, event));
    selectedStepRef.current = index;
    setSelectedStep(index);
  };

  const handleLengthChange = (value: number) => {
    const nextLength = clampInteger(value, 1, MAX_STEPS);
    patternLengthRef.current = nextLength;
    setPatternLength(nextLength);
    const lastPage = Math.max(0, Math.ceil(nextLength / STEP_GROUP_SIZE) - 1);
    setPage(current => Math.min(current, lastPage));
    if (currentStepRef.current >= nextLength) {
      currentStepRef.current = 0;
      setCurrentStep(0);
    }
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    stepsRef.current = previous;
    setSteps(previous);
    setCanUndo(historyRef.current.length > 0);
  };

  const clearPattern = () => {
    commitSteps(Array.from({ length: MAX_STEPS }, () => null));
    selectedStepRef.current = null;
    setSelectedStep(null);
    stopPlayback(true);
  };

  const pageSteps = useMemo(
    () => Array.from({ length: STEP_GROUP_SIZE }, (_, offset) => page * STEP_GROUP_SIZE + offset),
    [page],
  );

  return (
    <div className="dev-mode dev-mode-slate grid gap-2">
      <div className="dev-mode dev-mode-orange flex flex-wrap items-end gap-2 border-b border-ink pb-2">
        <UiButton
          className={playing ? '!bg-ink !text-paper' : ''}
          onClick={() => beginPlayback(true, true)}
          aria-pressed={playing}
        >
          Play
        </UiButton>
        <UiButton onClick={() => stopPlayback(true)}>Stop</UiButton>
        <UiButton
          className={recording ? '!bg-warning !text-copy' : ''}
          onClick={() => {
            const next = !recordingRef.current;
            recordingRef.current = next;
            setRecording(next);
            if (!next) recordedHoldRef.current = null;
          }}
          aria-pressed={recording}
        >
          Record
        </UiButton>

        <label className="grid gap-1 font-mono text-[9px] font-semibold uppercase text-muted">
          BPM
          <DraftIntegerInput
            key={`bpm-${clockSource}-${clockSource === 'midi' && externalBpm ? Math.round(externalBpm) : Math.round(bpm)}`}
            min={30}
            max={300}
            value={clockSource === 'midi' && externalBpm ? Math.round(externalBpm) : Math.round(bpm)}
            disabled={clockSource === 'midi'}
            className="h-7 w-[64px] border border-ink bg-paper px-2 text-[10px] font-semibold text-copy disabled:bg-surface"
            onCommit={next => {
              bpmRef.current = next;
              setBpm(next);
            }}
          />
        </label>

        <label className="grid gap-1 font-mono text-[9px] font-semibold uppercase text-muted">
          Length
          <DraftIntegerInput
            key={`pattern-length-${patternLength}`}
            min={1}
            max={64}
            value={patternLength}
            className="h-7 w-[56px] border border-ink bg-paper px-2 text-[10px] font-semibold text-copy"
            onCommit={handleLengthChange}
          />
        </label>

        <UiButton
          className={follow ? '!bg-ink !text-paper' : ''}
          onClick={() => {
            const next = !followRef.current;
            followRef.current = next;
            setFollow(next);
          }}
          aria-pressed={follow}
        >
          Follow
        </UiButton>

        <span
          className="flex h-7 items-center px-1 font-mono text-[10px] font-semibold text-copy"
          aria-label={`Currently selected chord: ${currentChordLabel}`}
        >
          Currently selected chord: {currentChordLabel}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <UiButton onClick={undo} disabled={!canUndo}>Undo</UiButton>
          <UiButton onClick={clearPattern}>Clear</UiButton>
        </div>
      </div>

      <div className="dev-mode dev-mode-yellow flex flex-wrap items-center gap-1">
        {Array.from({ length: 4 }, (_, group) => {
          const start = group * STEP_GROUP_SIZE + 1;
          const end = start + STEP_GROUP_SIZE - 1;
          return (
            <button
              key={group}
              type="button"
              className={cx(
                'border border-ink px-2 py-1 font-mono text-[9px] font-semibold uppercase disabled:opacity-30',
                page === group ? 'bg-ink text-paper' : 'bg-paper text-copy hover:bg-ink hover:text-paper',
              )}
              onClick={() => setPage(group)}
              disabled={group >= activePageCount}
              aria-pressed={page === group}
            >
              {start}–{end}
            </button>
          );
        })}
      </div>

      <div className="dev-mode dev-mode-cyan grid grid-cols-4 gap-1 sm:grid-cols-8 lg:grid-cols-16">
        {pageSteps.map(index => {
          const insidePattern = index < patternLength;
          const origin = insidePattern ? findCoveringOrigin(steps, index) : null;
          const event = origin === null ? null : steps[origin];
          const isOnset = origin === index;
          const isContinuation = origin !== null && origin !== index;
          const isCurrent = playing && currentStep === index;
          const isSelected = selectedStep === origin && origin !== null;

          return (
            <button
              key={index}
              type="button"
              className={cx(
                'sequencer-step relative grid min-h-14 content-between border px-1.5 py-1.5 text-left font-mono outline-none transition-none',
                isSelected && 'sequencer-step-selected',
                !insidePattern && 'border-ink/25 bg-surface text-muted opacity-35',
                insidePattern && !event && 'border-ink bg-paper text-copy hover:bg-soft',
                insidePattern && isOnset && 'border-ink bg-accent text-copy',
                insidePattern && isContinuation && 'border-ink bg-accent text-copy',
                isCurrent && '!bg-warning !text-copy',
              )}
              disabled={!insidePattern}
              onClick={() => handleStepClick(index)}
              aria-label={event
                ? `Step ${index + 1}: ${isOnset ? getChordLabel(event.chord) : `tie from step ${origin! + 1}`}`
                : `Step ${index + 1}: empty, assign ${currentChordLabel}`}
              aria-pressed={isOnset}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="text-[9px] font-semibold opacity-70">{index + 1}</span>
              <span className="truncate text-[10px] font-semibold">
                {event ? (isOnset ? getChordLabel(event.chord) : '...') : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="dev-mode dev-mode-indigo border-t border-ink pt-2">
        <div>
          <div
            className={cx('grid grid-cols-3 gap-2', !selectedEvent && 'invisible')}
            aria-hidden={!selectedEvent}
          >
            <label className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-[9px] font-semibold uppercase text-muted">
              <span>Gate</span>
              <span className="font-mono text-[10px] text-copy">{Math.round(editorEvent.gate * 100)}%</span>
              <input
                type="range"
                min="5"
                max="99"
                step="1"
                value={Math.round(editorEvent.gate * 100)}
                className="col-span-2 w-full"
                disabled={!selectedEvent}
                onChange={event => updateSelectedEvent({ gate: Number(event.target.value) / 100 })}
              />
            </label>

            <label className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-[9px] font-semibold uppercase text-muted">
              <span>Length</span>
              <span className="font-mono text-[10px] text-copy">{editorEvent.tieSteps + 1} Steps</span>
              <DraftIntegerInput
                key={`event-length-${selectedStep}-${editorEvent.tieSteps + 1}`}
                min={1}
                max={maximumSelectedTie + 1}
                value={editorEvent.tieSteps + 1}
                aria-label="Event length in steps"
                className="col-span-2 h-8 w-full border border-ink bg-paper px-2 font-mono text-[11px] font-semibold text-copy max-sm:h-10"
                disabled={!selectedEvent}
                onCommit={nextLength => updateSelectedEvent({ tieSteps: nextLength - 1 })}
              />
            </label>

            <label className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-[9px] font-semibold uppercase text-muted">
              <span>Velocity</span>
              <span className="font-mono text-[10px] text-copy">{editorEvent.velocity}</span>
              <input
                type="range"
                min="1"
                max="127"
                step="1"
                value={editorEvent.velocity}
                className="col-span-2 w-full"
                disabled={!selectedEvent}
                onChange={event => updateSelectedEvent({ velocity: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>
      </div>

      {!streamConnected && (
        <p className="m-0 border border-ink bg-highlight px-2 py-1 text-[10px] font-semibold uppercase text-muted">
          Select a live source for internal playback. A selected MIDI output can still receive the sequence.
        </p>
      )}
    </div>
  );
}
