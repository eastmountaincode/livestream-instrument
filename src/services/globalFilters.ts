export interface GlobalFilters {
  highPassFreq: number;
  lowPassFreq: number;
}

export function normalizeGlobalFilters(value: Partial<GlobalFilters> | null | undefined, maximum = 20000): GlobalFilters {
  const max = Math.max(30, Math.min(20000, maximum));
  const low = value?.lowPassFreq;
  const high = value?.highPassFreq;
  const lowPassFreq = Math.max(30, Math.min(max, typeof low === 'number' && Number.isFinite(low) ? low : max));
  const highPassFreq = Math.max(20, Math.min(lowPassFreq - 10, typeof high === 'number' && Number.isFinite(high) ? high : 20));
  return { highPassFreq, lowPassFreq };
}
