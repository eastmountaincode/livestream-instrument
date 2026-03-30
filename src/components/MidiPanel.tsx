import { useState, useEffect } from 'react';
import { midiService } from '../services/MidiService';
import type { MidiDeviceInfo } from '../services/MidiService';

export function MidiPanel() {
  const [inputs, setInputs] = useState<MidiDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MidiDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [lastCC, setLastCC] = useState('');

  useEffect(() => {
    midiService.init().then(ok => {
      setAvailable(ok);
      if (ok) refreshDevices();
    });

    const unsub = midiService.onChange(() => refreshDevices());
    const unsubCC = midiService.onCC((cc, val) => {
      setLastCC(`cc${cc} = ${val}`);
    });

    return () => { unsub(); unsubCC(); };
  }, []);

  const refreshDevices = () => {
    setInputs(midiService.getInputs());
    setOutputs(midiService.getOutputs());
    setSelectedInput(midiService.getSelectedInputId());
    setSelectedOutput(midiService.getSelectedOutputId());
  };

  if (!available) {
    return <div className="panel midi-panel"><h3>MIDI</h3><p className="dim">Web MIDI not available</p></div>;
  }

  return (
    <div className="panel midi-panel">
      <h3>MIDI</h3>
      <p className="dim" style={{ marginBottom: 8, fontSize: 10 }}>
        Plug in a MIDI keyboard to play. Mod wheel (CC1) controls resonance.
      </p>
      <div className="midi-row">
        <label>
          Input
          <select value={selectedInput || ''} onChange={e => {
            midiService.selectInput(e.target.value || null);
            setSelectedInput(e.target.value || null);
          }}>
            <option value="">None</option>
            {inputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Output
          <select value={selectedOutput || ''} onChange={e => {
            midiService.selectOutput(e.target.value || null);
            setSelectedOutput(e.target.value || null);
          }}>
            <option value="">None</option>
            {outputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {lastCC && <span className="midi-monitor">{lastCC}</span>}
      </div>
    </div>
  );
}
