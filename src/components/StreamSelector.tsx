import { useState, useCallback, useEffect, useMemo } from 'react';
import type { StreamConnectOptions, StreamPlaybackPhase, StreamPlaybackStatus } from '../hooks/useStreamPlayback';
import type { LiveSource } from '../services/streams';
import { formatLocalTime } from '../utils/format';
import { LoadingSpinner } from './LoadingSpinner';
import { Badge } from './ui';

interface Props {
  sources: LiveSource[];
  sourceLoadError: string;
  sourcesReady: boolean;
  activeIds: Set<string>;
  wantedIds: Set<string>;
  statuses: Record<string, StreamPlaybackStatus>;
  onConnect: (source: LiveSource, options?: StreamConnectOptions) => void | Promise<void>;
  onDisconnect: (sourceId: string) => void;
}

const LOADING_PHASES = new Set<StreamPlaybackPhase>([
  'resolving',
  'opening',
  'buffering',
  'stalled',
  'reconnecting',
]);

function groupSourcesByCategory(sources: LiveSource[]): [string, LiveSource[]][] {
  const groups = new Map<string, LiveSource[]>();
  for (const source of sources) {
    const category = source.category || 'uncategorized';
    const group = groups.get(category);
    if (group) {
      group.push(source);
    } else {
      groups.set(category, [source]);
    }
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function getSourceButtonClass(active: boolean, status?: StreamPlaybackStatus): string {
  const phase = status?.phase;
  if (phase === 'failed') return 'border-ink bg-error text-copy';
  if (phase === 'stalled' || phase === 'reconnecting' || phase === 'blocked') return 'border-ink bg-warning text-copy';
  if (phase === 'resolving' || phase === 'opening' || phase === 'buffering') return 'border-ink bg-highlight text-copy';
  if (active) return 'border-ink bg-ink text-paper';
  return 'border-ink bg-paper text-copy hover:bg-surface';
}

function isEngagedStatus(status?: StreamPlaybackStatus): boolean {
  return Boolean(status && status.phase !== 'idle' && status.phase !== 'failed' && status.phase !== 'blocked');
}

export function StreamSelector({
  sources,
  sourceLoadError,
  sourcesReady,
  activeIds,
  wantedIds,
  statuses,
  onConnect,
  onDisconnect,
}: Props) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const toggle = useCallback((source: LiveSource) => {
    const status = statuses[source.id];
    if (status?.phase === 'blocked' || status?.phase === 'failed') {
      void onConnect(source, { reconnect: true });
      return;
    }

    if (wantedIds.has(source.id) || activeIds.has(source.id) || isEngagedStatus(statuses[source.id])) {
      onDisconnect(source.id);
    } else {
      void onConnect(source);
    }
  }, [activeIds, onConnect, onDisconnect, statuses, wantedIds]);

  const groupedSources = useMemo(() => groupSourcesByCategory(sources), [sources]);
  const hasStatusStrip = Boolean(
    sourceLoadError ||
    (sourcesReady && sources.length === 0)
  );

  return (
    <div className="grid gap-2">
      {hasStatusStrip && (
        <div className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-1 border border-ink bg-surface p-2">
          {sourceLoadError && <Badge tone="muted" className="max-w-full whitespace-normal break-words">Sources unavailable</Badge>}
          {sourcesReady && !sourceLoadError && sources.length === 0 && (
            <Badge tone="muted" className="max-w-full whitespace-normal break-words">No sources available</Badge>
          )}
        </div>
      )}
      <div className="max-h-[min(44vh,330px)] overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          {!sourcesReady && (
            <div className="flex h-11 items-center justify-center text-muted">
              <LoadingSpinner label="Loading sources" />
            </div>
          )}
          {groupedSources.map(([category, categorySources]) => (
            <div key={category} className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase text-muted">{category}</span>
              <div className="grid gap-1">
                {categorySources.map(source => {
                  const localTime = formatLocalTime(clock, source.timeZone);
                  const active = activeIds.has(source.id);
                  const wanted = wantedIds.has(source.id);
                  const status = statuses[source.id];
                  const loading = Boolean(status && LOADING_PHASES.has(status.phase));
                  const actionLabel = status?.phase === 'failed' ? 'Retry' : status?.phase === 'blocked' ? 'Tap to start' : '';
                  const accessibleStatus = loading ? 'Loading' : actionLabel || (active ? 'Playing' : '');
                  const looksLive = active && (!status || status.phase === 'playing');

                  return (
                    <button
                      key={source.id}
                      className={`grid h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase sm:h-9 ${getSourceButtonClass(wanted || active, status)}`}
                      onClick={() => toggle(source)}
                      aria-pressed={wanted || active || isEngagedStatus(status)}
                      aria-label={`${source.name}${accessibleStatus ? ` — ${accessibleStatus}` : ''}`}
                      title={`${source.description}\n${source.location}${localTime ? `\nLocal time: ${localTime}` : ''}${accessibleStatus ? `\n${accessibleStatus}` : ''}`}
                    >
                      <span className="min-w-0 truncate leading-none">{source.name}</span>
                      <span className="flex h-full shrink-0 items-center gap-1 overflow-hidden">
                        {loading && <LoadingSpinner label={`${source.name}: Loading`} />}
                        {actionLabel && (
                          <span className={looksLive ? 'inline-flex h-5 items-center whitespace-nowrap border border-paper px-1.5 text-[9px] leading-none text-paper' : 'inline-flex h-5 items-center whitespace-nowrap border border-ink bg-paper px-1.5 text-[9px] leading-none text-copy'}>
                            {actionLabel}
                          </span>
                        )}
                        {localTime && (
                          <span className={looksLive ? 'inline-flex h-5 items-center whitespace-nowrap border border-paper px-1.5 text-[9px] leading-none text-paper' : 'inline-flex h-5 items-center whitespace-nowrap border border-ink px-1.5 text-[9px] leading-none text-copy'}>
                            {localTime}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
