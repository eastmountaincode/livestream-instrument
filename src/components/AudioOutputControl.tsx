import { AUDIO_OUTPUT_CHANNELS } from "../services/audioOutput";
import type {
  AudioOutputChannel,
  AudioOutputDevice,
} from '../services/audioOutput';
import { UiButton, UiSelect } from './ui';

export function AudioOutputControl({
  choose,
  channel,
  choosing,
  error,
  onChange,
  onChannelChange,
  outputs,
  selected,
  supported,
}: {
  choose: () => Promise<void>;
  channel: AudioOutputChannel;
  choosing: boolean;
  error: string | null;
  onChange: (deviceId: string) => Promise<void>;
  onChannelChange: (channel: AudioOutputChannel) => Promise<void>;
  outputs: AudioOutputDevice[];
  selected: AudioOutputDevice;
  supported: boolean;
}) {
  if (!supported) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor="audio-output" className="text-[10px] font-semibold uppercase text-copy">
        Audio output
      </label>
      <UiSelect
        id="audio-output"
        className="max-w-52"
        onChange={(event) => void onChange(event.target.value)}
        value={selected.deviceId}
      >
        {outputs.map((output) => (
          <option key={output.deviceId || 'default'} value={output.deviceId}>
            {output.label}
          </option>
        ))}
      </UiSelect>
      <UiButton disabled={choosing} onClick={() => void choose()}>
        {choosing ? 'Choosing…' : 'Choose…'}
      </UiButton>
      <label htmlFor="audio-output-channel" className="text-[10px] font-semibold uppercase text-copy">
        Output channels
      </label>
      <UiSelect
        id="audio-output-channel"
        onChange={(event) => void onChannelChange(event.target.value as AudioOutputChannel)}
        value={channel}
      >
        {AUDIO_OUTPUT_CHANNELS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </UiSelect>
      {error ? (
        <span className="text-[10px] text-copy" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
