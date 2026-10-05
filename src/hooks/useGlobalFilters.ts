import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { getGlobalFilters, saveGlobalFilters } from '../services/storage';
import { normalizeGlobalFilters, type GlobalFilters } from '../services/globalFilters';

export function useGlobalFilters() {
  const [filters, setFilters] = useState(getGlobalFilters);
  useEffect(() => { audioEngine.setGlobalFilters(getGlobalFilters()); }, []);
  const updateFilters = useCallback((next: GlobalFilters) => {
    const normalized = normalizeGlobalFilters(next);
    audioEngine.setGlobalFilters(normalized);
    saveGlobalFilters(normalized);
    setFilters(normalized);
  }, []);
  return { filters, updateFilters };
}
