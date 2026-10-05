// Additional, downward-only bus dynamics for World Traveler. Manual source
// gains and resonance matching stay upstream and remain independent.
export const TRAVELER_PEAK_CEILING = Math.pow(10, -1 / 20);

export function createTravelerDynamics(context: BaseAudioContext) {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  wet.gain.value = 0;

  const stage = (threshold: number, ratio: number, attack: number, release: number) => {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = threshold;
    compressor.knee.value = 0;
    compressor.ratio.value = ratio;
    compressor.attack.value = attack;
    compressor.release.value = release;
    // Web Audio adds fixed makeup gain. With a hard knee, the specified
    // full-scale transfer is threshold * (1 - 1/ratio) dB; undo the 0.6-power
    // makeup so quiet passages are not boosted by this extra processing.
    // https://www.w3.org/TR/webaudio-1.0/#computing-the-makeup-gain
    const trim = context.createGain();
    trim.gain.value = Math.pow(10, threshold * (1 - 1 / ratio) * 0.6 / 20);
    compressor.connect(trim);
    return { compressor, trim };
  };
  const compression = stage(-18, 4, 0.003, 0.08);
  const limiting = stage(-3, 20, 0, 0.04);
  input.connect(dry).connect(output);
  input.connect(compression.compressor);
  compression.trim.connect(limiting.compressor);
  limiting.trim.connect(wet).connect(output);

  return {
    input,
    output,
    setEnabled(enabled: boolean) {
      // Only change the bus at mode boundaries, never on a source-key press.
      dry.gain.setValueAtTime(enabled ? 0 : 1, context.currentTime);
      wet.gain.setValueAtTime(enabled ? 1 : 0, context.currentTime);
    },
  };
}
