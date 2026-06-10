import { useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { fetchAcceptedLiveSources, getOrcasoundStreamUrl } from '../services/streams';
import type { LiveSource } from '../services/streams';
import { saveActiveStreams, getSavedState, getStreamSettings, saveStreamSettings } from '../services/storage';
import type { StreamSettings } from '../services/storage';

interface Props {
  onConnected: () => void;
  onActiveChange: (ids: Set<string>) => void;
  onSourcesChange?: (sources: LiveSource[]) => void;
  onRemoveSourceReady?: (removeSource: (sourceId: string) => void) => void;
  autoRestore?: boolean;
  defaultSourceIds?: string[];
  defaultStreamSettings?: Record<string, Partial<StreamSettings>>;
}

interface ActiveStream {
  hls?: Hls;
}

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

export function StreamSelector({
  onConnected,
  onActiveChange,
  onSourcesChange,
  onRemoveSourceReady,
  autoRestore,
  defaultSourceIds = [],
  defaultStreamSettings = {},
}: Props) {
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

          if (cancelled) return;
          setSources(result.sources);
          onSourcesChange?.(result.sources);
          setSourceLoadError('');
          setSourcesReady(true);
          return;
        } catch (error) {
          if (attempt < SOURCE_LOAD_RETRIES) {
            await wait(SOURCE_LOAD_RETRY_DELAY_MS * attempt);
            continue;
          }

          if (cancelled) return;
          setSourceLoadError(error instanceof Error ? error.message : 'Failed to load stream catalog');
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
      const savedSettings = getStreamSettings(source.id);
      const defaultSettings = defaultStreamSettings[source.id];
      if (!savedSettings && defaultSettings) {
        const nextSettings: StreamSettings = {
          filterQ: defaultSettings.filterQ ?? audioEngine.getStreamFilterQ(source.id),
          volume: defaultSettings.volume ?? audioEngine.getStreamVolume(source.id),
          highPassFreq: defaultSettings.highPassFreq ?? audioEngine.getStreamHighPass(source.id),
          lowPassFreq: defaultSettings.lowPassFreq ?? audioEngine.getStreamLowPass(source.id),
          pan: defaultSettings.pan ?? audioEngine.getStreamPan(source.id),
          octaveShift: defaultSettings.octaveShift ?? audioEngine.getStreamOctave(source.id),
          muted: defaultSettings.muted ?? audioEngine.getStreamMuted(source.id),
        };
        audioEngine.setStreamFilterQ(source.id, nextSettings.filterQ);
        audioEngine.setStreamVolume(source.id, nextSettings.volume);
        audioEngine.setStreamHighPass(source.id, nextSettings.highPassFreq);
        audioEngine.setStreamLowPass(source.id, nextSettings.lowPassFreq);
        audioEngine.setStreamPan(source.id, nextSettings.pan);
        audioEngine.setStreamOctave(source.id, nextSettings.octaveShift);
        audioEngine.setStreamMuted(source.id, nextSettings.muted);
        saveStreamSettings(source.id, nextSettings);
      }
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
  }, [defaultStreamSettings, onConnected]);

  // Auto-reconnect saved streams (AudioContext already resumed by Start button)
  useEffect(() => {
    if (!autoRestore || restoredRef.current || !sourcesReady) return;
    restoredRef.current = true;
    const saved = getSavedState();
    const idsToConnect = saved?.activeStreamIds.length ? saved.activeStreamIds : defaultSourceIds;
    if (!idsToConnect.length) return;
    for (const id of idsToConnect) {
      const source = sources.find(s => s.id === id);
      if (source) connect(source);
    }
  }, [autoRestore, connect, defaultSourceIds, sources, sourcesReady]);

  const toggle = useCallback((source: LiveSource) => {
    if (activeIds.has(source.id)) {
      disconnect(source.id);
    } else {
      connect(source);
    }
  }, [activeIds, connect, disconnect]);

  const groupedSources = groupSourcesByCategory(sources);

  return (
    <div className="grid gap-2">
      <div className="max-h-[176px] overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
        {!sourcesReady && (
          <div className="border border-[#242424] bg-[#fbfaf6] px-2 py-1 text-[11px] font-semibold uppercase text-[#68645c]">Loading Approved Stream Sources...</div>
        )}
        {groupedSources.map(([category, categorySources]) => (
          <div key={category} className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase text-[#68645c]">{category}</span>
            <div className="grid gap-1">
            {categorySources.map(source => {
              const localTime = formatLocalTime(clock, source.timeZone);
              const active = activeIds.has(source.id);

              return (
                <button
                  key={source.id}
                  className={`grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase ${
                    active
                      ? 'border-[#242424] bg-[#242424] text-[#fbfaf6]'
                      : 'border-[#242424] bg-[#fbfaf6] text-[#171717] hover:bg-[#eeece3]'
                  }`}
                  onClick={() => toggle(source)}
                  title={`${source.description}\n${source.location}${localTime ? `\nLocal time: ${localTime}` : ''}`}
                >
                  <span className="min-w-0 whitespace-normal break-words leading-tight">{source.name}</span>
                  {localTime && (
                    <span className={active ? 'shrink-0 border border-[#fbfaf6] px-1.5 py-0.5 text-[9px] text-[#fbfaf6]' : 'shrink-0 border border-[#242424] px-1.5 py-0.5 text-[9px] text-[#171717]'}>
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
      </div>
      <div className="flex min-h-[28px] flex-wrap gap-1 border-t border-[#242424] pt-2">
        {sourceLoadError && <span className="border border-[#242424] bg-[#d8cfb7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">{sourceLoadError}</span>}
        {sourcesReady && !sourceLoadError && sources.length === 0 && (
          <span className="border border-[#242424] bg-[#d8cfb7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">No Approved Stream Sources Loaded</span>
        )}
        {loadingIds.size > 0 && <span className="border border-[#242424] bg-[#d8cfb7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">Connecting...</span>}
        {activeIds.size > 0 && <span className="border border-[#242424] bg-[#242424] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#fbfaf6]">{activeIds.size} Source{activeIds.size > 1 ? 's' : ''} Live</span>}
        {Array.from(errors.entries()).map(([id, msg]) => (
          <span key={id} className="border border-[#242424] bg-[#d6a19a] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#171717]">{msg}</span>
        ))}
      </div>
    </div>
  );
}
