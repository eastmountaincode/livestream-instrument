import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { audioEngine } from '../services/AudioEngine';
import type { LiveSource } from '../services/streams';
import { midiService } from '../services/MidiService';
import { TrackWaveform } from './TrackWaveform';
import {
  saveStreamSettings,
  getStreamSettings,
  getMasterVolume,
  getHarmonicEvidenceSettings,
  saveMasterVolume,
  saveKeyboardVolume,
  saveChordPadVolume,
  saveHarmonicEvidenceSettings,
  type HarmonicEvidenceSettings,
} from '../services/storage';
import { formatCategory, formatLocalTime } from '../utils/format';

interface Props {
  activeSourceIds: Set<string>;
  soloId: string | null;
  onSoloChange: (id: string | null) => void;
  sources: LiveSource[];
  keyboardVolume: number;
  chordPadVolume: number;
  onKeyboardVolumeChange: (volume: number) => void;
  onChordPadVolumeChange: (volume: number) => void;
  onRemoveSource: (sourceId: string) => void;
}

const MAX_STREAM_VOLUME = 16;
const MAX_MIDI_STREAM_VOLUME = MAX_STREAM_VOLUME;
const MIN_EQ_FREQ = 20;
const MAX_EQ_FREQ = 20000;

const TRACK_KNOB_CC_GROUPS = [
  [20, 70],
  [2, 21, 71],
  [3, 22, 72],
  [4, 23, 73],
  [5, 24, 74],
  [6, 25, 75],
  [7, 26, 76],
  [8, 27, 77],
];

function getTrackIndexForCc(cc: number): number {
  return TRACK_KNOB_CC_GROUPS.findIndex(group => group.includes(cc));
}

function frequencyToSliderValue(freq: number): number {
  const clamped = Math.max(MIN_EQ_FREQ, Math.min(MAX_EQ_FREQ, freq));
  const minLog = Math.log(MIN_EQ_FREQ);
  const maxLog = Math.log(MAX_EQ_FREQ);
  return ((Math.log(clamped) - minLog) / (maxLog - minLog)) * 100;
}

function sliderValueToFrequency(value: number): number {
  const minLog = Math.log(MIN_EQ_FREQ);
  const maxLog = Math.log(MAX_EQ_FREQ);
  return Math.round(Math.exp(minLog + (value / 100) * (maxLog - minLog)));
}

function formatFrequency(freq: number): string {
  if (freq >= 10000) return `${Math.round(freq / 1000)}k`;
  if (freq >= 1000) return `${(freq / 1000).toFixed(1)}k`;
  return `${Math.round(freq)}`;
}

function formatGain(value: number): string {
  if (value >= 10) return `${value.toFixed(1)}x`;
  if (value >= 1) return `${value.toFixed(2)}x`;
  return `${Math.round(value * 100)}%`;
}

function StreamControls({
  id,
  soloId,
  onSolo,
  externalVolume,
  onManualVolumeChange,
  sources,
  clock,
  onRemoveSource,
}: {
  id: string;
  soloId: string | null;
  onSolo: (id: string | null) => void;
  externalVolume?: number;
  onManualVolumeChange: (id: string) => void;
  sources: LiveSource[];
  clock: Date;
  onRemoveSource: (sourceId: string) => void;
}) {
  const source = sources.find(s => s.id === id);
  const localTime = formatLocalTime(clock, source?.timeZone);
  const categoryLabel = formatCategory(source?.category);
  const initRef = useRef(false);

  // Load saved settings once and use as initial state
  const [saved] = useState(() => getStreamSettings(id));
  const [q, setQ] = useState(() => saved?.filterQ ?? audioEngine.getStreamFilterQ(id));
  const [vol, setVol] = useState(() => saved?.volume ?? audioEngine.getStreamVolume(id));
  const [highPassFreq, setHighPassFreq] = useState(() => saved?.highPassFreq ?? audioEngine.getStreamHighPass(id));
  const [lowPassFreq, setLowPassFreq] = useState(() => saved?.lowPassFreq ?? audioEngine.getStreamLowPass(id));
  const [oct, setOct] = useState(() => saved?.octaveShift ?? audioEngine.getStreamOctave(id));
  const [pan, setPan] = useState(() => saved?.pan ?? audioEngine.getStreamPan(id));
  const [muted, setMuted] = useState(() => saved?.muted ?? audioEngine.getStreamMuted(id));

  // Apply saved settings to audio engine once on mount
  useEffect(() => {
    if (initRef.current || !saved) return;
    initRef.current = true;
    audioEngine.setStreamFilterQ(id, saved.filterQ);
    audioEngine.setStreamVolume(id, saved.volume);
    audioEngine.setStreamHighPass(id, saved.highPassFreq);
    audioEngine.setStreamLowPass(id, saved.lowPassFreq);
    audioEngine.setStreamPan(id, saved.pan);
    audioEngine.setStreamOctave(id, saved.octaveShift);
    audioEngine.setStreamMuted(id, saved.muted);
  }, [id, saved]);

  const persist = useCallback((overrides: Partial<{ filterQ: number; volume: number; highPassFreq: number; lowPassFreq: number; pan: number; octaveShift: number; muted: boolean }>) => {
    saveStreamSettings(id, {
      filterQ: overrides.filterQ ?? q,
      volume: overrides.volume ?? vol,
      highPassFreq: overrides.highPassFreq ?? highPassFreq,
      lowPassFreq: overrides.lowPassFreq ?? lowPassFreq,
      pan: overrides.pan ?? pan,
      octaveShift: overrides.octaveShift ?? oct,
      muted: overrides.muted ?? muted,
    });
  }, [id, q, vol, highPassFreq, lowPassFreq, pan, oct, muted]);

  const displayedVolume = externalVolume ?? vol;

  return (
    <div className="dev-mode dev-mode-coral grid gap-3 bg-soft px-2 py-2.5">
      <div className="dev-mode dev-mode-orange flex min-w-0 flex-wrap items-start gap-2">
        <div className="dev-mode dev-mode-yellow flex min-w-[140px] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="sc-name min-w-0 basis-full whitespace-normal break-words text-[12px] font-black uppercase leading-snug text-black sm:basis-auto">
            {source?.name ?? id}
          </span>
          {source?.location && (
            <span className="shrink-0 text-[10px] font-bold uppercase text-black">{source.location}</span>
          )}
          {localTime && (
            <span className="sc-value shrink-0 border border-black bg-soft px-1.5 py-0.5 text-[10px] font-black text-black">
              {localTime}
            </span>
          )}
          {categoryLabel && (
            <span className="sc-value shrink-0 rounded-full border border-black bg-soft px-2 py-0.5 text-[10px] font-black text-black">
              {categoryLabel}
            </span>
          )}
        </div>
        <div className="dev-mode dev-mode-pink ml-auto flex shrink-0 items-center gap-1 text-[11px] font-black uppercase text-black">
          <div className="dev-mode dev-mode-blue flex items-center gap-1">
            <button
              className="icon-button flex h-7 w-7 items-center justify-center border-2 border-black p-0"
              onClick={() => {
                const next = oct - 1;
                setOct(next);
                audioEngine.setStreamOctave(id, next);
                persist({ octaveShift: next });
              }}
              aria-label="Lower track octave"
              title="Lower track octave"
            >
              <Minus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <span className="min-w-[42px] text-center">Oct {oct >= 0 ? `+${oct}` : oct}</span>
            <button
              className="icon-button flex h-7 w-7 items-center justify-center border-2 border-black p-0"
              onClick={() => {
                const next = oct + 1;
                setOct(next);
                audioEngine.setStreamOctave(id, next);
                persist({ octaveShift: next });
              }}
              aria-label="Raise track octave"
              title="Raise track octave"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <button
            className={`h-7 w-7 shrink-0 border-2 font-mono text-[10px] font-black ${
              soloId === id
                ? 'border-black bg-black text-white'
                : 'border-black bg-white text-black hover:bg-black hover:text-white'
            }`}
            onClick={() => {
              const next = soloId === id ? null : id;
              onSolo(next);
            }}
            aria-label={`Solo ${source?.name ?? id}`}
            aria-pressed={soloId === id}
          >
            S
          </button>
          <button
            className={`h-7 w-7 shrink-0 border-2 font-mono text-[10px] font-black ${
              muted
                ? 'border-black bg-warning text-black'
                : 'border-black bg-white text-black hover:bg-black hover:text-white'
            }`}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              audioEngine.setStreamMuted(id, next);
              persist({ muted: next });
            }}
            aria-label={`Mute ${source?.name ?? id}`}
            aria-pressed={muted}
          >
            M
          </button>
          <button
            type="button"
            className="icon-button flex h-7 w-7 shrink-0 items-center justify-center border-2 border-black p-0"
            onClick={() => onRemoveSource(id)}
            aria-label={`Remove ${source?.name ?? id}`}
            title="Remove track"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <div className="dev-mode dev-mode-cyan grid min-w-0 items-start gap-4 sm:grid-cols-[92px_minmax(0,1fr)]">
        <div className="dev-mode dev-mode-violet w-fit">
          <TrackWaveform id={id} muted={muted} />
        </div>
        <div className="dev-mode dev-mode-indigo grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <label className="dev-mode dev-mode-violet grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black" title="Filter resonance for played notes">
            <span className="sc-label text-[11px] font-black uppercase">Resonance</span>
            <span className="sc-value text-right font-mono text-[11px] font-black text-black">{q.toFixed(0)}</span>
            <input
              type="range"
              min="1"
              max="100"
              step="0.5"
              value={q}
              className="col-span-2 w-full min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                setQ(val);
                audioEngine.setStreamFilterQ(id, val);
                persist({ filterQ: val });
              }}
            />
          </label>
          <label className="dev-mode dev-mode-green grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black" title="Track gain">
            <span className="sc-label text-[11px] font-black uppercase">Volume</span>
            <span className="sc-value text-right font-mono text-[11px] font-black text-black">{formatGain(displayedVolume)}</span>
            <input
              type="range"
              min="0"
              max={MAX_STREAM_VOLUME}
              step="0.01"
              value={displayedVolume}
              className="col-span-2 w-full min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                // A MIDI CC value temporarily drives this controlled input.
                // Once the user moves the slider, hand display ownership back
                // to the component's local state so the handle follows the drag.
                onManualVolumeChange(id);
                setVol(val);
                audioEngine.setStreamVolume(id, val);
                persist({ volume: val });
              }}
            />
          </label>
          <label className="dev-mode dev-mode-blue grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black" title="Stereo position">
            <span className="sc-label text-[11px] font-black uppercase">Pan</span>
            <span className="sc-value text-right font-mono text-[11px] font-black text-black">{pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={pan}
              className="col-span-2 w-full min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                setPan(val);
                audioEngine.setStreamPan(id, val);
                persist({ pan: val });
              }}
            />
          </label>
          <label className="dev-mode dev-mode-orange grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black" title="High-pass filter">
            <span className="sc-label text-[11px] font-black uppercase">High Pass</span>
            <span className="sc-value text-right font-mono text-[11px] font-black text-black">{formatFrequency(highPassFreq)}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={frequencyToSliderValue(highPassFreq)}
              className="col-span-2 w-full min-w-0"
              onChange={e => {
                const next = Math.max(MIN_EQ_FREQ, Math.min(sliderValueToFrequency(parseFloat(e.target.value)), lowPassFreq - 10));
                setHighPassFreq(next);
                audioEngine.setStreamHighPass(id, next);
                persist({ highPassFreq: next });
              }}
            />
          </label>
          <label className="dev-mode dev-mode-yellow grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black" title="Low-pass filter">
            <span className="sc-label text-[11px] font-black uppercase">Low Pass</span>
            <span className="sc-value text-right font-mono text-[11px] font-black text-black">{formatFrequency(lowPassFreq)}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={frequencyToSliderValue(lowPassFreq)}
              className="col-span-2 w-full min-w-0"
              onChange={e => {
                const next = Math.min(MAX_EQ_FREQ, Math.max(sliderValueToFrequency(parseFloat(e.target.value)), highPassFreq + 10));
                setLowPassFreq(next);
                audioEngine.setStreamLowPass(id, next);
                persist({ lowPassFreq: next });
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export function Controls({
  activeSourceIds,
  soloId,
  onSoloChange,
  sources,
  keyboardVolume,
  chordPadVolume,
  onKeyboardVolumeChange,
  onChordPadVolumeChange,
  onRemoveSource,
}: Props) {
  const [masterVolume, setMasterVolume] = useState(() => getMasterVolume());
  const [harmonicEvidenceSettings, setHarmonicEvidenceSettings] = useState(
    () => getHarmonicEvidenceSettings(),
  );
  const [midiMappedVolumes, setMidiMappedVolumes] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(() => new Date());
  const streamIds = useMemo(() => Array.from(activeSourceIds), [activeSourceIds]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    audioEngine.setHarmonicEvidenceSettings(harmonicEvidenceSettings);
    saveHarmonicEvidenceSettings(harmonicEvidenceSettings);
  }, [harmonicEvidenceSettings]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const unsubscribe = midiService.onCC((cc, value) => {
      const trackIndex = getTrackIndexForCc(cc);
      if (trackIndex < 0 || trackIndex >= streamIds.length) return;

      const streamId = streamIds[trackIndex];
      const nextVolume = (value / 127) * MAX_MIDI_STREAM_VOLUME;
      audioEngine.setStreamVolume(streamId, nextVolume);
      saveStreamSettings(streamId, {
        filterQ: audioEngine.getStreamFilterQ(streamId),
        volume: nextVolume,
        highPassFreq: audioEngine.getStreamHighPass(streamId),
        lowPassFreq: audioEngine.getStreamLowPass(streamId),
        pan: audioEngine.getStreamPan(streamId),
        octaveShift: audioEngine.getStreamOctave(streamId),
        muted: audioEngine.getStreamMuted(streamId),
      });
      setMidiMappedVolumes(prev => ({ ...prev, [streamId]: nextVolume }));
    });

    return unsubscribe;
  }, [streamIds]);

  const clearMidiMappedVolume = useCallback((streamId: string) => {
    setMidiMappedVolumes(prev => {
      if (!(streamId in prev)) return prev;

      const next = { ...prev };
      delete next[streamId];
      return next;
    });
  }, []);

  const updateHarmonicEvidenceSettings = useCallback((updates: Partial<HarmonicEvidenceSettings>) => {
    setHarmonicEvidenceSettings(current => ({ ...current, ...updates }));
  }, []);

  return (
    <div className="dev-mode dev-mode-slate flex flex-col gap-1.5">
      {streamIds.length === 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="border-2 border-black bg-black px-2 py-1 text-[11px] font-black uppercase text-white">No Sources Active</span>
        </div>
      )}
      {streamIds.length > 0 && (
        <div className="dev-mode dev-mode-cyan grid gap-2">
          {streamIds.map(id => (
            <StreamControls
              key={id}
              id={id}
              soloId={soloId}
              onSolo={onSoloChange}
              externalVolume={midiMappedVolumes[id]}
              onManualVolumeChange={clearMidiMappedVolume}
              sources={sources}
              clock={clock}
              onRemoveSource={onRemoveSource}
            />
          ))}
        </div>
      )}
      <div className="dev-mode dev-mode-cyan grid gap-3 pt-3">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,240px)_minmax(0,240px)] sm:justify-between">
          <div className="dev-mode dev-mode-indigo grid w-full max-w-[240px] gap-2">
            <label className="dev-mode dev-mode-violet grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black">
              <span className="text-[11px] font-black uppercase">Master</span>
              <span className="text-right font-mono text-[11px] font-black text-black">{Math.round(masterVolume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={masterVolume}
                className="col-span-2 w-full min-w-0"
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  setMasterVolume(val);
                  saveMasterVolume(val);
                }}
              />
            </label>
            <label className="dev-mode dev-mode-green grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black">
              <span className="text-[11px] font-black uppercase">Keys</span>
              <span className="text-right font-mono text-[11px] font-black text-black">{Math.round(keyboardVolume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={keyboardVolume}
                className="col-span-2 w-full min-w-0"
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  onKeyboardVolumeChange(val);
                  saveKeyboardVolume(val);
                }}
              />
            </label>
            <label className="dev-mode dev-mode-blue grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black">
              <span className="text-[11px] font-black uppercase">Chord</span>
              <span className="text-right font-mono text-[11px] font-black text-black">{Math.round(chordPadVolume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={chordPadVolume}
                className="col-span-2 w-full min-w-0"
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  onChordPadVolumeChange(val);
                  saveChordPadVolume(val);
                }}
              />
            </label>
          </div>
          <div className="grid w-full max-w-[240px] gap-2">
              <label
                className="dev-mode dev-mode-violet grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black"
                title="How strongly Harmonic Evidence shapes the played notes"
              >
                <span className="text-[11px] font-black uppercase">Evidence</span>
                <span className="text-right font-mono text-[11px] font-black text-black">
                  {Math.round(harmonicEvidenceSettings.amount * 100)}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  value={harmonicEvidenceSettings.amount * 100}
                  className="col-span-2 w-full min-w-0"
                  onChange={e => updateHarmonicEvidenceSettings({
                    amount: parseFloat(e.target.value) / 100,
                  })}
                />
              </label>
              <label
                className="dev-mode dev-mode-green grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black"
                title="Tilt the surfaced harmonic bands from darker to brighter"
              >
                <span className="text-[11px] font-black uppercase">Color</span>
                <span className="text-right font-mono text-[11px] font-black text-black">
                  {harmonicEvidenceSettings.color === 0
                    ? 'Neutral'
                    : harmonicEvidenceSettings.color < 0
                      ? `${Math.round(Math.abs(harmonicEvidenceSettings.color) * 100)}% Dark`
                      : `${Math.round(harmonicEvidenceSettings.color * 100)}% Bright`}
                </span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={harmonicEvidenceSettings.color * 100}
                  className="col-span-2 w-full min-w-0"
                  onChange={e => updateHarmonicEvidenceSettings({
                    color: parseFloat(e.target.value) / 100,
                  })}
                />
              </label>
              <label
                className="dev-mode dev-mode-blue grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-black"
                title="Move from smoothly averaged evidence to faster reactions"
              >
                <span className="text-[11px] font-black uppercase">Response</span>
                <span className="text-right font-mono text-[11px] font-black text-black">
                  {harmonicEvidenceSettings.response === 0.5
                    ? 'Balanced'
                    : harmonicEvidenceSettings.response < 0.5
                      ? `${Math.round((0.5 - harmonicEvidenceSettings.response) * 200)}% Smooth`
                      : `${Math.round((harmonicEvidenceSettings.response - 0.5) * 200)}% Fast`}
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={harmonicEvidenceSettings.response * 100}
                  className="col-span-2 w-full min-w-0"
                  onChange={e => updateHarmonicEvidenceSettings({
                    response: parseFloat(e.target.value) / 100,
                  })}
                />
              </label>
          </div>
        </div>
      </div>
    </div>
  );
}
