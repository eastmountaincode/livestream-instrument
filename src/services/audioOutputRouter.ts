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
  let merger: ChannelMergerNode | null = null;
  let selected: AudioOutputChannel = "stereo";
  let changingDevice = false;
  let deviceReady = true;
  let expectedSinkId =
    (context as AudioContext & { sinkId?: string }).sinkId ?? "";

  const mute = () => {
    input.disconnect();
    panner.disconnect();
    splitter.disconnect();
    merger?.disconnect();
    merger = null;
  };

  const setChannel = (channel: AudioOutputChannel) => {
    selected = channel;
    mute();
    if (!deviceReady)
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
        panner.pan.setValueAtTime(
          channel === "left" ? -1 : 1,
          context.currentTime,
        );
        input.connect(panner).connect(splitter);
      } else {
        input.connect(splitter);
      }
      splitter.connect(merger, 0, left);
      splitter.connect(merger, 1, right);
      merger.connect(destination);
    } catch (error) {
      mute();
      throw error;
    }
  };

  const setDevice = async (deviceId: string) => {
    mute();
    changingDevice = true;
    deviceReady = false;
    try {
      // A previous 16-channel destination cannot be carried to a stereo sink.
      context.destination.channelCount = 2;
      await setAudioContextOutput(context as AudioContext, deviceId);
      expectedSinkId = deviceId;
      deviceReady = true;
      // The caller reapplies its selected pair only after the sink has changed.
    } finally {
      changingDevice = false;
    }
  };

  const onSinkChange = () => {
    if (changingDevice) return;
    const actualSinkId = (context as AudioContext & { sinkId?: string }).sinkId;
    if (deviceReady && actualSinkId === expectedSinkId) {
      try {
        setChannel(selected);
      } catch {
        mute();
      }
      return;
    }
    deviceReady = false;
    // Never let a browser/device fallback fold our bus into another pair.
    mute();
  };
  context.addEventListener("sinkchange", onSinkChange);
  setChannel(selected);
  return {
    input,
    setChannel,
    setDevice,
    mute,
    dispose: () => {
      mute();
      context.removeEventListener("sinkchange", onSinkChange);
    },
  };
}
