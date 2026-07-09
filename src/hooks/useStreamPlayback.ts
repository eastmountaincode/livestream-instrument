import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { getOrcasoundStreamUrl, type LiveSource } from '../services/streams';
import { getStreamSettings, saveStreamSettings, type StreamSettings } from '../services/storage';

export type StreamPlaybackPhase =
  | 'idle'
  | 'resolving'
  | 'opening'
  | 'buffering'
  | 'playing'
  | 'stalled'
  | 'reconnecting'
  | 'blocked'
  | 'failed';

export interface StreamPlaybackStatus {
  sourceId: string;
  phase: StreamPlaybackPhase;
  message: string;
  attempt: number;
  updatedAt: number;
  nextRetryAt?: number;
  readyState?: number;
  networkState?: number;
  usingProxyFallback?: boolean;
}

interface UseStreamPlaybackOptions {
  defaultStreamSettings?: Record<string, Partial<StreamSettings>>;
  onConnected?: () => void;
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
  reconnectAttempt: number;
  hadSuccessfulPlayback: boolean;
  usingProxyFallback: boolean;
  notifiedConnected: boolean;
}

export interface StreamConnectOptions {
  reconnect?: boolean;
  reconnectAttempt?: number;
  hadSuccessfulPlayback?: boolean;
  useProxyFallback?: boolean;
}

const STREAM_WATCHDOG_INTERVAL_MS = 5_000;
const STREAM_STALL_TIMEOUT_MS = 35_000;
const STREAM_RECONNECT_DELAY_MS = 1_500;
const STREAM_MAX_START_ATTEMPTS = 3;
const STREAM_MAX_RECONNECT_BACKOFF_MS = 45_000;
const LIVE_EDGE_DRIFT_SECONDS = 20;
const MAX_HLS_RECOVERIES_BEFORE_RECONNECT = 3;

function shouldUseProxyFirst(source: LiveSource): boolean {
  if (!source.url || !source.proxyUrl || typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && source.url.startsWith('http:');
}

function readMediaState(audio: HTMLAudioElement) {
  return {
    readyState: audio.readyState,
    networkState: audio.networkState,
  };
}

function formatAttempt(attempt: number): string {
  return attempt > 0 ? `attempt ${attempt}` : 'first try';
}

export function useStreamPlayback({
  defaultStreamSettings = {},
  onConnected,
}: UseStreamPlaybackOptions = {}) {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [wantedIds, setWantedIds] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, StreamPlaybackStatus>>({});
  const activeStreams = useRef<Map<string, ActiveStream>>(new Map());
  const defaultsRef = useRef(defaultStreamSettings);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    defaultsRef.current = defaultStreamSettings;
  }, [defaultStreamSettings]);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  const setStatus = useCallback((
    sourceId: string,
    status: Omit<StreamPlaybackStatus, 'sourceId' | 'updatedAt'>,
  ) => {
    setStatuses(prev => ({
      ...prev,
      [sourceId]: {
        sourceId,
        updatedAt: Date.now(),
        ...status,
      },
    }));
  }, []);

  const removeStatus = useCallback((sourceId: string) => {
    setStatuses(prev => {
      if (!prev[sourceId]) return prev;
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
  }, []);

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
    setWantedIds(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
    setActiveIds(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
    removeStatus(sourceId);
  }, [cleanupActiveStream, removeStatus]);

  const connect = useCallback(async (source: LiveSource, options: StreamConnectOptions = {}) => {
    if (activeStreams.current.has(source.id) && !options.reconnect) return;

    if (options.reconnect) {
      cleanupActiveStream(source.id);
      setActiveIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }

    setWantedIds(prev => new Set(prev).add(source.id));

    const attempt = options.reconnectAttempt ?? 0;
    setStatus(source.id, {
      phase: 'resolving',
      message: options.reconnect ? `Rebuilding stream (${formatAttempt(attempt)})` : 'Resolving source',
      attempt,
      usingProxyFallback: options.useProxyFallback,
    });

    void audioEngine.resume().catch(() => undefined);

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
      reconnectAttempt: attempt,
      hadSuccessfulPlayback: options.hadSuccessfulPlayback ?? false,
      usingProxyFallback: options.useProxyFallback ?? false,
      notifiedConnected: false,
    };
    activeStreams.current.set(source.id, stream);

    const isCurrentStream = () => activeStreams.current.get(source.id) === stream;

    const updateStatusWithMedia = (
      phase: StreamPlaybackPhase,
      message: string,
      extra: Partial<StreamPlaybackStatus> = {},
    ) => {
      if (!isCurrentStream()) return;
      setStatus(source.id, {
        phase,
        message,
        attempt: stream.reconnectAttempt,
        usingProxyFallback: stream.usingProxyFallback,
        ...readMediaState(audio),
        ...extra,
      });
    };

    const markProgress = () => {
      if (!isCurrentStream()) return;
      stream.lastProgressAt = Date.now();
      stream.lastCurrentTime = audio.currentTime;
      stream.hadSuccessfulPlayback = true;
      if (!stream.ready) {
        updateStatusWithMedia('buffering', 'Starting audio');
        return;
      }
      setActiveIds(prev => new Set(prev).add(source.id));
      updateStatusWithMedia('playing', 'Playing');
      if (!stream.notifiedConnected) {
        stream.notifiedConnected = true;
        onConnectedRef.current?.();
      }
    };

    const failStream = (message: string) => {
      if (!isCurrentStream()) return;
      const mediaState = readMediaState(audio);
      cleanupActiveStream(source.id);
      setWantedIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setActiveIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
      setStatus(source.id, {
        phase: 'failed',
        message,
        attempt: stream.reconnectAttempt,
        usingProxyFallback: stream.usingProxyFallback,
        ...mediaState,
      });
    };

    const scheduleReconnect = (reason: string, delayMs = STREAM_RECONNECT_DELAY_MS) => {
      if (!isCurrentStream() || stream.reconnectTimerId) return;

      const nextAttempt = stream.reconnectAttempt + 1;
      if (!stream.hadSuccessfulPlayback && nextAttempt > STREAM_MAX_START_ATTEMPTS) {
        failStream(`${reason}; source did not start after ${STREAM_MAX_START_ATTEMPTS} tries`);
        return;
      }

      const backoffStep = Math.min(Math.max(0, nextAttempt - 1), 5);
      const reconnectDelay = Math.min(
        STREAM_MAX_RECONNECT_BACKOFF_MS,
        Math.round(delayMs * 2 ** backoffStep),
      );
      const nextRetryAt = Date.now() + reconnectDelay;

      setActiveIds(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });

      updateStatusWithMedia('reconnecting', reason, {
        attempt: nextAttempt,
        nextRetryAt,
      });

      stream.reconnectTimerId = window.setTimeout(() => {
        stream.reconnectTimerId = undefined;
        if (!isCurrentStream()) return;

        void connect(stream.source, {
          reconnect: true,
          reconnectAttempt: nextAttempt,
          hadSuccessfulPlayback: stream.hadSuccessfulPlayback,
          useProxyFallback: stream.usingProxyFallback,
        });
      }, reconnectDelay);
    };

    const startPlayback = () => {
      updateStatusWithMedia('buffering', 'Buffering audio');
      void audio.play().then(markProgress).catch((error) => {
        const errorName = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
        if (errorName === 'NotAllowedError') {
          setActiveIds(prev => {
            const next = new Set(prev);
            next.delete(source.id);
            return next;
          });
          updateStatusWithMedia('blocked', 'Tap source to start playback');
          return;
        }

        scheduleReconnect('Playback did not start');
      });
    };

    const applyCurrentSettings = () => {
      const savedSettings = getStreamSettings(source.id);
      const defaultSettings = defaultsRef.current[source.id];
      const shouldSaveDefaults = !savedSettings && !!defaultSettings;

      const nextSettings: StreamSettings = {
        filterQ: savedSettings?.filterQ ?? defaultSettings?.filterQ ?? audioEngine.getStreamFilterQ(source.id),
        volume: savedSettings?.volume ?? defaultSettings?.volume ?? audioEngine.getStreamVolume(source.id),
        highPassFreq: savedSettings?.highPassFreq ?? defaultSettings?.highPassFreq ?? audioEngine.getStreamHighPass(source.id),
        lowPassFreq: savedSettings?.lowPassFreq ?? defaultSettings?.lowPassFreq ?? audioEngine.getStreamLowPass(source.id),
        pan: savedSettings?.pan ?? defaultSettings?.pan ?? audioEngine.getStreamPan(source.id),
        octaveShift: savedSettings?.octaveShift ?? defaultSettings?.octaveShift ?? audioEngine.getStreamOctave(source.id),
        muted: savedSettings?.muted ?? defaultSettings?.muted ?? audioEngine.getStreamMuted(source.id),
      };
      audioEngine.setStreamFilterQ(source.id, nextSettings.filterQ);
      audioEngine.setStreamVolume(source.id, nextSettings.volume);
      audioEngine.setStreamHighPass(source.id, nextSettings.highPassFreq);
      audioEngine.setStreamLowPass(source.id, nextSettings.lowPassFreq);
      audioEngine.setStreamPan(source.id, nextSettings.pan);
      audioEngine.setStreamOctave(source.id, nextSettings.octaveShift);
      audioEngine.setStreamMuted(source.id, nextSettings.muted);
      if (shouldSaveDefaults) {
        saveStreamSettings(source.id, nextSettings);
      }
    };

    const attachAudioChannel = () => {
      if (!isCurrentStream()) return false;
      if (stream.ready) return true;

      try {
        audioEngine.addStream(source.id, audio);
        applyCurrentSettings();
        stream.ready = true;
        return true;
      } catch (error) {
        failStream(error instanceof Error ? error.message : 'Could not connect stream to audio engine');
        return false;
      }
    };

    const onReady = () => {
      if (!isCurrentStream() || stream.ready) return;
      if (!attachAudioChannel()) return;
      if (audio.paused) {
        startPlayback();
      } else {
        markProgress();
      }
    };

    try {
      const tryProxyFallback = () => {
        if (!source.proxyUrl || stream.usingProxyFallback || stream.ready) return false;

        void connect(source, {
          reconnect: true,
          reconnectAttempt: stream.reconnectAttempt,
          hadSuccessfulPlayback: stream.hadSuccessfulPlayback,
          useProxyFallback: true,
        });
        return true;
      };

      const onMediaFailure = () => {
        if (tryProxyFallback()) return;
        scheduleReconnect('Stream stopped');
      };
      const onMediaPause = () => {
        if (!isCurrentStream() || !stream.ready) return;
        startPlayback();
      };
      const onWaiting = () => {
        if (!isCurrentStream()) return;
        updateStatusWithMedia('stalled', 'Waiting for media');
      };
      const onLoadedData = () => {
        updateStatusWithMedia('buffering', 'Audio data loaded');
      };
      const onCanPlay = () => {
        updateStatusWithMedia('buffering', 'Audio can play');
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
          markProgress();
          return;
        }

        const stalledFor = Date.now() - stream.lastProgressAt;
        if (stream.ready && stalledFor >= STREAM_STALL_TIMEOUT_MS) {
          scheduleReconnect(`No media progress for ${Math.round(stalledFor / 1000)}s`, 0);
        }
      };

      audio.addEventListener('playing', markProgress);
      audio.addEventListener('timeupdate', markProgress);
      audio.addEventListener('loadeddata', onLoadedData);
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('stalled', onWaiting);
      audio.addEventListener('pause', onMediaPause);
      audio.addEventListener('ended', onMediaFailure);
      audio.addEventListener('error', onMediaFailure);
      document.addEventListener('visibilitychange', onRecoverySignal);
      document.addEventListener('pointerdown', onRecoverySignal);
      document.addEventListener('keydown', onRecoverySignal);
      window.addEventListener('focus', onRecoverySignal);
      window.addEventListener('online', onRecoverySignal);
      window.addEventListener('pageshow', onRecoverySignal);

      stream.cleanup = () => {
        audio.removeEventListener('playing', markProgress);
        audio.removeEventListener('timeupdate', markProgress);
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('stalled', onWaiting);
        audio.removeEventListener('pause', onMediaPause);
        audio.removeEventListener('ended', onMediaFailure);
        audio.removeEventListener('error', onMediaFailure);
        document.removeEventListener('visibilitychange', onRecoverySignal);
        document.removeEventListener('pointerdown', onRecoverySignal);
        document.removeEventListener('keydown', onRecoverySignal);
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
          stream.hls?.startLoad();
          updateStatusWithMedia('buffering', 'Catching up to live edge');
        }

        if (audio.paused || audio.ended) {
          startPlayback();
          return;
        }

        const timeIsAdvancing = Math.abs(audio.currentTime - stream.lastCurrentTime) > 0.05;
        if (timeIsAdvancing) {
          markProgress();
          return;
        }

        const stalledFor = Date.now() - stream.lastProgressAt;
        if (stalledFor >= STREAM_STALL_TIMEOUT_MS) {
          scheduleReconnect(`No media progress for ${Math.round(stalledFor / 1000)}s`);
        } else if (stalledFor >= STREAM_WATCHDOG_INTERVAL_MS * 2) {
          updateStatusWithMedia('stalled', `Checking stalled media (${Math.round(stalledFor / 1000)}s)`);
        }
      }, STREAM_WATCHDOG_INTERVAL_MS);

      if (source.hlsUrl || source.latestTxtUrl || source.hlsNode) {
        updateStatusWithMedia('resolving', source.latestTxtUrl || source.hlsNode ? 'Resolving latest HLS segment' : 'Opening HLS source');
        const hlsUrl = source.hlsUrl || await getOrcasoundStreamUrl(source);
        updateStatusWithMedia('opening', 'Opening HLS stream');

        if (Hls.isSupported()) {
          const hls = new Hls({
            lowLatencyMode: true,
            liveSyncDurationCount: 6,
            liveMaxLatencyDurationCount: 12,
            maxBufferLength: 60,
            backBufferLength: 30,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 2,
            fragLoadingMaxRetry: 2,
            manifestLoadingRetryDelay: 1000,
            levelLoadingRetryDelay: 1000,
            fragLoadingRetryDelay: 1000,
          });
          stream.hls = hls;

          hls.loadSource(hlsUrl);
          hls.attachMedia(audio);
          if (!attachAudioChannel()) return;
          startPlayback();
          hls.once(Hls.Events.MANIFEST_PARSED, onReady);

          let recoveryCount = 0;
          hls.on(Hls.Events.ERROR, async (_event, data) => {
            if (!isCurrentStream()) return;
            if (!data.fatal) {
              if (String(data.details).toLowerCase().includes('stalled')) {
                updateStatusWithMedia('stalled', 'HLS fragment stalled');
              }
              return;
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveryCount < MAX_HLS_RECOVERIES_BEFORE_RECONNECT) {
              recoveryCount++;
              updateStatusWithMedia('buffering', `Recovering HLS network error (${recoveryCount})`);
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
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveryCount < MAX_HLS_RECOVERIES_BEFORE_RECONNECT) {
              recoveryCount++;
              updateStatusWithMedia('buffering', `Recovering HLS media error (${recoveryCount})`);
              hls.recoverMediaError();
            } else {
              scheduleReconnect(`Recovering ${data.type.toLowerCase()} stream`);
            }
          });
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = hlsUrl;
          audio.addEventListener('canplay', onReady, { once: true });
          if (!attachAudioChannel()) return;
          audio.load();
          startPlayback();
        } else {
          failStream('HLS is not supported in this browser');
        }
      } else if (source.url) {
        stream.usingProxyFallback = options.useProxyFallback || shouldUseProxyFirst(source);
        const streamUrl = stream.usingProxyFallback && source.proxyUrl ? source.proxyUrl : source.url;
        updateStatusWithMedia('opening', stream.usingProxyFallback ? 'Opening proxied audio stream' : 'Opening audio stream');
        audio.src = streamUrl;
        audio.addEventListener('canplay', onReady, { once: true });
        if (!attachAudioChannel()) return;
        audio.load();
        startPlayback();
      } else {
        failStream('Source does not have a playable stream URL');
      }
    } catch (error) {
      failStream(error instanceof Error ? error.message : 'Could not open stream');
    }
  }, [cleanupActiveStream, setStatus]);

  useEffect(() => {
    const streams = activeStreams.current;
    return () => {
      for (const sourceId of Array.from(streams.keys())) {
        cleanupActiveStream(sourceId);
      }
    };
  }, [cleanupActiveStream]);

  return {
    activeIds,
    wantedIds,
    statuses,
    connect,
    disconnect,
  };
}
