export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

export type AudioOutputChannel = "stereo" | "left" | "right" | "pair-3" | "pair-5" | "pair-7" | "pair-9" | "pair-11" | "pair-13" | "pair-15";

export const AUDIO_OUTPUT_CHANNELS: { value: AudioOutputChannel; label: string }[] = [
  { value: "stereo", label: "1–2 (Stereo)" },
  ...([3, 5, 7, 9, 11, 13, 15] as const).map((start) => ({
    value: `pair-${start}` as AudioOutputChannel, label: `${start}–${start + 1}`,
  })),
  { value: "left", label: "Channel 1 (Mono)" },
  { value: "right", label: "Channel 2 (Mono)" },
];

export const DEFAULT_AUDIO_OUTPUT = {
  deviceId: '',
  label: 'System default',
} satisfies AudioOutputDevice;

const AUDIO_OUTPUT_STORAGE_KEY = 'cicada.audio-output.v1';
const AUDIO_OUTPUT_CHANNEL_STORAGE_KEY = 'cicada.audio-output-channel.v1';

interface AudioOutputDeviceLike {
  deviceId: string;
  kind: string;
  label: string;
}

type AudioContextWithSink = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type MediaDevicesWithOutputPicker = MediaDevices & {
  selectAudioOutput?: (
    options?: { deviceId?: string },
  ) => Promise<MediaDeviceInfo>;
};

export function audioOutputOptions(
  devices: Iterable<AudioOutputDeviceLike>,
): AudioOutputDevice[] {
  const options = [DEFAULT_AUDIO_OUTPUT];
  const seen = new Set(['', 'default']);
  let unnamedCount = 0;

  for (const device of devices) {
    if (device.kind !== 'audiooutput' || seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    unnamedCount += 1;
    options.push({
      deviceId: device.deviceId,
      label: device.label.trim() || `Audio output ${unnamedCount}`,
    });
  }

  return options;
}

export function supportsAudioOutputRouting() {
  return (
    typeof AudioContext !== 'undefined' &&
    'setSinkId' in AudioContext.prototype &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.enumerateDevices === 'function'
  );
}

export function supportsNativeAudioOutputPicker() {
  if (typeof navigator === 'undefined') return false;
  const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined;
  return typeof mediaDevices?.selectAudioOutput === 'function';
}

export async function selectNativeAudioOutput() {
  const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined;
  if (!mediaDevices?.selectAudioOutput) return null;
  const selected = await mediaDevices.selectAudioOutput();
  return {
    deviceId: selected.deviceId,
    label: selected.label.trim() || 'Audio output',
  };
}

async function enumerateAudioOutputs() {
  return audioOutputOptions(await navigator.mediaDevices.enumerateDevices());
}

export async function revealAudioOutputs() {
  const alreadyVisible = await enumerateAudioOutputs();
  if (
    alreadyVisible.length > 1 &&
    alreadyVisible.slice(1).every(({ label }) => !label.startsWith('Audio output '))
  ) {
    return alreadyVisible;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    return await enumerateAudioOutputs();
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

export async function setAudioContextOutput(context: AudioContext, deviceId: string) {
  const setSinkId = (context as AudioContextWithSink).setSinkId;
  if (typeof setSinkId !== 'function') {
    if (deviceId === '') return;
    throw new Error('Audio output selection is unavailable in this browser.');
  }

  try {
    await setSinkId.call(context, deviceId);
  } catch {
    throw new Error('That audio output is unavailable. Choose it again.');
  }
}

export function readAudioOutputPreference(
  storage: Pick<Storage, 'getItem'>,
): AudioOutputDevice {
  try {
    const stored = storage.getItem(AUDIO_OUTPUT_STORAGE_KEY);
    if (!stored) return DEFAULT_AUDIO_OUTPUT;
    const parsed = JSON.parse(stored) as Partial<AudioOutputDevice>;
    if (
      typeof parsed.deviceId !== 'string' ||
      typeof parsed.label !== 'string' ||
      parsed.label.trim() === ''
    ) {
      return DEFAULT_AUDIO_OUTPUT;
    }
    return {
      deviceId: parsed.deviceId,
      label: parsed.label,
    };
  } catch {
    return DEFAULT_AUDIO_OUTPUT;
  }
}

export function writeAudioOutputPreference(
  storage: Pick<Storage, 'setItem'>,
  output: AudioOutputDevice,
) {
  storage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify(output));
}

export function readAudioOutputChannelPreference(
  storage: Pick<Storage, 'getItem'>,
): AudioOutputChannel {
  try {
    const stored = storage.getItem(AUDIO_OUTPUT_CHANNEL_STORAGE_KEY);
    return AUDIO_OUTPUT_CHANNELS.find(({ value }) => value === stored)?.value ?? "stereo";
  } catch {
    return 'stereo';
  }
}

export function writeAudioOutputChannelPreference(
  storage: Pick<Storage, 'setItem'>,
  channel: AudioOutputChannel,
) {
  storage.setItem(AUDIO_OUTPUT_CHANNEL_STORAGE_KEY, channel);
}
