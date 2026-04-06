import { useState, useEffect, useCallback } from 'react';
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
import { getSavedState } from './services/storage';

function App() {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set());
  const [showMidi, setShowMidi] = useState(false);
  const [showWebRTC, setShowWebRTC] = useState(false);

  const hasSavedStreams = getSavedState()?.activeStreamIds?.length ?? 0;

  useEffect(() => {
    midiService.init();
  }, []);

  const handleStart = useCallback(async () => {
    setLoading(true);
    await audioEngine.resume();
    setStarted(true);
    // StreamSelector will handle reconnecting saved streams
  }, []);

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-2xl font-semibold text-white/40">Resonator</h1>
        <button
          onClick={handleStart}
          disabled={loading}
          className="px-8 py-3 border border-[#333] rounded-md bg-[#1a1a1a] text-white/70 font-mono text-sm cursor-pointer hover:bg-[#252525] hover:text-white hover:border-[#555] transition-all duration-200 disabled:opacity-50 disabled:cursor-wait"
        >
          {loading ? 'connecting...' : hasSavedStreams ? 'Resume Session' : 'Start'}
        </button>
        {hasSavedStreams > 0 && !loading && (
          <p className="text-[11px] text-white/20">{hasSavedStreams} saved source{hasSavedStreams > 1 ? 's' : ''} will reconnect</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative max-w-[960px] mx-auto p-4">
      <SourceBackdrop activeIds={activeSourceIds} />

      <header className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-semibold text-white">Resonator</h1>
      </header>

      <StreamSelector
        onConnected={() => { setStreamConnected(true); setLoading(false); }}
        onActiveChange={setActiveSourceIds}
        autoRestore
      />

      <Visualizer />

      <Controls activeSourceIds={activeSourceIds} />

      <Keyboard streamConnected={streamConnected} />

      <ChordPad streamConnected={streamConnected} />

      <div className="flex gap-2 mb-2">
        <button
          className={`px-4 py-1.5 border rounded font-mono text-[11px] font-semibold cursor-pointer ${showMidi ? 'bg-[#1a2a3a] border-[#3a5a7a] text-[#8ab]' : 'bg-[#141414] border-[#2a2a2a] text-[#666]'}`}
          onClick={() => setShowMidi(!showMidi)}
        >
          MIDI
        </button>
        <button
          className={`px-4 py-1.5 border rounded font-mono text-[11px] font-semibold cursor-pointer ${showWebRTC ? 'bg-[#1a2a3a] border-[#3a5a7a] text-[#8ab]' : 'bg-[#141414] border-[#2a2a2a] text-[#666]'}`}
          onClick={() => setShowWebRTC(!showWebRTC)}
        >
          WebRTC
        </button>
      </div>

      {showMidi && <MidiPanel />}
      {showWebRTC && <WebRTCPanel />}
    </div>
  );
}

export default App;
