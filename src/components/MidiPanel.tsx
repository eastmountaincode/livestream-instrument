import { useState, useEffect } from 'react';
import { midiService } from '../services/MidiService';
import type { MidiDeviceInfo } from '../services/MidiService';
import { Badge, SectionHeading, UiSelect } from './ui';

export function MidiPanel() {
  const [inputs, setInputs] = useState<MidiDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MidiDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [lastCC, setLastCC] = useState('');
  const [lastNote, setLastNote] = useState('');
  const [lastPitchBend, setLastPitchBend] = useState('');
  const [lastMessage, setLastMessage] = useState('');

  useEffect(() => {
    midiService.migrateRuntimeState?.();

    midiService.init().then(ok => {
      setAvailable(ok);
      if (ok) refreshDevices();
    });

    const unsub = midiService.onChange(() => refreshDevices());
    const unsubCC = midiService.onCC((cc, val) => {
      setLastCC(`CC${cc} = ${val}`);
    });
    const unsubMessage = midiService.onMessage(event => {
      const source = event.inputName ? `${event.inputName} ` : '';
      setLastMessage(`${source}${event.label}: ${event.data.join(' ')}`);
    });
    const unsubNote = midiService.onNote(event => {
      setLastNote(event.type === 'on' ? `Note ${event.note} On` : `Note ${event.note} Off`);
    });
    const unsubPitchBend = midiService.onPitchBend(event => {
      const semitones = event.semitones >= 0 ? `+${event.semitones.toFixed(2)}` : event.semitones.toFixed(2);
      setLastPitchBend(`Bend ${semitones}`);
    });

    return () => {
      unsub();
      unsubCC();
      unsubMessage();
      unsubNote();
      unsubPitchBend();
    };
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
        <SectionHeading>MIDI</SectionHeading>
        <p className="m-0 text-[11px] font-medium uppercase text-muted">Web MIDI not available</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <SectionHeading>MIDI</SectionHeading>
      <p className="m-0 text-[10px] font-medium uppercase text-muted">
        Plug in a MIDI keyboard to play.
      </p>
      <div className="flex min-h-[24px] flex-wrap gap-1">
        <Badge tone={inputs.length > 0 ? 'active' : 'muted'}>
          {inputs.length > 0 ? `${inputs.length} Input${inputs.length > 1 ? 's' : ''} Detected` : 'No Input Detected'}
        </Badge>
        {selectedInputName && (
          <Badge>
            {selectedInputName}
          </Badge>
        )}
        {lastNote && <Badge tone="muted">{lastNote}</Badge>}
        {lastPitchBend && <Badge tone="muted" className="font-mono">{lastPitchBend}</Badge>}
        {lastMessage && <Badge tone="muted" className="font-mono">{lastMessage}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-copy">
          Input
          <UiSelect
            value={selectedInput || ''}
            onChange={e => {
              midiService.selectInput(e.target.value || null);
              setSelectedInput(e.target.value || null);
            }}
          >
            <option value="">None</option>
            {inputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </UiSelect>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-copy">
          Output
          <UiSelect
            value={selectedOutput || ''}
            onChange={e => {
              midiService.selectOutput(e.target.value || null);
              setSelectedOutput(e.target.value || null);
            }}
          >
            <option value="">None</option>
            {outputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </UiSelect>
        </label>
        {lastCC && <Badge tone="muted" className="font-mono">{lastCC}</Badge>}
      </div>
    </div>
  );
}
