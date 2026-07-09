import { useState, useCallback, useEffect, useMemo } from 'react';
import type { StreamConnectOptions, StreamPlaybackPhase, StreamPlaybackStatus } from '../hooks/useStreamPlayback';
import type { LiveSource } from '../services/streams';
import { formatLocalTime } from '../utils/format';
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

const PHASE_LABELS: Record<StreamPlaybackPhase, string> = {
  idle: 'Idle',
  resolving: 'Resolving',
  opening: 'Opening',
  buffering: 'Buffering',
  playing: 'Playing',
  stalled: 'Stalled',
  reconnecting: 'Reconnecting',
  blocked: 'Tap To Start',
  failed: 'Failed',
};

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

function getStatusTone(phase: StreamPlaybackPhase): 'default' | 'active' | 'muted' | 'warning' | 'error' {
  if (phase === 'playing') return 'active';
  if (phase === 'failed') return 'error';
  if (phase === 'stalled' || phase === 'reconnecting' || phase === 'blocked') return 'warning';
  if (phase === 'idle') return 'default';
  return 'muted';
}

function getSourceButtonClass(active: boolean, status?: StreamPlaybackStatus): string {
  const phase = status?.phase;
  if (phase === 'failed') return 'border-ink bg-error text-copy';
  if (phase === 'stalled' || phase === 'reconnecting' || phase === 'blocked') return 'border-ink bg-warning text-copy';
  if (phase === 'resolving' || phase === 'opening' || phase === 'buffering') return 'border-ink bg-highlight text-copy';
  if (active) return 'border-ink bg-ink text-paper';
  return 'border-ink bg-paper text-copy hover:bg-surface';
}

function getStatusDetail(status: StreamPlaybackStatus): string {
  if (status.phase === 'reconnecting' && status.nextRetryAt) {
    const seconds = Math.max(1, Math.ceil((status.nextRetryAt - Date.now()) / 1000));
    return `${status.message}; retry in ${seconds}s`;
  }

  const proxy = status.usingProxyFallback ? ' via proxy' : '';
  return `${status.message}${proxy}`;
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
  const visibleStatuses = useMemo(
    () => Object.values(statuses).filter(status => status.phase !== 'idle'),
    [statuses],
  );
  const hasRetryCountdown = visibleStatuses.some(status => status.phase === 'reconnecting' && status.nextRetryAt);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, hasRetryCountdown ? 1_000 : 30_000);

    return () => window.clearInterval(intervalId);
  }, [hasRetryCountdown]);

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
    (sourcesReady && sources.length === 0) ||
    visibleStatuses.length > 0
  );

  return (
    <div className="grid gap-2">
      {hasStatusStrip && (
        <div className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-1 border border-ink bg-surface p-2">
          {sourceLoadError && <Badge tone="muted" className="max-w-full whitespace-normal break-words">{sourceLoadError}</Badge>}
          {sourcesReady && !sourceLoadError && sources.length === 0 && (
            <Badge tone="muted" className="max-w-full whitespace-normal break-words">No Approved Stream Sources Loaded</Badge>
          )}
          {visibleStatuses.map(status => {
            const source = sources.find(item => item.id === status.sourceId);
            return (
              <Badge key={status.sourceId} tone={getStatusTone(status.phase)} className="max-w-full whitespace-normal break-words">
                {source?.name ?? status.sourceId}: {getStatusDetail(status)}
              </Badge>
            );
          })}
        </div>
      )}
      <div className="max-h-[min(44vh,330px)] overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          {!sourcesReady && (
            <div className="border border-ink bg-paper px-2 py-1 text-[11px] font-semibold uppercase text-muted">Loading Approved Stream Sources...</div>
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
                  const statusLabel = status && status.phase !== 'idle' ? PHASE_LABELS[status.phase] : '';
                  const looksLive = active && (!status || status.phase === 'playing');

                  return (
                    <button
                      key={source.id}
                      className={`grid h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase ${getSourceButtonClass(wanted || active, status)}`}
                      onClick={() => toggle(source)}
                      title={`${source.description}\n${source.location}${localTime ? `\nLocal time: ${localTime}` : ''}${status ? `\n${getStatusDetail(status)}` : ''}`}
                    >
                      <span className="min-w-0 truncate leading-none">{source.name}</span>
                      <span className="flex h-full shrink-0 items-center gap-1 overflow-hidden">
                        {statusLabel && (
                          <span className={looksLive ? 'inline-flex h-5 items-center whitespace-nowrap border border-paper px-1.5 text-[9px] leading-none text-paper' : 'inline-flex h-5 items-center whitespace-nowrap border border-ink bg-paper/60 px-1.5 text-[9px] leading-none text-copy'}>
                            {statusLabel}
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
