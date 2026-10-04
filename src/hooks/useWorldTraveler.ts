import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { midiService } from '../services/MidiService';
import { beginTemporaryStreamSettings, endTemporaryStreamSettings, getStreamSettings, type StreamSettings } from '../services/storage';
import type { LiveSource } from '../services/streams';
import type { StreamConnectOptions } from './useStreamPlayback';
import { WORLD_TRAVELER_SOURCES } from '../music/worldTraveler';

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
  audioEngine.setStreamHighPass(id, settings.highPassFreq);
  audioEngine.setStreamLowPass(id, settings.lowPassFreq);
  audioEngine.setStreamOctave(id, settings.octaveShift);
  audioEngine.setStreamMuted(id, settings.muted);
}

export function useWorldTraveler({ sources, wantedIds, activeIds, connect, disconnect }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(WORLD_TRAVELER_SOURCES[0].id);
  const session = useRef<{ wanted: Set<string>; settings: Map<string, StreamSettings> } | null>(null);

  const select = useCallback((id: string) => {
    if (!session.current || !WORLD_TRAVELER_SOURCES.some(source => source.id === id)) return;
    audioEngine.setTravelerSource(id);
    setSelectedId(id);
  }, []);

  const toggle = useCallback(() => {
    const previous = session.current;
    if (previous) {
      // Keep the routing gate closed to background tracks until restoration finishes.
      for (const source of WORLD_TRAVELER_SOURCES) {
        if (!previous.wanted.has(source.id)) disconnect(source.id);
      }
      endTemporaryStreamSettings();
      for (const [id, settings] of previous.settings) restoreSettings(id, settings);
      midiService.setKeyboardChordMode(false);
      session.current = null;
      audioEngine.setTravelerSource(null);
      setEnabled(false);
      return;
    }
    const settings = new Map(Array.from(wantedIds, id => [id, activeIds.has(id) ? readSettings(id) : getStreamSettings(id) ?? readSettings(id)]));
    session.current = { wanted: new Set(wantedIds), settings };
    beginTemporaryStreamSettings(settings);
    midiService.setKeyboardChordMode(true);
    const firstId = WORLD_TRAVELER_SOURCES[0].id;
    audioEngine.setTravelerSource(firstId);
    setSelectedId(firstId);
    setEnabled(true);
    for (const slot of WORLD_TRAVELER_SOURCES) {
      const source = sources.find(candidate => candidate.id === slot.id);
      if (source) void connect(source);
    }
  }, [activeIds, connect, disconnect, sources, wantedIds]);

  useEffect(() => midiService.onNote(event => {
    if (!session.current || !event.isPad || event.type !== 'on') return;
    const slot = WORLD_TRAVELER_SOURCES[event.note - 36];
    if (slot) select(slot.id);
  }), [select]);

  useEffect(() => () => {
    if (!session.current) return;
    endTemporaryStreamSettings();
    midiService.setKeyboardChordMode(false);
    audioEngine.setTravelerSource(null);
    session.current = null;
  }, []);

  return { enabled, selectedId, select, toggle };
}
