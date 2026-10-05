import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import { beginTemporaryStreamSettings, endTemporaryStreamSettings, getStreamSettings, type StreamSettings } from '../services/storage';
import type { LiveSource } from '../services/streams';
import type { StreamConnectOptions } from './useStreamPlayback';
import { getTravelerSources, type TravelerSource } from '../music/worldTraveler';

interface Props {
  sources: LiveSource[];
  wantedIds: Set<string>;
  activeIds: Set<string>;
  connect: (source: LiveSource, options?: StreamConnectOptions) => Promise<void>;
  disconnect: (id: string) => void;
}

function readSettings(id: string): StreamSettings {
  const match = audioEngine.getStreamLevelMatch(id);
  return {
    filterQ: audioEngine.getFilterQ(), levelMatch: match.enabled,
    levelMatchReferenceQ: match.referenceQ,
    volume: audioEngine.getStreamVolume(id), pan: audioEngine.getStreamPan(id),
    highPassFreq: audioEngine.getStreamHighPass(id), lowPassFreq: audioEngine.getStreamLowPass(id),
    octaveShift: audioEngine.getStreamOctave(id), muted: audioEngine.getStreamMuted(id),
  };
}

function restoreSettings(id: string, settings: StreamSettings) {
  audioEngine.setStreamLevelMatch(id, settings.levelMatch, settings.levelMatchReferenceQ);
  audioEngine.setStreamVolume(id, settings.volume);
  audioEngine.setStreamPan(id, settings.pan);
  audioEngine.setStreamOctave(id, settings.octaveShift);
  audioEngine.setStreamMuted(id, settings.muted);
}

export function useWorldTraveler({ sources, wantedIds, activeIds, connect, disconnect }: Props) {
  const [enabled, setEnabled] = useState(false);
  const slots = useMemo(() => getTravelerSources(sources), [sources]);
  const [selectedId, setSelectedId] = useState<string>(slots[0]?.id ?? "");
  const session = useRef<{ wanted: Set<string>; settings: Map<string, StreamSettings>; slots: TravelerSource[] } | null>(null);

  const select = useCallback((id: string) => {
    if (!session.current || !session.current.slots.some(source => source.id === id)) return;
    audioEngine.setTravelerSource(id);
    setSelectedId(id);
  }, []);

  const toggle = useCallback(() => {
    const previous = session.current;
    if (previous) {
      // Keep the routing gate closed to background tracks until restoration finishes.
      for (const source of previous.slots) {
        if (!previous.wanted.has(source.id)) disconnect(source.id);
      }
      endTemporaryStreamSettings();
      for (const [id, settings] of previous.settings) restoreSettings(id, settings);
      midiService.setKeyboardSelectionMode(false);
      session.current = null;
      audioEngine.setTravelerSource(null);
      setEnabled(false);
      return;
    }
    if (slots.length === 0) return;
    const settings = new Map(Array.from(wantedIds, id => [id, activeIds.has(id) ? readSettings(id) : getStreamSettings(id) ?? readSettings(id)]));
    session.current = { wanted: new Set(wantedIds), settings, slots };
    const travelerSettings = new Map(slots.map(slot => [
      slot.id, settings.get(slot.id) ?? getStreamSettings(slot.id) ?? readSettings(slot.id),
    ]));
    beginTemporaryStreamSettings(travelerSettings);
    midiService.setKeyboardSelectionMode(true);
    const firstId = slots[0].id;
    // Restore remembered gains before opening the first destination's gate.
    for (const slot of slots) {
      const volume = getStreamSettings(slot.id)?.volume;
      if (volume !== undefined) audioEngine.setStreamVolume(slot.id, volume);
    }
    audioEngine.setTravelerSource(firstId);
    setSelectedId(firstId);
    setEnabled(true);
    for (const slot of slots) {
      const source = sources.find(candidate => candidate.id === slot.id);
      if (source) void connect(source);
    }
  }, [activeIds, connect, disconnect, slots, sources, wantedIds]);

  useEffect(() => midiService.onNote(event => {
    if (!session.current || event.isPad || event.type !== 'on') return;
    const slot = session.current.slots.find(source => source.note === event.note);
    if (slot) select(slot.id);
  }), [select]);

  useEffect(() => () => {
    if (!session.current) return;
    endTemporaryStreamSettings();
    midiService.setKeyboardSelectionMode(false);
    audioEngine.setTravelerSource(null);
    session.current = null;
  }, []);

  return { enabled, selectedId, slots, select, toggle };
}
