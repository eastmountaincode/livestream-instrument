import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import { getGlobalFilterQ, saveGlobalFilterQ } from '../services/storage';

// Mount at the app level so the wheel keeps working with the mixer collapsed.
export function useGlobalResonance() {
    const [filterQ, setFilterQ] = useState(() => getGlobalFilterQ());

    const pendingQ = useRef<number | null>(null);
    const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unsavedQ = useRef<number | null>(null);

    const flushSave = useCallback(() => {
        if (saveTimer.current !== null) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (unsavedQ.current !== null) saveGlobalFilterQ(unsavedQ.current);
        unsavedQ.current = null;
    }, []);

    const updateFilterQ = useCallback((q: number) => {
        if (!Number.isFinite(q)) return;
        const next = Math.max(1, Math.min(100, q));
        // A slider edit supersedes any queued wheel position.
        pendingQ.current = null;
        audioEngine.setFilterQ(next);
        setFilterQ(next);
        unsavedQ.current = next;
        if (saveTimer.current !== null) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flushSave, 150);
    }, [flushSave]);

    useEffect(() => {
        audioEngine.setFilterQ(getGlobalFilterQ());
    }, []);

    useEffect(() => midiService.onCC((cc, value) => {
        if (cc !== 1 || !Number.isFinite(value) || value < 0 || value > 127) return;
        pendingQ.current = 1 + (value / 127) * 99;
        if (wheelTimer.current !== null) return;
        // Bound the work and keep only the newest CC value. Use a timer,
        // not animation frames, so a background instrument can still respond.
        wheelTimer.current = setTimeout(() => {
            wheelTimer.current = null;
            const next = pendingQ.current;
            if (next !== null) updateFilterQ(next);
        }, 16);
    }), [updateFilterQ]);

    useEffect(() => {
        // Keep the last heard value if the user leaves during a wheel sweep.
        window.addEventListener('pagehide', flushSave);
        return () => {
            if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
            pendingQ.current = null;
            wheelTimer.current = null;
            flushSave();
            window.removeEventListener('pagehide', flushSave);
        };
    }, [flushSave]);

    return { filterQ, updateFilterQ };
}
