import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { StreamSelector } from './components/StreamSelector';
import { SourceBackdrop } from './components/SourceBackdrop';
import { Keyboard } from './components/Keyboard';
import { ChordPad } from './components/ChordPad';
import { Visualizer } from './components/Visualizer';
import { Controls } from './components/Controls';
import { MidiPanel } from './components/MidiPanel';
import { WebRTCPanel } from './components/WebRTCPanel';
import { midiService } from './services/MidiService';
import { audioEngine } from './services/AudioEngine';
import { getSavedState, getKeyboardVolume, getChordPadVolume } from './services/storage';
import type { LiveSource } from './services/streams';

type PanelKey = 'sources' | 'mixer' | 'keyboard' | 'chords' | 'io';

interface PanelProps {
  title: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  meta?: ReactNode;
}

function Panel({ title, label, open, onToggle, children, meta }: PanelProps) {
  return (
    <section className="border-2 border-black bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b-2 border-black bg-white px-3 py-2 text-left text-[11px] font-black uppercase text-black transition-colors hover:bg-black hover:text-white"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="min-w-8 font-mono text-[10px] font-black">{label}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[10px]">
          {meta}
          <span>{open ? 'CLOSE' : 'OPEN'}</span>
        </span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

function App() {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set());
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>({
    sources: true,
    mixer: true,
    keyboard: true,
    chords: false,
    io: false,
  });
  const [keyboardVolume, setKeyboardVolume] = useState(() => getKeyboardVolume());
  const [chordPadVolume, setChordPadVolume] = useState(() => getChordPadVolume());
  const [availableSources, setAvailableSources] = useState<LiveSource[]>([]);
  const removeSourceRef = useRef<((sourceId: string) => void) | null>(null);

  const hasSavedStreams = getSavedState()?.activeStreamIds?.length ?? 0;

  useEffect(() => {
    midiService.init();
  }, []);

  useEffect(() => {
    midiService.setInputVolume(keyboardVolume);
  }, [keyboardVolume]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    await audioEngine.resume();
    setStarted(true);
    // StreamSelector will handle reconnecting saved streams
  }, []);

  const handleRemoveSourceReady = useCallback((removeSource: (sourceId: string) => void) => {
    removeSourceRef.current = removeSource;
  }, []);

  const handleRemoveSource = useCallback((sourceId: string) => {
    removeSourceRef.current?.(sourceId);
  }, []);

  const togglePanel = useCallback((key: PanelKey) => {
    setOpenPanels(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!started) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#f2f0e8] px-4 text-black">
        <div className="border-2 border-black bg-white px-8 py-7 text-center shadow-[8px_8px_0_#000]">
          <h1 className="mb-2 text-4xl font-black uppercase leading-none">Resonator</h1>
          <p className="text-[11px] font-black uppercase tracking-[0.16em]">live-source instrument</p>
        </div>
        <button
          onClick={handleStart}
          disabled={loading}
          className="border-2 border-black bg-white px-8 py-3 text-sm font-black uppercase text-black shadow-[5px_5px_0_#000] transition-transform hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#000] disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? 'connecting...' : hasSavedStreams ? 'Resume Session' : 'Start'}
        </button>
        {hasSavedStreams > 0 && !loading && (
          <p className="text-[11px] font-bold uppercase text-black/55">{hasSavedStreams} saved source{hasSavedStreams > 1 ? 's' : ''} will reconnect</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#f2f0e8] text-black">
      <SourceBackdrop activeIds={activeSourceIds} sources={availableSources} />

      <main className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-4">
        <header className="grid gap-3 border-2 border-black bg-white p-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-4xl font-black uppercase leading-none tracking-normal text-black md:text-6xl">Resonator</h1>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.18em] text-black/60">live-source resonant instrument</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase">
            <span className="border-2 border-black px-2 py-1">{activeSourceIds.size} live</span>
            <span className="border-2 border-black px-2 py-1">{availableSources.length} sources</span>
            <a href="/streams" className="border-2 border-black bg-black px-2 py-1 text-white hover:bg-white hover:text-black">Stream Review</a>
          </div>
        </header>

        <Visualizer />

        <div className="flex flex-col gap-4">
          <Panel
            title="Live Sources"
            label="01"
            open={openPanels.sources}
            onToggle={() => togglePanel('sources')}
            meta={`${activeSourceIds.size}/${availableSources.length}`}
          >
            <StreamSelector
              onConnected={() => { setStreamConnected(true); setLoading(false); }}
              onActiveChange={setActiveSourceIds}
              onSourcesChange={setAvailableSources}
              onRemoveSourceReady={handleRemoveSourceReady}
              autoRestore
            />
          </Panel>

          <Panel
            title="Track Mixer"
            label="02"
            open={openPanels.mixer}
            onToggle={() => togglePanel('mixer')}
            meta={`${activeSourceIds.size} tracks`}
          >
            <Controls
              activeSourceIds={activeSourceIds}
              sources={availableSources}
              keyboardVolume={keyboardVolume}
              chordPadVolume={chordPadVolume}
              onKeyboardVolumeChange={setKeyboardVolume}
              onChordPadVolumeChange={setChordPadVolume}
              onRemoveSource={handleRemoveSource}
            />
          </Panel>

          <Panel
            title="Keyboard"
            label="03"
            open={openPanels.keyboard}
            onToggle={() => togglePanel('keyboard')}
            meta={streamConnected ? 'armed' : 'idle'}
          >
            <Keyboard streamConnected={streamConnected} inputVolume={keyboardVolume} />
          </Panel>

          <Panel
            title="Chord Pad"
            label="04"
            open={openPanels.chords}
            onToggle={() => togglePanel('chords')}
          >
            <ChordPad streamConnected={streamConnected} inputVolume={chordPadVolume} />
          </Panel>

          <Panel
            title="MIDI / WebRTC"
            label="05"
            open={openPanels.io}
            onToggle={() => togglePanel('io')}
          >
            <div className="grid gap-3">
              <MidiPanel />
              <WebRTCPanel />
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}

export default App;
