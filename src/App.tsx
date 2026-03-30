import { useState, useEffect } from 'react';
import { StreamSelector } from './components/StreamSelector';
import { Keyboard } from './components/Keyboard';
import { ChordPad } from './components/ChordPad';
import { Visualizer } from './components/Visualizer';
import { Controls } from './components/Controls';
import { MidiPanel } from './components/MidiPanel';
import { WebRTCPanel } from './components/WebRTCPanel';
import { midiService } from './services/MidiService';
import './App.css';

function App() {
  const [streamConnected, setStreamConnected] = useState(false);
  const [showMidi, setShowMidi] = useState(false);
  const [showWebRTC, setShowWebRTC] = useState(false);

  useEffect(() => {
    midiService.init();
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Live Stream Instrument</h1>
        <span className="subtitle">resonant filters on live audio from the real world</span>
      </header>

      <StreamSelector onConnected={() => setStreamConnected(true)} />

      <Visualizer />

      <Controls />

      <Keyboard streamConnected={streamConnected} />

      <ChordPad streamConnected={streamConnected} />

      <div className="panels-toggle">
        <button className={showMidi ? 'active' : ''} onClick={() => setShowMidi(!showMidi)}>
          MIDI
        </button>
        <button className={showWebRTC ? 'active' : ''} onClick={() => setShowWebRTC(!showWebRTC)}>
          WebRTC
        </button>
      </div>

      {showMidi && <MidiPanel />}
      {showWebRTC && <WebRTCPanel />}
    </div>
  );
}

export default App;
