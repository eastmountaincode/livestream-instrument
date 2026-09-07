import { useRef, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_AUDIO_OUTPUT,
  readAudioOutputChannelPreference,
  readAudioOutputPreference,
  revealAudioOutputs,
  selectNativeAudioOutput,
  supportsAudioOutputRouting,
  supportsNativeAudioOutputPicker,
  type AudioOutputDevice,
  type AudioOutputChannel,
  writeAudioOutputChannelPreference,
  writeAudioOutputPreference,
} from '../services/audioOutput';

function includeSelectedOutput(
  outputs: AudioOutputDevice[],
  selected: AudioOutputDevice,
) {
  if (
    selected.deviceId === '' ||
    outputs.some(({ deviceId }) => deviceId === selected.deviceId)
  ) {
    return outputs;
  }
  return [...outputs, selected];
}

function outputSelectionError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Allow audio access to list output devices.';
  }
  return error instanceof Error
    ? error.message
    : 'Audio outputs could not be opened.';
}

function subscribeToOutputSupport() {
  return () => undefined;
}

export function useAudioOutput(
  applyOutput: (deviceId: string) => Promise<void>,
  applyChannel: (channel: AudioOutputChannel) => void | Promise<void>,
) {
  const pending = useRef(Promise.resolve());
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const next = pending.current.then(operation);
    pending.current = next.catch(() => undefined);
    return next;
  }, []);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<AudioOutputDevice[]>([
    DEFAULT_AUDIO_OUTPUT,
  ]);
  const [selected, setSelected] = useState<AudioOutputDevice>(DEFAULT_AUDIO_OUTPUT);
  const [channel, setChannel] = useState<AudioOutputChannel>('stereo');
  const channelRef = useRef<AudioOutputChannel>("stereo");
  const supported = useSyncExternalStore(
    subscribeToOutputSupport,
    supportsAudioOutputRouting,
    () => false,
  );

  useEffect(() => {
    if (!supported) return;
    let active = true;

    void enqueue(async () => {
      if (!active) return;
      const stored = readAudioOutputPreference(window.localStorage);
      const storedChannel = readAudioOutputChannelPreference(window.localStorage);
      setSelected(stored);
      setChannel(storedChannel);
      channelRef.current = storedChannel;
      setOutputs((current) => includeSelectedOutput(current, stored));
      try {
        await applyOutput(stored.deviceId);
        if (active) await applyChannel(storedChannel);
      } catch (selectionError) {
        if (active) setError(outputSelectionError(selectionError));
      }
    });

    return () => {
      active = false;
    };
  }, [applyChannel, applyOutput, enqueue, supported]);

  useEffect(() => {
    if (!supported || !selected.deviceId) return;
    const checkDevice = () => {
      void enqueue(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.some((device) => device.kind === "audiooutput" && device.deviceId === selected.deviceId)) return;
        try {
          await applyOutput(selected.deviceId);
        } catch {
          // The engine disconnects its output before attempting the missing sink.
        }
        setError("Output unavailable. Choose an audio device to resume.");
      }).catch((error) => setError(outputSelectionError(error)));
    };
    navigator.mediaDevices.addEventListener("devicechange", checkDevice);
    return () => navigator.mediaDevices.removeEventListener("devicechange", checkDevice);
  }, [applyOutput, enqueue, selected.deviceId, supported]);

  const commitOutput = useCallback(
    (output: AudioOutputDevice) => enqueue(async () => {
      await applyOutput(output.deviceId);
      setSelected(output);
      setOutputs((current) => includeSelectedOutput(current, output));
      writeAudioOutputPreference(window.localStorage, output);
      await applyChannel(channelRef.current);
      setError(null);
    }),
    [applyChannel, applyOutput, enqueue],
  );

  const choose = useCallback(async () => {
    if (!supported || choosing) return;
    setChoosing(true);
    setError(null);
    try {
      if (supportsNativeAudioOutputPicker()) {
        const output = await selectNativeAudioOutput();
        if (output) await commitOutput(output);
        return;
      }

      const available = await revealAudioOutputs();
      setOutputs(includeSelectedOutput(available, selected));
      if (available.some(({ deviceId }) => deviceId === selected.deviceId)) {
        await commitOutput(selected);
      }
      if (available.length === 1) {
        setError('No additional audio outputs were found.');
      }
    } catch (selectionError) {
      setError(outputSelectionError(selectionError));
    } finally {
      setChoosing(false);
    }
  }, [choosing, commitOutput, selected, supported]);

  const select = useCallback(
    async (deviceId: string) => {
      const output = outputs.find((option) => option.deviceId === deviceId);
      if (!output) return;
      setError(null);
      try {
        await commitOutput(output);
      } catch (selectionError) {
        setError(outputSelectionError(selectionError));
      }
    },
    [commitOutput, outputs],
  );

  const selectChannel = useCallback(
    (nextChannel: AudioOutputChannel) => enqueue(async () => {
      try {
        await applyChannel(nextChannel);
        setChannel(nextChannel);
        channelRef.current = nextChannel;
        writeAudioOutputChannelPreference(window.localStorage, nextChannel);
        setError(null);
      } catch (selectionError) {
        setError(outputSelectionError(selectionError));
      }
    }),
    [applyChannel, enqueue],
  );

  return {
    channel,
    choose,
    choosing,
    error,
    outputs,
    select,
    selectChannel,
    selected,
    supported,
  };
}
