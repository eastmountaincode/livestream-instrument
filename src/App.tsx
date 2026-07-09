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
import { useStreamPlayback } from './hooks/useStreamPlayback';
import { midiService } from './services/MidiService';
import { audioEngine } from './services/AudioEngine';
import { getSavedState, getKeyboardVolume, getChordPadVolume, saveActiveStreams } from './services/storage';
import type { StreamSettings } from './services/storage';
import { fetchAcceptedLiveSources, type LiveSource } from './services/streams';

type PanelKey = 'sources' | 'mixer' | 'keyboard' | 'chords' | 'io' | 'settings';

const DEFAULT_DEMO_SOURCE_IDS = ['locus-usti-nad-labem-duul', 'locus-jasper-ridge'];
const EMPTY_STREAM_SETTINGS: Record<string, Partial<StreamSettings>> = {};
const SOURCE_LOAD_RETRIES = 3;
const SOURCE_LOAD_RETRY_DELAY_MS = 700;
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

function getInitialOpenPanels(): Record<PanelKey, boolean> {
  const compact = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

  return {
    sources: true,
    mixer: !compact,
    keyboard: true,
    chords: !compact,
    io: false,
    settings: false,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function App() {
  const [savedStateOnLoad] = useState(() => getSavedState());
  const restoredStreamsRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>(() => getInitialOpenPanels());
  const [keyboardVolume, setKeyboardVolume] = useState(() => getKeyboardVolume());
  const [chordPadVolume, setChordPadVolume] = useState(() => getChordPadVolume());
  const [availableSources, setAvailableSources] = useState<LiveSource[]>([]);
  const [sourceLoadError, setSourceLoadError] = useState('');
  const [sourcesReady, setSourcesReady] = useState(false);

  const hasSavedStreams = savedStateOnLoad?.activeStreamIds?.length ?? 0;
  const shouldStartDemo = hasSavedStreams === 0;
  const {
    activeIds,
    wantedIds,
    statuses,
    connect,
    disconnect,
  } = useStreamPlayback({
    defaultStreamSettings: shouldStartDemo ? DEFAULT_DEMO_STREAM_SETTINGS : EMPTY_STREAM_SETTINGS,
    onConnected: () => { setLoading(false); },
  });
  const streamConnected = activeIds.size > 0;

  useEffect(() => {
    midiService.init();
  }, []);

  useEffect(() => {
    midiService.setInputVolume(keyboardVolume);
  }, [keyboardVolume]);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;

    async function loadSources() {
      for (let attempt = 1; attempt <= SOURCE_LOAD_RETRIES; attempt++) {
        try {
          const result = await fetchAcceptedLiveSources();

          if (cancelled) return;
          setAvailableSources(result.sources);
          setSourceLoadError('');
          setSourcesReady(true);
          return;
        } catch (error) {
          if (attempt < SOURCE_LOAD_RETRIES) {
            await wait(SOURCE_LOAD_RETRY_DELAY_MS * attempt);
            continue;
          }

          if (cancelled) return;
          setAvailableSources([]);
          setSourceLoadError(error instanceof Error ? error.message : 'Failed to load stream catalog');
          setSourcesReady(true);
        }
      }
    }

    void loadSources();
    return () => {
      cancelled = true;
    };
  }, [started]);

  useEffect(() => {
    if (!started || restoredStreamsRef.current || !sourcesReady) return;
    restoredStreamsRef.current = true;

    const idsToConnect = savedStateOnLoad?.activeStreamIds.length
      ? savedStateOnLoad.activeStreamIds
      : shouldStartDemo
        ? DEFAULT_DEMO_SOURCE_IDS
        : [];

    for (const id of idsToConnect) {
      const source = availableSources.find(s => s.id === id);
      if (source) {
        void connect(source);
      }
    }
  }, [availableSources, connect, savedStateOnLoad, shouldStartDemo, sourcesReady, started]);

  useEffect(() => {
    if (restoredStreamsRef.current) {
      saveActiveStreams(Array.from(wantedIds));
    }
  }, [wantedIds]);

  useEffect(() => {
    if (!started || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = activeIds.size > 0 ? 'playing' : 'none';

    return () => {
      navigator.mediaSession.playbackState = 'none';
    };
  }, [activeIds.size, started]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    void audioEngine.resume().catch(() => undefined);
    setStarted(true);
    setLoading(false);
  }, []);

  const handleRemoveSource = useCallback((sourceId: string) => {
    disconnect(sourceId);
  }, [disconnect]);

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
      <SourceBackdrop activeIds={activeIds} sources={availableSources} />

      <div className="sticky top-0 z-30 border-b border-ink bg-ground/95 backdrop-blur">
        <header className="mx-auto grid max-w-[1120px] grid-cols-[auto_minmax(0,1fr)] items-end gap-2 px-4 py-2 md:grid-cols-[auto_minmax(280px,1fr)] md:py-3">
          <h1 className="brand-title text-2xl leading-none text-copy md:text-5xl">Cicada</h1>
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
              meta={`${activeIds.size}/${availableSources.length}`}
              className={shouldEqualizeTopPanels ? 'h-full' : ''}
              keepMounted
            >
              <StreamSelector
                sources={availableSources}
                sourceLoadError={sourceLoadError}
                sourcesReady={sourcesReady}
                activeIds={activeIds}
                wantedIds={wantedIds}
                statuses={statuses}
                onConnect={connect}
                onDisconnect={disconnect}
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
          meta={`${activeIds.size} Tracks`}
        >
          <Controls
            activeSourceIds={activeIds}
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
            keepMounted
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
