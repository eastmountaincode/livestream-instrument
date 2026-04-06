import { useState, useEffect } from 'react';
import { StreamSelector } from './components/StreamSelector';
import { SourceBackdrop } from './components/SourceBackdrop';
import { Keyboard } from './components/Keyboard';
import { ChordPad } from './components/ChordPad';
import { Visualizer } from './components/Visualizer';
import { Controls } from './components/Controls';
import { MidiPanel } from './components/MidiPanel';
import { WebRTCPanel } from './components/WebRTCPanel';
import { midiService } from './services/MidiService';

function App() {
  const [streamConnected, setStreamConnected] = useState(false);
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set());
  const [showMidi, setShowMidi] = useState(false);
  const [showWebRTC, setShowWebRTC] = useState(false);

  useEffect(() => {
    midiService.init();
  }, []);

  return (
    <div className="relative max-w-[960px] mx-auto p-4">
      <SourceBackdrop activeIds={activeSourceIds} />

      <header className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-semibold text-white">Resonator</h1>
      </header>

      <StreamSelector
        onConnected={() => setStreamConnected(true)}
        onActiveChange={setActiveSourceIds}
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
