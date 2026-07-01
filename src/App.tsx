import { useState, useEffect, useCallback, useRef } from 'react';
import { StreamSelector } from './components/StreamSelector';
import { SourceBackdrop } from './components/SourceBackdrop';
import { Keyboard } from './components/Keyboard';
import { ChordPad } from './components/ChordPad';
import { Visualizer } from './components/Visualizer';
import { Controls } from './components/Controls';
import { MidiPanel } from './components/MidiPanel';
import { WebRTCPanel } from './components/WebRTCPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Panel } from './components/ui';
import { midiService } from './services/MidiService';
import { audioEngine } from './services/AudioEngine';
import { getSavedState, getKeyboardVolume, getChordPadVolume } from './services/storage';
import type { StreamSettings } from './services/storage';
import type { LiveSource } from './services/streams';

type PanelKey = 'sources' | 'mixer' | 'keyboard' | 'chords' | 'io' | 'settings';

const DEFAULT_DEMO_SOURCE_IDS = ['locus-usti-nad-labem-duul', 'locus-jasper-ridge'];
const DEFAULT_DEMO_STREAM_SETTINGS: Record<string, Partial<StreamSettings>> = {
  'locus-usti-nad-labem-duul': {
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
      <div className="instrument-ui flex min-h-screen flex-col items-center justify-center gap-6 bg-ground px-4 text-copy">
        <div className="border border-ink bg-paper px-8 py-7 text-center">
          <h1 className="brand-title text-4xl leading-none">Cicada</h1>
        </div>
        <button
          onClick={handleStart}
          disabled={loading}
          className="border border-ink bg-paper px-8 py-3 text-sm font-semibold uppercase text-copy hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? 'Connecting...' : hasSavedStreams ? 'Resume Session' : 'Start'}
        </button>
        {hasSavedStreams > 0 && !loading && (
          <p className="text-[11px] font-semibold uppercase text-muted-strong">{hasSavedStreams} saved source{hasSavedStreams > 1 ? 's' : ''} will reconnect</p>
        )}
      </div>
    );
  }

  const shouldEqualizeTopPanels = openPanels.sources && openPanels.keyboard;

  return (
    <div className="instrument-ui relative min-h-screen bg-ground text-copy">
      <SourceBackdrop activeIds={activeSourceIds} sources={availableSources} />

      <div className="sticky top-0 z-30 border-b border-ink bg-ground/95 backdrop-blur">
        <header className="mx-auto grid max-w-[1120px] gap-2 px-4 py-3 md:grid-cols-[auto_minmax(280px,1fr)] md:items-end">
          <h1 className="brand-title text-3xl leading-none text-copy md:text-5xl">Cicada</h1>
          <Visualizer />
        </header>
      </div>

      <main className="mx-auto flex max-w-[1120px] flex-col gap-3 px-4 pb-4 pt-3">
        <div className={`flex flex-col gap-3 lg:flex-row ${shouldEqualizeTopPanels ? 'lg:items-stretch' : 'lg:items-start'}`}>
          <div className="flex lg:w-[340px] lg:shrink-0">
            <Panel
              title="Live Sources"
              label="01"
              open={openPanels.sources}
              onToggle={() => togglePanel('sources')}
              meta={`${activeSourceIds.size}/${availableSources.length}`}
              className={shouldEqualizeTopPanels ? 'h-full' : ''}
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

          <div className="flex lg:min-w-0 lg:flex-1">
            <Panel
              title="Keyboard"
              label="03"
              open={openPanels.keyboard}
              onToggle={() => togglePanel('keyboard')}
              className={shouldEqualizeTopPanels ? 'h-full' : ''}
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
            className="self-start"
          >
            <ChordPad streamConnected={streamConnected} inputVolume={chordPadVolume} autoPlayDefaultChord={shouldStartDemo} />
          </Panel>

          <Panel
            title="MIDI / Sync"
            label="05"
            open={openPanels.io}
            onToggle={() => togglePanel('io')}
            className="self-start"
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
