import { PAD_DISPLAY_ORDER } from '../music/chords';
import { WORLD_TRAVELER_SOURCES } from '../music/worldTraveler';
import type { StreamConnectOptions, StreamPlaybackStatus } from '../hooks/useStreamPlayback';
import type { LiveSource } from '../services/streams';
import { LoadingSpinner } from './LoadingSpinner';

interface Props {
  selectedId: string;
  sources: LiveSource[];
  statuses: Record<string, StreamPlaybackStatus>;
  onSelect: (id: string) => void;
  onConnect: (source: LiveSource, options?: StreamConnectOptions) => Promise<void>;
}

export function WorldTraveler({ selectedId, sources, statuses, onSelect, onConnect }: Props) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {PAD_DISPLAY_ORDER.map(index => {
        const slot = WORLD_TRAVELER_SOURCES[index];
        const source = sources.find(candidate => candidate.id === slot.id);
        const phase = statuses[slot.id]?.phase;
        const failed = !source || phase === 'failed' || phase === 'blocked';
        const loading = !failed && phase !== 'playing';
        const selected = slot.id === selectedId;
        return (
          <button key={slot.id} type="button"
            className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 border border-ink px-1 font-mono text-[10px] font-semibold ${selected ? 'bg-ink text-paper' : failed ? 'bg-warning text-copy' : 'bg-paper text-copy hover:bg-surface'}`}
            aria-pressed={selected}
            aria-label={`Pad ${index + 1}: ${slot.label}${failed ? ' — unavailable' : loading ? ' — loading' : ''}`}
            onClick={() => {
              onSelect(slot.id);
              if (source && failed) void onConnect(source, { reconnect: true });
            }}>
            <span className="flex items-center gap-1">{index + 1}{loading && <LoadingSpinner />}{failed && <span aria-hidden="true">!</span>}</span>
            <span className="text-center leading-tight">{slot.label}</span>
          </button>
        );
      })}
    </div>
  );
}
