import { useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { LIVE_SOURCES, getOrcasoundStreamUrl } from '../services/streams';
import type { LiveSource } from '../services/streams';
import { saveActiveStreams, getSavedState } from '../services/storage';

interface Props {
  onConnected: () => void;
  onActiveChange: (ids: Set<string>) => void;
}

interface ActiveStream {
  hls?: Hls;
}

const typeIconColors: Record<string, string> = {
  'hydrophone': 'text-[#4a9eff]',
  'weather-radio': 'text-[#ffaa33]',
  'vlf': 'text-[#cc66ff]',
  'soundscape': 'text-[#66cc88]',
};

export function StreamSelector({ onConnected, onActiveChange }: Props) {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const activeStreams = useRef<Map<string, ActiveStream>>(new Map());

  useEffect(() => {
    onActiveChange(activeIds);
    saveActiveStreams(Array.from(activeIds));
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
      if (source.hlsNode) {
        const hlsUrl = await getOrcasoundStreamUrl(source);

        if (Hls.isSupported()) {
          const hls = new Hls({
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
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

  // Auto-reconnect saved streams on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = getSavedState();
    if (!saved?.activeStreamIds.length) return;
    for (const id of saved.activeStreamIds) {
      const source = LIVE_SOURCES.find(s => s.id === id);
      if (source) connect(source);
    }
  }, [connect]);

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

  return (
    <div className="mb-3">
      <h3 className="text-xs text-[#666] mb-2 font-medium">Live Source</h3>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {LIVE_SOURCES.map(source => (
          <button
            key={source.id}
            className={`flex items-center gap-1 px-2 py-1 border rounded font-mono text-[11px] cursor-pointer transition-all duration-100 ${
              activeIds.has(source.id)
                ? 'border-[#4a7] bg-[#112211] text-[#8dc]'
                : 'border-[#2a2a2a] bg-[#161616] text-[#999] hover:border-[#444] hover:text-[#ddd]'
            }`}
            onClick={() => toggle(source)}
            title={`${source.description}\n${source.location}`}
          >
            <span className={`font-bold text-[13px] ${typeIconColors[source.type] || ''}`}>{typeIcons[source.type]}</span>
            <span className="font-medium">{source.name}</span>
            <span className="text-[#555] text-[10px]">{source.location}</span>
          </button>
        ))}
      </div>
      <div className="min-h-[18px]">
        {loadingIds.size > 0 && <span className="text-[10px] px-2 py-0.5 rounded-sm text-[#fa0] bg-[#332200]">connecting...</span>}
        {activeIds.size > 0 && <span className="text-[10px] px-2 py-0.5 rounded-sm text-[#4c4] bg-[#113311]">{activeIds.size} source{activeIds.size > 1 ? 's' : ''} live</span>}
        {Array.from(errors.entries()).map(([id, msg]) => (
          <span key={id} className="text-[10px] px-2 py-0.5 rounded-sm text-[#f44] bg-[#331111]">{msg}</span>
        ))}
      </div>
    </div>
  );
}
