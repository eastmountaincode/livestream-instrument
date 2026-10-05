import { setAudioContextOutput, type AudioOutputChannel } from "./audioOutput";

export function outputChannelIndices(
  channel: AudioOutputChannel,
): [number, number] {
  const start = channel.startsWith("pair-") ? Number(channel.slice(5)) - 1 : 0;
  if (!Number.isInteger(start) || start < 0 || start > 14 || start % 2 !== 0) {
    throw new Error("Invalid output pair.");
  }
  return [start, start + 1];
}

/** A stereo bus mapped to discrete hardware channels, with silence elsewhere. */
export function createAudioOutputRouter(context: BaseAudioContext) {
  const input = context.createGain();
  // Duplicate a mono voice onto both sides without changing its source or gain.
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const panner = context.createStereoPanner();
  const splitter = context.createChannelSplitter(2);
  const peakCeiling = context.createWaveShaper();
  // After optional mono folding, before discrete hardware channel mapping.
  // No oversampling: interpolation after a clip could create new overshoots.
  peakCeiling.oversample = "none";
  let merger: ChannelMergerNode | null = null;
  let selected: AudioOutputChannel = "stereo";
  let changingDevice = false;
  let deviceReady = true;
  let connected = false;
  let recoverable = false;
  let disposed = false;
  let deviceOperation: Promise<void> = Promise.resolve();
  let recovery: Promise<void> | null = null;
  let lastRecoveryAt = -Infinity;
  let fault: string | null = null;
  const reportFault = (reason: string | null) => {
    if (fault === reason) return;
    fault = reason;
    if (reason) console.warn('[Cicada audio output]', reason);
    else console.info('[Cicada audio output] Connection restored');
  };
  let expectedSinkId =
    (context as AudioContext & { sinkId?: string }).sinkId ?? "";

  const mute = () => {
    connected = false;
    input.disconnect();
    panner.disconnect();
    peakCeiling.disconnect();
    splitter.disconnect();
    merger?.disconnect();
    merger = null;
  };

  const setChannel = (channel: AudioOutputChannel) => {
    selected = channel;
    mute();
    if (!deviceReady || disposed)
      throw new Error("Output muted: choose an available audio device first.");
    const [left, right] = outputChannelIndices(channel);
    const destination = context.destination;
    // Offline contexts have a fixed output width and report maxChannelCount = 0.
    const capacity = destination.maxChannelCount || destination.channelCount;
    if (right >= capacity) {
      throw new Error(
        `Output muted: channels ${left + 1}–${right + 1} are unavailable on this device. Choose an available pair.`,
      );
    }
    try {
      if (destination.maxChannelCount > 0) {
        destination.channelCount = Math.min(16, capacity);
      }
      destination.channelInterpretation = "discrete";
      merger = context.createChannelMerger(destination.channelCount);
      merger.channelInterpretation = "discrete";
      if (channel === "left" || channel === "right") {
        // Preserve mono panner gain: do not duplicate mono before hard panning.
        input.channelCountMode = "max";
        panner.pan.setValueAtTime(
          channel === "left" ? -1 : 1,
          context.currentTime,
        );
        input.connect(panner).connect(peakCeiling).connect(splitter);
      } else {
        input.channelCountMode = "explicit";
        input.connect(peakCeiling).connect(splitter);
      }
      splitter.connect(merger, 0, left);
      splitter.connect(merger, 1, right);
      merger.connect(destination);
      connected = true;
      recoverable = false;
      reportFault(null);
    } catch (error) {
      mute();
      throw error;
    }
  };

  // Device and pair are one transaction. A successful sink change must never
  // leave the graph disconnected awaiting a component's later callback.
  const setDevice = (deviceId: string, channel: AudioOutputChannel = selected): Promise<void> => {
    const operation = deviceOperation.then(async () => {
      if (disposed) return;
      mute();
      selected = channel;
      changingDevice = true;
      deviceReady = false;
      recoverable = false;
      expectedSinkId = deviceId;
      try {
        // A previous 16-channel destination cannot be carried to a stereo sink.
        context.destination.channelCount = 2;
        await setAudioContextOutput(context as AudioContext, deviceId);
        if (disposed) return;
        deviceReady = true;
        setChannel(channel);
      } catch (error) {
        reportFault(error instanceof Error ? error.message : 'Device connection failed');
        throw error;
      } finally {
        changingDevice = false;
      }
    });
    deviceOperation = operation.catch(() => undefined);
    return operation;
  };

  // Called by the existing playback recovery signals/watchdog. Only reconnect
  // the explicitly chosen sink and pair; never fall back to another output.
  const recover = (): Promise<void> => {
    if (disposed || connected || changingDevice || !recoverable) return Promise.resolve();
    if (recovery) return recovery;
    if (Date.now() - lastRecoveryAt < 2000) return Promise.resolve();
    lastRecoveryAt = Date.now();
    recovery = setDevice(expectedSinkId, selected).catch(error => {
      recoverable = true;
      throw error;
    }).finally(() => { recovery = null; });
    return recovery;
  };

  const onSinkChange = () => {
    if (changingDevice || disposed) return;
    const actualSinkId = (context as AudioContext & { sinkId?: string }).sinkId;
    if ((deviceReady || recoverable) && actualSinkId === expectedSinkId) {
      deviceReady = true;
      try {
        setChannel(selected);
      } catch (error) {
        mute();
        recoverable = true;
        reportFault(error instanceof Error ? error.message : 'Output pair disconnected');
      }
      return;
    }
    deviceReady = false;
    recoverable = true;
    // Never let a browser/device fallback fold our bus into another pair.
    mute();
    reportFault('Output device changed unexpectedly; awaiting the selected device');
  };
  context.addEventListener("sinkchange", onSinkChange);
  setChannel(selected);
  return {
    input,
    setChannel,
    setPeakCeiling(ceiling: number | null) {
      if (ceiling == null) { peakCeiling.curve = null; return; }
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const sample = 2 * i / (curve.length - 1) - 1;
        curve[i] = Math.max(-ceiling, Math.min(ceiling, sample));
      }
      peakCeiling.curve = curve;
    },
    setDevice,
    recover,
    getStatus: () => ({ connected, changingDevice, recoverable, channel: selected, fault }),
    mute,
    dispose: () => {
      disposed = true;
      mute();
      context.removeEventListener("sinkchange", onSinkChange);
    },
  };
}
