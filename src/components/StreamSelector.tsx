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
  source: LiveSource;
  audio: HTMLAudioElement;
  hls?: Hls;
  cleanup?: () => void;
  reconnectTimerId?: number;
  watchdogId?: number;
  ready: boolean;
  lastProgressAt: number;
  lastCurrentTime: number;
  lastReconnectAt: number;
}

const SOURCE_LOAD_RETRIES = 3;
const SOURCE_LOAD_RETRY_DELAY_MS = 700;
const STREAM_WATCHDOG_INTERVAL_MS = 5_000;
const STREAM_STALL_TIMEOUT_MS = 20_000;
const STREAM_RECONNECT_DELAY_MS = 1_200;
const STREAM_RECONNECT_COOLDOWN_MS = 15_000;
const LIVE_EDGE_DRIFT_SECONDS = 20;
const MAX_HLS_RECOVERIES_BEFORE_RECONNECT = 5;

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

  const cleanupActiveStream = useCallback((sourceId: string, removeAudioChannel = true) => {
    const stream = activeStreams.current.get(sourceId);
    if (!stream) {
      if (removeAudioChannel) audioEngine.removeStream(sourceId);
      return;
    }

    if (stream.reconnectTimerId) window.clearTimeout(stream.reconnectTimerId);
    if (stream.watchdogId) window.clearInterval(stream.watchdogId);
    stream.cleanup?.();
    stream.hls?.destroy();
    stream.audio.pause();
    stream.audio.removeAttribute('src');
    stream.audio.load();
    if (removeAudioChannel) audioEngine.removeStream(sourceId);
    activeStreams.current.delete(sourceId);
  }, []);

  const disconnect = useCallback((sourceId: string) => {
    cleanupActiveStream(sourceId);
    setActiveIds(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
  }, [cleanupActiveStream]);

  useEffect(() => {
    return () => {
      for (const sourceId of Array.from(activeStreams.current.keys())) {
        cleanupActiveStream(sourceId);
      }
    };
  }, [cleanupActiveStream]);

  useEffect(() => {
    onRemoveSourceReady?.(disconnect);
    return () => onRemoveSourceReady?.(() => undefined);
  }, [disconnect, onRemoveSourceReady]);

  const connect = useCallback(async (source: LiveSource, options: { reconnect?: boolean } = {}) => {
    if (activeStreams.current.has(source.id) && !options.reconnect) return;

    if (options.reconnect) {
      cleanupActiveStream(source.id);
    }

    setLoadingIds(prev => new Set(prev).add(source.id));
    setErrors(prev => {
      const next = new Map(prev);
      next.delete(source.id);
      return next;
    });

    await audioEngine.resume();

    const audio = new Audio();
    audio.autoplay = true;
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');

    const stream: ActiveStream = {
      source,
      audio,
      ready: false,
      lastProgressAt: Date.now(),
      lastCurrentTime: 0,
      lastReconnectAt: 0,
    };
    activeStreams.current.set(source.id, stream);

    const isCurrentStream = () => activeStreams.current.get(source.id) === stream;

    const rememberProgress = () => {
      if (!isCurrentStream()) return;
      stream.lastProgressAt = Date.now();
      stream.lastCurrentTime = audio.currentTime;
    };

    const scheduleReconnect = (reason: string, delayMs = STREAM_RECONNECT_DELAY_MS) => {
      if (!isCurrentStream() || stream.reconnectTimerId) return;

      const cooldownRemaining = stream.lastReconnectAt
        ? Math.max(0, STREAM_RECONNECT_COOLDOWN_MS - (Date.now() - stream.lastReconnectAt))
        : 0;
      const reconnectDelay = Math.max(delayMs, cooldownRemaining);

      setLoadingIds(prev => new Set(prev).add(source.id));
      setErrors(prev => new Map(prev).set(source.id, reason));
      stream.reconnectTimerId = window.setTimeout(() => {
        stream.reconnectTimerId = undefined;
        if (!isCurrentStream()) return;
        stream.lastReconnectAt = Date.now();
        console.warn(`Recovering stream ${source.id}: ${reason}`);
        void connect(stream.source, { reconnect: true });
      }, reconnectDelay);
    };

    const startPlayback = () => {
      void audio.play().then(rememberProgress).catch(() => {
        scheduleReconnect('Restarting stream playback');
      });
    };

    const onReady = () => {
      if (!isCurrentStream() || stream.ready) return;
      stream.ready = true;
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
      startPlayback();
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setActiveIds(prev => new Set(prev).add(source.id));
      onConnected();
    };

    const onError = (msg: string) => {
      if (!isCurrentStream()) return;
      cleanupActiveStream(source.id);
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
      const onMediaFailure = () => {
        scheduleReconnect('Reconnecting stream');
      };
      const onWaiting = () => {
        stream.lastProgressAt = Math.min(stream.lastProgressAt, Date.now() - STREAM_STALL_TIMEOUT_MS);
      };
      const onRecoverySignal = () => {
        if (!isCurrentStream()) return;
        void audioEngine.resume();
        stream.hls?.startLoad();
        if (audio.paused || audio.ended) startPlayback();
      };

      audio.addEventListener('playing', rememberProgress);
      audio.addEventListener('timeupdate', rememberProgress);
      audio.addEventListener('progress', rememberProgress);
      audio.addEventListener('loadeddata', rememberProgress);
      audio.addEventListener('canplay', rememberProgress);
      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('stalled', onWaiting);
      audio.addEventListener('ended', onMediaFailure);
      audio.addEventListener('error', onMediaFailure);
      document.addEventListener('visibilitychange', onRecoverySignal);
      document.addEventListener('pointerdown', onRecoverySignal);
      document.addEventListener('keydown', onRecoverySignal);
      window.addEventListener('focus', onRecoverySignal);

      stream.cleanup = () => {
        audio.removeEventListener('playing', rememberProgress);
        audio.removeEventListener('timeupdate', rememberProgress);
        audio.removeEventListener('progress', rememberProgress);
        audio.removeEventListener('loadeddata', rememberProgress);
        audio.removeEventListener('canplay', rememberProgress);
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('stalled', onWaiting);
        audio.removeEventListener('ended', onMediaFailure);
        audio.removeEventListener('error', onMediaFailure);
        document.removeEventListener('visibilitychange', onRecoverySignal);
        document.removeEventListener('pointerdown', onRecoverySignal);
        document.removeEventListener('keydown', onRecoverySignal);
        window.removeEventListener('focus', onRecoverySignal);
      };

      stream.watchdogId = window.setInterval(() => {
        if (!isCurrentStream() || !stream.ready) return;

        void audioEngine.resume();

        const liveSyncPosition = stream.hls?.liveSyncPosition;
        if (
          typeof liveSyncPosition === 'number' &&
          Number.isFinite(liveSyncPosition) &&
          liveSyncPosition - audio.currentTime > LIVE_EDGE_DRIFT_SECONDS
        ) {
          audio.currentTime = liveSyncPosition;
          rememberProgress();
          stream.hls?.startLoad();
        }

        if (audio.paused || audio.ended) {
          startPlayback();
          return;
        }

        const stalledFor = Date.now() - stream.lastProgressAt;
        const timeIsAdvancing = Math.abs(audio.currentTime - stream.lastCurrentTime) > 0.05;
        if (timeIsAdvancing) {
          rememberProgress();
          return;
        }

        if (stalledFor >= STREAM_STALL_TIMEOUT_MS) {
          scheduleReconnect(`No media progress for ${Math.round(stalledFor / 1000)}s`);
        }
      }, STREAM_WATCHDOG_INTERVAL_MS);

      if (source.hlsUrl || source.latestTxtUrl || source.hlsNode) {
        const hlsUrl = source.hlsUrl || await getOrcasoundStreamUrl(source);

        if (Hls.isSupported()) {
          const hls = new Hls({
            lowLatencyMode: true,
            liveSyncDurationCount: 6,
            liveMaxLatencyDurationCount: 12,
            maxBufferLength: 60,
            backBufferLength: 30,
            manifestLoadingMaxRetry: 999,
            levelLoadingMaxRetry: 999,
            fragLoadingMaxRetry: 999,
            manifestLoadingRetryDelay: 1000,
            levelLoadingRetryDelay: 1000,
            fragLoadingRetryDelay: 1000,
          });
          stream.hls = hls;

          hls.loadSource(hlsUrl);
          hls.attachMedia(audio);
          hls.once(Hls.Events.MANIFEST_PARSED, onReady);
          hls.on(Hls.Events.FRAG_LOADED, rememberProgress);
          hls.on(Hls.Events.LEVEL_LOADED, rememberProgress);

          let retryCount = 0;
          hls.on(Hls.Events.ERROR, async (_event, data) => {
            if (!isCurrentStream()) return;
            if (!data.fatal) {
              if (String(data.details).toLowerCase().includes('stalled')) {
                stream.lastProgressAt = Math.min(stream.lastProgressAt, Date.now() - STREAM_STALL_TIMEOUT_MS);
              }
              return;
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < MAX_HLS_RECOVERIES_BEFORE_RECONNECT) {
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
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retryCount < MAX_HLS_RECOVERIES_BEFORE_RECONNECT) {
              retryCount++;
              hls.recoverMediaError();
            } else {
              scheduleReconnect(`Recovering ${data.type.toLowerCase()} stream`);
            }
          });
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = hlsUrl;
          audio.addEventListener('canplay', onReady, { once: true });
          audio.load();
        } else {
          onError('HLS is not supported in this browser');
        }
      } else if (source.url) {
        audio.src = source.url;
        audio.addEventListener('canplay', onReady, { once: true });
        audio.load();
      } else {
        onError('Source does not have a playable stream URL');
      }
    } catch (err) {
      onError(String(err));
    }
  }, [cleanupActiveStream, defaultStreamSettings, onConnected]);

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
