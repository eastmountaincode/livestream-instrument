import { useCallback, useEffect, useState } from 'react';
import { useAudioOutput } from '../hooks/useAudioOutput';
import { audioEngine } from '../services/AudioEngine';
import type { AudioOutputChannel } from '../services/audioOutput';
import { midiService } from '../services/MidiService';
import {
  clearSavedState,
  getMidiKeyboardEnabled,
  saveMidiKeyboardEnabled,
} from '../services/storage';
import { AudioOutputControl } from './AudioOutputControl';
import { UiButton } from './ui';

export function SettingsPanel() {
  const [midiKeyboardEnabled, setMidiKeyboardEnabled] = useState(
    () => getMidiKeyboardEnabled(),
  );
  const applyAudioOutput = useCallback(
    (deviceId: string) => audioEngine.setOutputDevice(deviceId),
    [],
  );
  const applyAudioOutputChannel = useCallback(
    (channel: AudioOutputChannel) => audioEngine.setOutputChannel(channel),
    [],
  );
  const audioOutput = useAudioOutput(applyAudioOutput, applyAudioOutputChannel);

  useEffect(() => {
    midiService.setKeyboardInputEnabled(midiKeyboardEnabled);
  }, [midiKeyboardEnabled]);

  const toggleMidiKeyboard = () => {
    const enabled = !midiKeyboardEnabled;
    midiService.setKeyboardInputEnabled(enabled);
    setMidiKeyboardEnabled(enabled);
    saveMidiKeyboardEnabled(enabled);
  };

  const clearHistory = () => {
    clearSavedState();
    audioEngine.allNotesOff();
    audioEngine.disconnectAllStreams();
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase text-copy">MPK keys</span>
        <UiButton
          aria-pressed={midiKeyboardEnabled}
          className={midiKeyboardEnabled ? 'bg-ink text-paper' : undefined}
          onClick={toggleMidiKeyboard}
        >
          {midiKeyboardEnabled ? 'On' : 'Off'}
        </UiButton>
      </div>
      <AudioOutputControl
        choose={audioOutput.choose}
        channel={audioOutput.channel}
        choosing={audioOutput.choosing}
        error={audioOutput.error}
        onChange={audioOutput.select}
        onChannelChange={audioOutput.selectChannel}
        outputs={audioOutput.outputs}
        selected={audioOutput.selected}
        supported={audioOutput.supported}
      />
      <UiButton onClick={clearHistory}>
        Clear History
      </UiButton>
    </div>
  );
}
