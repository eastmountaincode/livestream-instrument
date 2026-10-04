import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import { getGlobalFilterQ, saveGlobalFilterQ } from '../services/storage';

// Mount at the app level so the wheel keeps working with the mixer collapsed.
export function useGlobalResonance() {
    const [filterQ, setFilterQ] = useState(() => getGlobalFilterQ());

    const updateFilterQ = useCallback((q: number) => {
        if (!Number.isFinite(q)) return;
        const next = Math.max(1, Math.min(100, q));
        audioEngine.setFilterQ(next);
        setFilterQ(next);
        saveGlobalFilterQ(next);
    }, []);

    useEffect(() => {
        audioEngine.setFilterQ(getGlobalFilterQ());
    }, []);

    useEffect(() => midiService.onCC((cc, value) => {
        if (cc !== 1 || !Number.isFinite(value) || value < 0 || value > 127) return;
        updateFilterQ(1 + (value / 127) * 99);
    }), [updateFilterQ]);

    return { filterQ, updateFilterQ };
}
