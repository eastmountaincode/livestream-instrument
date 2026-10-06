// Additional, downward-only bus dynamics for World Traveler. Manual source
// gains and resonance matching stay upstream and remain independent.
export const TRAVELER_PEAK_CEILING = Math.pow(10, -1 / 20);

export function createTravelerDynamics(context: BaseAudioContext) {
  const input = context.createGain();
  const output = context.createGain();
  const masterGain = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const dryOutput = context.createGain();
  const wetOutput = context.createGain();
  wet.gain.value = 0;
  wetOutput.gain.value = 0;

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
  // Master is an output-level control, after compression but before the
  // final safety limiter. Raising it must not just drive the compressor harder.
  input.connect(dry).connect(masterGain);
  input.connect(compression.compressor);
  compression.trim.connect(wet).connect(masterGain);
  masterGain.connect(dryOutput).connect(output);
  masterGain.connect(limiting.compressor);
  limiting.trim.connect(wetOutput).connect(output);

  return {
    input,
    output,
    masterGain,
    setEnabled(enabled: boolean) {
      // Only change the bus at mode boundaries, never on a source-key press.
      dry.gain.setValueAtTime(enabled ? 0 : 1, context.currentTime);
      wet.gain.setValueAtTime(enabled ? 1 : 0, context.currentTime);
      dryOutput.gain.setValueAtTime(enabled ? 0 : 1, context.currentTime);
      wetOutput.gain.setValueAtTime(enabled ? 1 : 0, context.currentTime);
    },
  };
}
