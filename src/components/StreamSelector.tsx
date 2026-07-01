import { useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { fetchAcceptedLiveSources, getOrcasoundStreamUrl } from '../services/streams';
import type { LiveSource } from '../services/streams';
import { saveActiveStreams, getSavedState, getStreamSettings, saveStreamSettings } from '../services/storage';
import type { StreamSettings } from '../services/storage';
import { Badge } from './ui';

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
  reconnectAttempt: number;
  hadSuccessfulPlayback: boolean;
  usingProxyFallback: boolean;
}

const SOURCE_LOAD_RETRIES = 3;
const SOURCE_LOAD_RETRY_DELAY_MS = 700;
const STREAM_WATCHDOG_INTERVAL_MS = 10_000;
const STREAM_STALL_TIMEOUT_MS = 60_000;
const STREAM_RECONNECT_DELAY_MS = 1_200;
const STREAM_RECONNECT_COOLDOWN_MS = 15_000;
const STREAM_RECONNECT_STABLE_RESET_MS = 60_000;
const STREAM_MAX_RECONNECT_ATTEMPTS = 3;
const STREAM_MAX_RECONNECT_BACKOFF_MS = 60_000;
const LIVE_EDGE_DRIFT_SECONDS = 20;
const MAX_HLS_RECOVERIES_BEFORE_RECONNECT = 5;

interface ConnectOptions {
  reconnect?: boolean;
  reconnectAttempt?: number;
  lastReconnectAt?: number;
  hadSuccessfulPlayback?: boolean;
  useProxyFallback?: boolean;
}

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

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = activeIds.size > 0 ? 'playing' : 'none';

    return () => {
      navigator.mediaSession.playbackState = 'none';
    };
  }, [activeIds.size]);

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

  const connect = useCallback(async (source: LiveSource, options: ConnectOptions = {}) => {
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
      lastReconnectAt: options.lastReconnectAt ?? 0,
      reconnectAttempt: options.reconnectAttempt ?? 0,
      hadSuccessfulPlayback: options.hadSuccessfulPlayback ?? false,
      usingProxyFallback: options.useProxyFallback ?? false,
    };
    activeStreams.current.set(source.id, stream);

    const isCurrentStream = () => activeStreams.current.get(source.id) === stream;

    const rememberPlaybackProgress = () => {
      if (!isCurrentStream()) return;
      const now = Date.now();
      stream.lastProgressAt = now;
      stream.lastCurrentTime = audio.currentTime;
      setLoadingIds(prev => {
        if (!prev.has(source.id)) return prev;
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setErrors(prev => {
        if (!prev.has(source.id)) return prev;
        const next = new Map(prev);
        next.delete(source.id);
        return next;
      });

      if (
        stream.reconnectAttempt > 0 &&
        stream.lastReconnectAt &&
        now - stream.lastReconnectAt >= STREAM_RECONNECT_STABLE_RESET_MS
      ) {
        stream.reconnectAttempt = 0;
        stream.lastReconnectAt = 0;
      }
    };

    const failStream = (msg: string) => {
      if (!isCurrentStream()) return;
      cleanupActiveStream(source.id);
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setActiveIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setErrors(prev => new Map(prev).set(source.id, msg));
    };

    const scheduleReconnect = (reason: string, delayMs = STREAM_RECONNECT_DELAY_MS) => {
      if (!isCurrentStream() || stream.reconnectTimerId) return;

      const nextReconnectAttempt = stream.reconnectAttempt + 1;
      if (!stream.hadSuccessfulPlayback && nextReconnectAttempt > STREAM_MAX_RECONNECT_ATTEMPTS) {
        failStream(`${source.name} unavailable after ${STREAM_MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
        return;
      }

      const cooldownRemaining = stream.lastReconnectAt
        ? Math.max(0, STREAM_RECONNECT_COOLDOWN_MS - (Date.now() - stream.lastReconnectAt))
        : 0;
      const backoffStep = Math.min(Math.max(0, nextReconnectAttempt - 1), 6);
      const backoffDelay = Math.min(
        STREAM_MAX_RECONNECT_BACKOFF_MS,
        Math.round(delayMs * 2 ** backoffStep)
      );
      const reconnectDelay = Math.max(backoffDelay, cooldownRemaining);
      const retryLabel = stream.hadSuccessfulPlayback && nextReconnectAttempt > STREAM_MAX_RECONNECT_ATTEMPTS
        ? 'retrying'
        : `${nextReconnectAttempt}/${STREAM_MAX_RECONNECT_ATTEMPTS}`;

      setLoadingIds(prev => new Set(prev).add(source.id));
      setErrors(prev => new Map(prev).set(
        source.id,
        `${reason} (${retryLabel})`
      ));
      stream.reconnectTimerId = window.setTimeout(() => {
        stream.reconnectTimerId = undefined;
        if (!isCurrentStream()) return;
        const lastReconnectAt = Date.now();
        stream.lastReconnectAt = lastReconnectAt;
        console.warn(`Recovering stream ${source.id}: ${reason}`);
        void connect(stream.source, {
          reconnect: true,
          reconnectAttempt: nextReconnectAttempt,
          lastReconnectAt,
          hadSuccessfulPlayback: stream.hadSuccessfulPlayback,
          useProxyFallback: stream.usingProxyFallback,
        });
      }, reconnectDelay);
    };

    const startPlayback = () => {
      void audio.play().then(rememberPlaybackProgress).catch(() => {
        scheduleReconnect('Restarting stream playback');
      });
    };

    const onReady = () => {
      if (!isCurrentStream() || stream.ready) return;
      stream.ready = true;
      stream.hadSuccessfulPlayback = true;
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

    try {
      const tryProxyFallback = () => {
        if (!source.proxyUrl || stream.usingProxyFallback || stream.ready) return false;

        setErrors(prev => new Map(prev).set(source.id, 'Trying proxy fallback'));
        void connect(source, {
          reconnect: true,
          reconnectAttempt: stream.reconnectAttempt,
          lastReconnectAt: stream.lastReconnectAt,
          hadSuccessfulPlayback: stream.hadSuccessfulPlayback,
          useProxyFallback: true,
        });
        return true;
      };

      const onMediaFailure = () => {
        if (tryProxyFallback()) return;
        scheduleReconnect('Reconnecting stream');
      };
      const onMediaPause = () => {
        if (!isCurrentStream() || !stream.ready) return;
        startPlayback();
      };
      const onWaiting = () => {
        stream.lastProgressAt = Math.min(stream.lastProgressAt, Date.now() - STREAM_STALL_TIMEOUT_MS);
      };
      const onRecoverySignal = () => {
        if (!isCurrentStream()) return;
        void audioEngine.resume().catch(() => undefined);
        stream.hls?.startLoad();
        if (audio.paused || audio.ended) {
          startPlayback();
          return;
        }

        const timeIsAdvancing = Math.abs(audio.currentTime - stream.lastCurrentTime) > 0.05;
        if (timeIsAdvancing) {
          rememberPlaybackProgress();
          return;
        }

        const stalledFor = Date.now() - stream.lastProgressAt;
        if (stream.ready && stalledFor >= STREAM_STALL_TIMEOUT_MS) {
          scheduleReconnect(`Recovering inactive stream after ${Math.round(stalledFor / 1000)}s`, 0);
        }
      };

      audio.addEventListener('playing', rememberPlaybackProgress);
      audio.addEventListener('timeupdate', rememberPlaybackProgress);
      audio.addEventListener('loadeddata', rememberPlaybackProgress);
      audio.addEventListener('canplay', rememberPlaybackProgress);
      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('stalled', onWaiting);
      audio.addEventListener('pause', onMediaPause);
      audio.addEventListener('ended', onMediaFailure);
      audio.addEventListener('error', onMediaFailure);
      document.addEventListener('visibilitychange', onRecoverySignal);
      document.addEventListener('pointerdown', onRecoverySignal);
      document.addEventListener('keydown', onRecoverySignal);
      document.addEventListener('resume', onRecoverySignal);
      window.addEventListener('focus', onRecoverySignal);
      window.addEventListener('online', onRecoverySignal);
      window.addEventListener('pageshow', onRecoverySignal);

      stream.cleanup = () => {
        audio.removeEventListener('playing', rememberPlaybackProgress);
        audio.removeEventListener('timeupdate', rememberPlaybackProgress);
        audio.removeEventListener('loadeddata', rememberPlaybackProgress);
        audio.removeEventListener('canplay', rememberPlaybackProgress);
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('stalled', onWaiting);
        audio.removeEventListener('pause', onMediaPause);
        audio.removeEventListener('ended', onMediaFailure);
        audio.removeEventListener('error', onMediaFailure);
        document.removeEventListener('visibilitychange', onRecoverySignal);
        document.removeEventListener('pointerdown', onRecoverySignal);
        document.removeEventListener('keydown', onRecoverySignal);
        document.removeEventListener('resume', onRecoverySignal);
        window.removeEventListener('focus', onRecoverySignal);
        window.removeEventListener('online', onRecoverySignal);
        window.removeEventListener('pageshow', onRecoverySignal);
      };

      stream.watchdogId = window.setInterval(() => {
        if (!isCurrentStream() || !stream.ready) return;

        void audioEngine.resume().catch(() => undefined);

        const liveSyncPosition = stream.hls?.liveSyncPosition;
        if (
          typeof liveSyncPosition === 'number' &&
          Number.isFinite(liveSyncPosition) &&
          liveSyncPosition - audio.currentTime > LIVE_EDGE_DRIFT_SECONDS
        ) {
          audio.currentTime = liveSyncPosition;
          rememberPlaybackProgress();
          stream.hls?.startLoad();
        }

        if (audio.paused || audio.ended) {
          startPlayback();
          return;
        }

        const stalledFor = Date.now() - stream.lastProgressAt;
        const timeIsAdvancing = Math.abs(audio.currentTime - stream.lastCurrentTime) > 0.05;
        if (timeIsAdvancing) {
          rememberPlaybackProgress();
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
            manifestLoadingMaxRetry: 3,
            levelLoadingMaxRetry: 3,
            fragLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
            levelLoadingRetryDelay: 1000,
            fragLoadingRetryDelay: 1000,
          });
          stream.hls = hls;

          hls.loadSource(hlsUrl);
          hls.attachMedia(audio);
          hls.once(Hls.Events.MANIFEST_PARSED, onReady);

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
          failStream('HLS is not supported in this browser');
        }
      } else if (source.url) {
        audio.src = stream.usingProxyFallback && source.proxyUrl ? source.proxyUrl : source.url;
        audio.addEventListener('canplay', onReady, { once: true });
        audio.load();
      } else {
        failStream('Source does not have a playable stream URL');
      }
    } catch (err) {
      failStream(String(err));
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
          <div className="border border-ink bg-paper px-2 py-1 text-[11px] font-semibold uppercase text-muted">Loading Approved Stream Sources...</div>
        )}
        {groupedSources.map(([category, categorySources]) => (
          <div key={category} className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase text-muted">{category}</span>
            <div className="grid gap-1">
            {categorySources.map(source => {
              const localTime = formatLocalTime(clock, source.timeZone);
              const active = activeIds.has(source.id);

              return (
                <button
                  key={source.id}
                  className={`grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase ${
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-ink bg-paper text-copy hover:bg-surface'
                  }`}
                  onClick={() => toggle(source)}
                  title={`${source.description}\n${source.location}${localTime ? `\nLocal time: ${localTime}` : ''}`}
                >
                  <span className="min-w-0 whitespace-normal break-words leading-tight">{source.name}</span>
                  {localTime && (
                    <span className={active ? 'shrink-0 border border-paper px-1.5 py-0.5 text-[9px] text-paper' : 'shrink-0 border border-ink px-1.5 py-0.5 text-[9px] text-copy'}>
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
      <div className="flex min-h-[28px] flex-wrap gap-1 border-ink pt-2">
        {sourceLoadError && <Badge tone="muted">{sourceLoadError}</Badge>}
        {sourcesReady && !sourceLoadError && sources.length === 0 && (
          <Badge tone="muted">No Approved Stream Sources Loaded</Badge>
        )}
        {loadingIds.size > 0 && <Badge tone="muted">Connecting...</Badge>}
        {activeIds.size > 0 && <Badge tone="active">{activeIds.size} Source{activeIds.size > 1 ? 's' : ''} Live</Badge>}
        {Array.from(errors.entries()).map(([id, msg]) => (
          <Badge key={id} tone="error">{msg}</Badge>
        ))}
      </div>
    </div>
  );
}
