import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { StreamSelector } from './components/StreamSelector';
import { SourceBackdrop } from './components/SourceBackdrop';
import { Keyboard } from './components/Keyboard';
import { ChordPad } from './components/ChordPad';
import { Visualizer } from './components/Visualizer';
import { Controls } from './components/Controls';
import { MidiPanel } from './components/MidiPanel';
import { WebRTCPanel } from './components/WebRTCPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { midiService } from './services/MidiService';
import { audioEngine } from './services/AudioEngine';
import { getSavedState, getKeyboardVolume, getChordPadVolume } from './services/storage';
import type { StreamSettings } from './services/storage';
import type { LiveSource } from './services/streams';

type PanelKey = 'sources' | 'mixer' | 'keyboard' | 'chords' | 'io' | 'settings';

const DEFAULT_DEMO_SOURCE_IDS = ['locus-seoul-gusan', 'locus-jasper-ridge'];
const DEFAULT_DEMO_STREAM_SETTINGS: Record<string, Partial<StreamSettings>> = {
  'locus-seoul-gusan': {
    filterQ: 46,
    volume: 14.87,
    pan: -0.34,
    octaveShift: 0,
  },
  'locus-jasper-ridge': {
    filterQ: 65,
    volume: 11.53,
    pan: 0.34,
    octaveShift: 0,
  },
};

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
    <section className="border border-[#242424] bg-[#fbfaf6]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-[#242424] bg-[#eeece3] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[#171717] hover:bg-[#242424] hover:text-[#fbfaf6]"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="min-w-8 font-mono text-[10px] font-semibold">{label}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-semibold">
          {meta}
          <span>{open ? 'Close' : 'Open'}</span>
        </span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

function App() {
  const savedStateOnLoadRef = useRef(getSavedState());
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set());
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>({
    sources: true,
    mixer: true,
    keyboard: true,
    chords: true,
    io: false,
    settings: false,
  });
  const [keyboardVolume, setKeyboardVolume] = useState(() => getKeyboardVolume());
  const [chordPadVolume, setChordPadVolume] = useState(() => getChordPadVolume());
  const [availableSources, setAvailableSources] = useState<LiveSource[]>([]);
  const removeSourceRef = useRef<((sourceId: string) => void) | null>(null);

  const hasSavedStreams = savedStateOnLoadRef.current?.activeStreamIds?.length ?? 0;
  const shouldStartDemo = hasSavedStreams === 0;

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
      <div className="instrument-ui flex min-h-screen flex-col items-center justify-center gap-6 bg-[#ebe8de] px-4 text-[#171717]">
        <div className="border border-[#242424] bg-[#fbfaf6] px-8 py-7 text-center">
          <h1 className="brand-title text-4xl leading-none">Cicada</h1>
        </div>
        <button
          onClick={handleStart}
          disabled={loading}
          className="border border-[#242424] bg-[#fbfaf6] px-8 py-3 text-sm font-semibold uppercase text-[#171717] hover:bg-[#242424] hover:text-[#fbfaf6] disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? 'Connecting...' : hasSavedStreams ? 'Resume Session' : 'Start'}
        </button>
        {hasSavedStreams > 0 && !loading && (
          <p className="text-[11px] font-semibold uppercase text-[#66635d]">{hasSavedStreams} saved source{hasSavedStreams > 1 ? 's' : ''} will reconnect</p>
        )}
      </div>
    );
  }

  return (
    <div className="instrument-ui relative min-h-screen bg-[#ebe8de] text-[#171717]">
      <SourceBackdrop activeIds={activeSourceIds} sources={availableSources} />

      <main className="mx-auto flex max-w-[1120px] flex-col gap-3 px-4 py-4">
        <header className="grid gap-3 border border-[#242424] bg-[#fbfaf6] p-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="brand-title text-3xl leading-none text-[#171717] md:text-5xl">Cicada</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase">
            <span className="border border-[#242424] px-2 py-1">{activeSourceIds.size} Live</span>
            <span className="border border-[#242424] px-2 py-1">{availableSources.length} Sources</span>
          </div>
        </header>

        <Visualizer />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="lg:w-[340px] lg:shrink-0">
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
                defaultSourceIds={shouldStartDemo ? DEFAULT_DEMO_SOURCE_IDS : []}
                defaultStreamSettings={shouldStartDemo ? DEFAULT_DEMO_STREAM_SETTINGS : {}}
                autoRestore
              />
            </Panel>
          </div>

          <div className={openPanels.keyboard ? 'lg:min-w-0 lg:flex-1' : 'lg:w-[260px] lg:shrink-0'}>
            <Panel
              title="Keyboard"
              label="03"
              open={openPanels.keyboard}
              onToggle={() => togglePanel('keyboard')}
              meta={streamConnected ? 'Armed' : 'Idle'}
            >
              <Keyboard streamConnected={streamConnected} inputVolume={keyboardVolume} />
            </Panel>
          </div>
        </div>

        <Panel
          title="Track Mixer"
          label="02"
          open={openPanels.mixer}
          onToggle={() => togglePanel('mixer')}
          meta={`${activeSourceIds.size} Tracks`}
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

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel
            title="Chord Pad"
            label="04"
            open={openPanels.chords}
            onToggle={() => togglePanel('chords')}
          >
            <ChordPad streamConnected={streamConnected} inputVolume={chordPadVolume} autoPlayDefaultChord={shouldStartDemo} />
          </Panel>

          <Panel
            title="MIDI / Sync"
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

        <Panel
          title="Settings"
          label="06"
          open={openPanels.settings}
          onToggle={() => togglePanel('settings')}
        >
          <SettingsPanel />
        </Panel>
      </main>
    </div>
  );
}

export default App;
