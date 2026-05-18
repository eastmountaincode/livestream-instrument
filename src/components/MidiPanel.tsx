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
    return (
      <div className="border-2 border-black bg-white p-3">
        <h3 className="mb-2 text-[11px] font-black uppercase text-black">MIDI</h3>
        <p className="m-0 text-[11px] font-bold uppercase text-black/55">Web MIDI not available</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-black bg-white p-3">
      <h3 className="mb-2 text-[11px] font-black uppercase text-black">MIDI</h3>
      <p className="mb-3 text-[10px] font-bold uppercase text-black/55">
        Plug in a MIDI keyboard to play. Mod wheel (CC1) controls resonance.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-black">
          Input
          <select
            className="border-2 border-black bg-white px-1.5 py-[3px] font-mono text-[11px] font-bold text-black"
            value={selectedInput || ''}
            onChange={e => {
              midiService.selectInput(e.target.value || null);
              setSelectedInput(e.target.value || null);
            }}
          >
            <option value="">None</option>
            {inputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-black">
          Output
          <select
            className="border-2 border-black bg-white px-1.5 py-[3px] font-mono text-[11px] font-bold text-black"
            value={selectedOutput || ''}
            onChange={e => {
              midiService.selectOutput(e.target.value || null);
              setSelectedOutput(e.target.value || null);
            }}
          >
            <option value="">None</option>
            {outputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {lastCC && <span className="border-2 border-black bg-[#f3d85a] px-2 py-0.5 font-mono text-[10px] font-black uppercase text-black">{lastCC}</span>}
      </div>
    </div>
  );
}
