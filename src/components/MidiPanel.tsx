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
      <div className="bg-[#141414] rounded-md p-3 mb-2">
        <h3 className="text-[13px] font-semibold mb-2 text-[#aaa]">MIDI</h3>
        <p className="text-[#555]">Web MIDI not available</p>
      </div>
    );
  }

  return (
    <div className="bg-[#141414] rounded-md p-3 mb-2">
      <h3 className="text-[13px] font-semibold mb-2 text-[#aaa]">MIDI</h3>
      <p className="text-[#555] mb-2 text-[10px]">
        Plug in a MIDI keyboard to play. Mod wheel (CC1) controls resonance.
      </p>
      <div className="flex gap-3 items-center mb-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[#888] text-[11px]">
          Input
          <select
            className="bg-[#1a1a1a] border border-[#333] rounded-sm text-[#ddd] font-mono text-[11px] py-[3px] px-1.5"
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
        <label className="flex items-center gap-1.5 text-[#888] text-[11px]">
          Output
          <select
            className="bg-[#1a1a1a] border border-[#333] rounded-sm text-[#ddd] font-mono text-[11px] py-[3px] px-1.5"
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
        {lastCC && <span className="text-[#4a9] text-[10px]">{lastCC}</span>}
      </div>
    </div>
  );
}
