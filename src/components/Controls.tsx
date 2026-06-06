import { useState, useEffect, useCallback, useRef } from 'react';
import { audioEngine } from '../services/AudioEngine';
import type { LiveSource } from '../services/streams';
import { midiService } from '../services/MidiService';
import {
  saveStreamSettings,
  getStreamSettings,
  saveSoloId,
  getSavedState,
  getMasterVolume,
  saveMasterVolume,
  saveKeyboardVolume,
  saveChordPadVolume,
} from '../services/storage';

interface Props {
  activeSourceIds: Set<string>;
  sources: LiveSource[];
  keyboardVolume: number;
  chordPadVolume: number;
  onKeyboardVolumeChange: (volume: number) => void;
  onChordPadVolumeChange: (volume: number) => void;
  onRemoveSource: (sourceId: string) => void;
}

const MAX_STREAM_VOLUME = 16;
const MAX_MIDI_STREAM_VOLUME = MAX_STREAM_VOLUME;

const TRACK_KNOB_CC_GROUPS = [
  [1, 20, 70],
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

function formatLocalTime(date: Date, timeZone?: string): string {
  if (!timeZone) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '';
  }
}

function StreamWaveform({ id, muted }: { id: string; muted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = audioEngine.getStreamAnalyser(id);
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = new Uint8Array(analyser.fftSize);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = muted ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.26)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      ctx.strokeStyle = muted ? 'rgba(0,0,0,0.34)' : '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * canvas.width;
        const y = (data[i] / 255) * canvas.height;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [id, muted]);

  return (
    <canvas
      ref={canvasRef}
      className={`h-10 w-[92px] min-w-[92px] border-2 ${muted ? 'border-black/40 opacity-50' : 'border-black'}`}
      width={92}
      height={40}
    />
  );
}

function StreamControls({
  id,
  index,
  soloId,
  onSolo,
  externalVolume,
  sources,
  clock,
  onRemoveSource,
}: {
  id: string;
  index: number;
  soloId: string | null;
  onSolo: (id: string | null) => void;
  externalVolume?: number;
  sources: LiveSource[];
  clock: Date;
  onRemoveSource: (sourceId: string) => void;
}) {
  const source = sources.find(s => s.id === id);
  const localTime = formatLocalTime(clock, source?.timeZone);
  const initRef = useRef(false);

  // Load saved settings once and use as initial state
  const [saved] = useState(() => getStreamSettings(id));
  const [q, setQ] = useState(() => saved?.filterQ ?? audioEngine.getStreamFilterQ(id));
  const [vol, setVol] = useState(() => saved?.volume ?? audioEngine.getStreamVolume(id));
  const [oct, setOct] = useState(() => saved?.octaveShift ?? audioEngine.getStreamOctave(id));
  const [pan, setPan] = useState(() => saved?.pan ?? audioEngine.getStreamPan(id));
  const [muted, setMuted] = useState(() => saved?.muted ?? audioEngine.getStreamMuted(id));

  // Apply saved settings to audio engine once on mount
  useEffect(() => {
    if (initRef.current || !saved) return;
    initRef.current = true;
    audioEngine.setStreamFilterQ(id, saved.filterQ);
    audioEngine.setStreamVolume(id, saved.volume);
    audioEngine.setStreamPan(id, saved.pan);
    audioEngine.setStreamOctave(id, saved.octaveShift);
    audioEngine.setStreamMuted(id, saved.muted);
  }, [id, saved]);

  useEffect(() => {
    if (externalVolume === undefined) return;
    setVol(externalVolume);
  }, [externalVolume]);

  const persist = useCallback((overrides: Partial<{ filterQ: number; volume: number; pan: number; octaveShift: number; muted: boolean }>) => {
    saveStreamSettings(id, { filterQ: overrides.filterQ ?? q, volume: overrides.volume ?? vol, pan: overrides.pan ?? pan, octaveShift: overrides.octaveShift ?? oct, muted: overrides.muted ?? muted });
  }, [id, q, vol, pan, oct, muted]);

  return (
    <div className={`grid gap-2 border-b-2 border-black py-3 last:border-b-0 ${muted ? '[&_.sc-name]:opacity-40 [&_.sc-label]:opacity-40 [&_.sc-value]:opacity-40' : ''}`}>
      <div className="flex items-start gap-2 min-w-0">
        <span className="w-7 min-w-7 border-2 border-black bg-white px-1 py-0.5 text-center font-mono text-[10px] font-black text-black">T{index + 1}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="sc-name min-w-0 basis-full whitespace-normal break-words text-[12px] font-black uppercase leading-snug text-black sm:basis-auto">
            {source?.name ?? id}
          </span>
          {source?.location && (
            <span className="shrink-0 text-[10px] font-bold uppercase text-black/50">{source.location}</span>
          )}
          {localTime && (
            <span className="shrink-0 border border-black bg-[#f2f0e8] px-1.5 py-0.5 text-[10px] font-black text-black">
              {localTime}
            </span>
          )}
        </div>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-black bg-white p-0 font-mono text-[11px] font-black text-black hover:bg-black hover:text-white"
          onClick={() => onRemoveSource(id)}
          aria-label={`Remove ${source?.name ?? id}`}
          title="Remove track"
        >
          X
        </button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pl-0 sm:pl-9">
        <StreamWaveform id={id} muted={muted} />
        <label className="flex min-w-[140px] flex-1 items-center gap-1 text-black">
          <span className="sc-label min-w-[24px] text-[11px] font-black uppercase">Q</span>
          <input
            type="range"
            min="1"
            max="100"
            step="0.5"
            value={q}
            className="flex-1 min-w-0"
            onChange={e => {
              const val = parseFloat(e.target.value);
              setQ(val);
              audioEngine.setStreamFilterQ(id, val);
              persist({ filterQ: val });
            }}
          />
          <span className="sc-value min-w-[30px] text-right font-mono text-[11px] font-black text-black">{q.toFixed(0)}</span>
        </label>
        <label className="flex min-w-[150px] flex-1 items-center gap-1 text-black">
          <span className="sc-label min-w-[28px] text-[11px] font-black uppercase">Vol</span>
          <input
            type="range"
            min="0"
            max={MAX_STREAM_VOLUME}
            step="0.01"
            value={vol}
            className="flex-1 min-w-0"
            onChange={e => {
              const val = parseFloat(e.target.value);
              setVol(val);
              audioEngine.setStreamVolume(id, val);
              persist({ volume: val });
            }}
          />
          <span className="sc-value min-w-[42px] text-right font-mono text-[11px] font-black text-black">{Math.round(vol * 100)}%</span>
        </label>
        <label className="flex min-w-[140px] flex-1 items-center gap-1 text-black">
          <span className="sc-label min-w-[28px] text-[11px] font-black uppercase">Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={pan}
            className="flex-1 min-w-0"
            onChange={e => {
              const val = parseFloat(e.target.value);
              setPan(val);
              audioEngine.setStreamPan(id, val);
              persist({ pan: val });
            }}
          />
          <span className="sc-value min-w-[34px] text-right font-mono text-[11px] font-black text-black">{pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}</span>
        </label>
        <div className="flex shrink-0 items-center gap-1 text-[11px] font-black uppercase text-black">
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white"
            onClick={() => {
              const next = oct - 1;
              setOct(next);
              audioEngine.setStreamOctave(id, next);
              persist({ octaveShift: next });
            }}
          >-</button>
          <span>Oct {oct >= 0 ? `+${oct}` : oct}</span>
          <button
            className="flex h-6 w-6 items-center justify-center border-2 border-black bg-white p-0 text-xs text-black hover:bg-black hover:text-white"
            onClick={() => {
              const next = oct + 1;
              setOct(next);
              audioEngine.setStreamOctave(id, next);
              persist({ octaveShift: next });
            }}
          >+</button>
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
            audioEngine.setStreamSolo(next);
            saveSoloId(next);
          }}
        >
          S
        </button>
        <button
          className={`h-7 w-7 shrink-0 border-2 font-mono text-[10px] font-black ${
            muted
              ? 'border-black bg-[#f3d85a] text-black'
              : 'border-black bg-white text-black hover:bg-black hover:text-white'
          }`}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            audioEngine.setStreamMuted(id, next);
            persist({ muted: next });
          }}
        >
          M
        </button>
      </div>
    </div>
  );
}

export function Controls({
  activeSourceIds,
  sources,
  keyboardVolume,
  chordPadVolume,
  onKeyboardVolumeChange,
  onChordPadVolumeChange,
  onRemoveSource,
}: Props) {
  const [streamIds, setStreamIds] = useState<string[]>([]);
  const [soloId, setSoloId] = useState<string | null>(() => getSavedState()?.soloId ?? null);
  const [masterVolume, setMasterVolume] = useState(() => getMasterVolume());
  const [midiMappedVolumes, setMidiMappedVolumes] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    setStreamIds(Array.from(activeSourceIds));
    // Clear solo if the soloed stream was removed
    if (soloId && !activeSourceIds.has(soloId)) {
      setSoloId(null);
      audioEngine.setStreamSolo(null);
    }
  }, [activeSourceIds, soloId]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

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
        pan: audioEngine.getStreamPan(streamId),
        octaveShift: audioEngine.getStreamOctave(streamId),
        muted: audioEngine.getStreamMuted(streamId),
      });
      setMidiMappedVolumes(prev => ({ ...prev, [streamId]: nextVolume }));
    });

    return unsubscribe;
  }, [streamIds]);

  return (
    <div className="flex flex-col gap-1.5">
      {streamIds.length === 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="border-2 border-black px-2 py-1 text-[11px] font-black uppercase text-black/55">No sources active</span>
        </div>
      )}
      {streamIds.map((id, index) => (
        <StreamControls
          key={id}
          id={id}
          index={index}
          soloId={soloId}
          onSolo={setSoloId}
          externalVolume={midiMappedVolumes[id]}
          sources={sources}
          clock={clock}
          onRemoveSource={onRemoveSource}
        />
      ))}
      <div className="flex flex-wrap items-start gap-3 border-t-2 border-black pt-3">
        <div className="flex min-w-[280px] flex-1 flex-col gap-2">
          <label className="flex min-w-0 items-center gap-3 text-black">
            <span className="min-w-[64px] text-[11px] font-black uppercase">Master</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.01"
              value={masterVolume}
              className="flex-1 min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                setMasterVolume(val);
                saveMasterVolume(val);
              }}
            />
            <span className="min-w-[56px] text-right font-mono text-[11px] font-black text-black">{Math.round(masterVolume * 100)}%</span>
          </label>
          <label className="flex min-w-0 items-center gap-3 text-black">
            <span className="min-w-[64px] text-[11px] font-black uppercase">Keys</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.01"
              value={keyboardVolume}
              className="flex-1 min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                onKeyboardVolumeChange(val);
                saveKeyboardVolume(val);
              }}
            />
            <span className="min-w-[56px] text-right font-mono text-[11px] font-black text-black">{Math.round(keyboardVolume * 100)}%</span>
          </label>
          <label className="flex min-w-0 items-center gap-3 text-black">
            <span className="min-w-[64px] text-[11px] font-black uppercase">Chord</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.01"
              value={chordPadVolume}
              className="flex-1 min-w-0"
              onChange={e => {
                const val = parseFloat(e.target.value);
                onChordPadVolumeChange(val);
                saveChordPadVolume(val);
              }}
            />
            <span className="min-w-[56px] text-right font-mono text-[11px] font-black text-black">{Math.round(chordPadVolume * 100)}%</span>
          </label>
        </div>
        <button
          className="mt-[1px] border-2 border-black bg-white px-3 py-1 font-mono text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
          onClick={() => audioEngine.allNotesOff()}
        >
          All Notes Off
        </button>
      </div>
    </div>
  );
}
