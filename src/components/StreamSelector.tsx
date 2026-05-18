import { useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { fetchAcceptedLiveSources, getOrcasoundStreamUrl } from '../services/streams';
import type { LiveSource } from '../services/streams';
import { saveActiveStreams, getSavedState } from '../services/storage';

interface Props {
  onConnected: () => void;
  onActiveChange: (ids: Set<string>) => void;
  onSourcesChange?: (sources: LiveSource[]) => void;
  onRemoveSourceReady?: (removeSource: (sourceId: string) => void) => void;
  autoRestore?: boolean;
}

interface ActiveStream {
  hls?: Hls;
}

const typeIconColors: Record<string, string> = {
  'hydrophone': 'text-black',
  'weather-radio': 'text-black',
  'vlf': 'text-black',
  'soundscape': 'text-black',
};
const SOURCE_LOAD_RETRIES = 3;
const SOURCE_LOAD_RETRY_DELAY_MS = 700;

function groupSourcesByCategory(sources: LiveSource[]): [string, LiveSource[]][] {
  const groups = new Map<string, LiveSource[]>();
  for (const source of sources) {
    const category = source.category || 'uncategorized';
    groups.set(category, [...(groups.get(category) ?? []), source]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function formatLocalTime(date: Date, timeZone?: string): string {
  if (!timeZone) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function StreamSelector({ onConnected, onActiveChange, onSourcesChange, onRemoveSourceReady, autoRestore }: Props) {
  const [sources, setSources] = useState<LiveSource[]>([]);
  const [sourceLoadError, setSourceLoadError] = useState('');
  const [sourcesReady, setSourcesReady] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const activeStreams = useRef<Map<string, ActiveStream>>(new Map());
  const restoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      for (let attempt = 1; attempt <= SOURCE_LOAD_RETRIES; attempt++) {
        try {
          const result = await fetchAcceptedLiveSources();
          const shouldRetryDegradedLoad = !result.configured && !result.fromCache && attempt < SOURCE_LOAD_RETRIES;

          if (shouldRetryDegradedLoad) {
            await wait(SOURCE_LOAD_RETRY_DELAY_MS * attempt);
            continue;
          }

          if (cancelled) return;
          setSources(result.sources);
          onSourcesChange?.(result.sources);
          setSourceLoadError(result.configured
            ? ''
            : result.fromCache
              ? 'stream database unavailable, using last saved source list'
              : 'stream database unavailable, using bundled source list');
          setSourcesReady(true);
          return;
        } catch (error) {
          if (attempt < SOURCE_LOAD_RETRIES) {
            await wait(SOURCE_LOAD_RETRY_DELAY_MS * attempt);
            continue;
          }

          if (cancelled) return;
          setSourceLoadError(error instanceof Error ? error.message : 'Failed to load stream database');
          setSources([]);
          onSourcesChange?.([]);
          setSourcesReady(true);
        }
      }
    }

    loadSources();
    return () => {
      cancelled = true;
    };
  }, [onSourcesChange]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    onActiveChange(activeIds);
    if (restoredRef.current) {
      saveActiveStreams(Array.from(activeIds));
    }
  }, [activeIds, onActiveChange]);

  const disconnect = useCallback((sourceId: string) => {
    audioEngine.removeStream(sourceId);
    const stream = activeStreams.current.get(sourceId);
    if (stream?.hls) {
      stream.hls.destroy();
    }
    activeStreams.current.delete(sourceId);
    setActiveIds(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
  }, []);

  useEffect(() => {
    onRemoveSourceReady?.(disconnect);
    return () => onRemoveSourceReady?.(() => undefined);
  }, [disconnect, onRemoveSourceReady]);

  const connect = useCallback(async (source: LiveSource) => {
    setLoadingIds(prev => new Set(prev).add(source.id));
    setErrors(prev => {
      const next = new Map(prev);
      next.delete(source.id);
      return next;
    });

    await audioEngine.resume();

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    const onReady = () => {
      audioEngine.addStream(source.id, audio);
      audio.play();
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setActiveIds(prev => new Set(prev).add(source.id));
      onConnected();
    };

    const onError = (msg: string) => {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setErrors(prev => new Map(prev).set(source.id, msg));
      setTimeout(() => {
        setErrors(prev => {
          const next = new Map(prev);
          next.delete(source.id);
          return next;
        });
      }, 5000);
    };

    try {
      if (source.hlsUrl || source.latestTxtUrl || source.hlsNode) {
        const hlsUrl = source.hlsUrl || await getOrcasoundStreamUrl(source);

        if (Hls.isSupported()) {
          const hls = new Hls({
            liveSyncDurationCount: 6,
            liveMaxLatencyDurationCount: 12,
            maxBufferLength: 60,
            backBufferLength: 30,
            manifestLoadingMaxRetry: 6,
            fragLoadingMaxRetry: 6,
          });
          activeStreams.current.set(source.id, { hls });

          hls.loadSource(hlsUrl);
          hls.attachMedia(audio);
          hls.on(Hls.Events.MANIFEST_PARSED, onReady);

          let retryCount = 0;
          const MAX_RETRIES = 3;
          hls.on(Hls.Events.ERROR, async (_event, data) => {
            if (!data.fatal) return;

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < MAX_RETRIES) {
              retryCount++;
              try {
                const freshUrl = await getOrcasoundStreamUrl(source);
                if (freshUrl !== hlsUrl) {
                  hls.loadSource(freshUrl);
                } else {
                  hls.startLoad();
                }
              } catch {
                hls.startLoad();
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retryCount < MAX_RETRIES) {
              retryCount++;
              hls.recoverMediaError();
            } else {
              onError(`HLS error: ${data.type}`);
            }
          });
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = hlsUrl;
          audio.addEventListener('canplay', onReady, { once: true });
          audio.addEventListener('error', () => onError('Failed to load HLS stream'), { once: true });
          audio.load();
          activeStreams.current.set(source.id, {});
        }
      } else if (source.url) {
        audio.src = source.url;
        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('error', () => onError('Failed to load stream'), { once: true });
        audio.load();
        activeStreams.current.set(source.id, {});
      }
    } catch (err) {
      onError(String(err));
    }
  }, [onConnected]);

  // Auto-reconnect saved streams (AudioContext already resumed by Start button)
  useEffect(() => {
    if (!autoRestore || restoredRef.current || !sourcesReady) return;
    restoredRef.current = true;
    const saved = getSavedState();
    if (!saved?.activeStreamIds.length) return;
    for (const id of saved.activeStreamIds) {
      const source = sources.find(s => s.id === id);
      if (source) connect(source);
    }
  }, [autoRestore, connect, sources, sourcesReady]);

  const toggle = useCallback((source: LiveSource) => {
    if (activeIds.has(source.id)) {
      disconnect(source.id);
    } else {
      connect(source);
    }
  }, [activeIds, connect, disconnect]);

  const typeIcons: Record<string, string> = {
    'hydrophone': '~',
    'weather-radio': '>',
    'vlf': '*',
    'soundscape': '◦',
  };
  const groupedSources = groupSourcesByCategory(sources);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 border-b-2 border-black pb-2">
        <h3 className="m-0 text-[11px] font-black uppercase tracking-normal text-black">Source Bank</h3>
        <span className="font-mono text-[10px] font-black uppercase text-black/55">{sources.length} approved</span>
      </div>
      <div className="flex flex-col gap-2">
        {!sourcesReady && (
          <div className="border-2 border-black bg-white px-2 py-1 text-[11px] font-black uppercase text-black/60">loading approved stream sources...</div>
        )}
        {groupedSources.map(([category, categorySources]) => (
          <div key={category} className="grid gap-1 sm:grid-cols-[118px_minmax(0,1fr)] sm:items-start">
            <span className="pt-1 text-[10px] font-black uppercase text-black/60">{category}</span>
            <div className="flex flex-wrap items-center gap-1">
            {categorySources.map(source => {
              const localTime = formatLocalTime(clock, source.timeZone);

              return (
                <button
                  key={source.id}
                  className={`flex min-h-9 max-w-full items-center gap-1 border-2 px-2 py-1 font-mono text-[11px] font-bold uppercase transition-colors duration-100 ${
                    activeIds.has(source.id)
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-black hover:text-white'
                  }`}
                  onClick={() => toggle(source)}
                  title={`${source.description}\n${source.location}${localTime ? `\nLocal time: ${localTime}` : ''}`}
                >
                  <span className={`text-[13px] ${activeIds.has(source.id) ? 'text-white' : typeIconColors[source.type] || ''}`}>{typeIcons[source.type] ?? '◦'}</span>
                  <span className="max-w-[180px] truncate">{source.name}</span>
                  <span className={activeIds.has(source.id) ? 'hidden text-[10px] text-white/70 md:inline' : 'hidden text-[10px] text-black/50 md:inline'}>{source.location}</span>
                  {localTime && (
                    <span className={activeIds.has(source.id) ? 'ml-1 border border-white px-1.5 py-0.5 text-[10px] text-white' : 'ml-1 border border-black px-1.5 py-0.5 text-[10px] text-black'}>
                      {localTime}
                    </span>
                  )}
                </button>
              );
            })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-h-[20px] flex-wrap gap-1">
        {sourceLoadError && <span className="border-2 border-black bg-[#f3d85a] px-2 py-0.5 text-[10px] font-black uppercase text-black">{sourceLoadError}</span>}
        {sourcesReady && !sourceLoadError && sources.length === 0 && (
          <span className="border-2 border-black bg-[#f3d85a] px-2 py-0.5 text-[10px] font-black uppercase text-black">no approved stream sources loaded</span>
        )}
        {loadingIds.size > 0 && <span className="border-2 border-black bg-[#f3d85a] px-2 py-0.5 text-[10px] font-black uppercase text-black">connecting...</span>}
        {activeIds.size > 0 && <span className="border-2 border-black bg-black px-2 py-0.5 text-[10px] font-black uppercase text-white">{activeIds.size} source{activeIds.size > 1 ? 's' : ''} live</span>}
        {Array.from(errors.entries()).map(([id, msg]) => (
          <span key={id} className="border-2 border-black bg-[#f18a7a] px-2 py-0.5 text-[10px] font-black uppercase text-black">{msg}</span>
        ))}
      </div>
    </div>
  );
}
