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
  const [lastNote, setLastNote] = useState('');

  useEffect(() => {
    midiService.init().then(ok => {
      setAvailable(ok);
      if (ok) refreshDevices();
    });

    const unsub = midiService.onChange(() => refreshDevices());
    const unsubCC = midiService.onCC((cc, val) => {
      setLastCC(`CC${cc} = ${val}`);
    });
    const unsubNote = midiService.onNote(event => {
      setLastNote(event.type === 'on' ? `Note ${event.note} On` : `Note ${event.note} Off`);
    });

    return () => { unsub(); unsubCC(); unsubNote(); };
  }, []);

  const refreshDevices = () => {
    const nextInputs = midiService.getInputs();
    setInputs(nextInputs);
    setOutputs(midiService.getOutputs());
    const currentInputId = midiService.getSelectedInputId();
    if (!currentInputId && nextInputs.length > 0) {
      midiService.selectInput(nextInputs[0].id);
      setSelectedInput(nextInputs[0].id);
    } else {
      setSelectedInput(currentInputId);
    }
    setSelectedOutput(midiService.getSelectedOutputId());
  };

  const selectedInputName = inputs.find(input => input.id === selectedInput)?.name;

  if (!available) {
    return (
      <div className="grid gap-2">
        <h3 className="m-0 text-[11px] font-semibold uppercase text-[#171717]">MIDI</h3>
        <p className="m-0 text-[11px] font-medium uppercase text-[#68645c]">Web MIDI not available</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <h3 className="m-0 text-[11px] font-semibold uppercase text-[#171717]">MIDI</h3>
      <p className="m-0 text-[10px] font-medium uppercase text-[#68645c]">
        Plug in a MIDI keyboard to play. Mod wheel (CC1) controls resonance.
      </p>
      <div className="flex min-h-[24px] flex-wrap gap-1">
        <span className={`border border-[#242424] px-2 py-0.5 text-[10px] font-semibold uppercase ${
          inputs.length > 0 ? 'bg-[#242424] text-[#fbfaf6]' : 'bg-[#d8cfb7] text-[#171717]'
        }`}>
          {inputs.length > 0 ? `${inputs.length} Input${inputs.length > 1 ? 's' : ''} Detected` : 'No Input Detected'}
        </span>
        {selectedInputName && (
          <span className="border border-[#242424] bg-[#fbfaf6] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">
            {selectedInputName}
          </span>
        )}
        {lastNote && <span className="border border-[#242424] bg-[#d8cfb7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">{lastNote}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[#171717]">
          Input
          <select
            className="border border-[#242424] bg-[#fbfaf6] px-1.5 py-[3px] font-mono text-[11px] font-medium text-[#171717]"
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
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[#171717]">
          Output
          <select
            className="border border-[#242424] bg-[#fbfaf6] px-1.5 py-[3px] font-mono text-[11px] font-medium text-[#171717]"
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
        {lastCC && <span className="border border-[#242424] bg-[#d8cfb7] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#171717]">{lastCC}</span>}
      </div>
    </div>
  );
}
