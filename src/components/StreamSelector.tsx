import { useState, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { audioEngine } from '../services/AudioEngine';
import { LIVE_SOURCES, getOrcasoundStreamUrl } from '../services/streams';
import type { LiveSource } from '../services/streams';

interface Props {
  onConnected: () => void;
}

export function StreamSelector({ onConnected }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Keep refs to old HLS instances so they stay alive during crossfade
  const hlsInstances = useRef<Hls[]>([]);

  const connect = useCallback(async (source: LiveSource) => {
    setStatus('loading');
    setErrorMsg('');

    await audioEngine.resume();

    // Create a fresh audio element for the new source
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    const onReady = () => {
      // connectStream handles crossfade internally
      audioEngine.connectStream(audio);
      audio.play();
      setStatus('connected');
      onConnected();
    };

    const onError = (msg: string) => {
      setStatus('error');
      setErrorMsg(msg);
    };

    try {
      if (source.hlsNode) {
        const hlsUrl = await getOrcasoundStreamUrl(source);

        if (Hls.isSupported()) {
          const hls = new Hls({
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
          });
          hlsInstances.current.push(hls);
          // Clean up old HLS instances after crossfade (keep last 2)
          while (hlsInstances.current.length > 2) {
            const old = hlsInstances.current.shift();
            old?.destroy();
          }

          hls.loadSource(hlsUrl);
          hls.attachMedia(audio);
          hls.on(Hls.Events.MANIFEST_PARSED, onReady);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) onError(`HLS error: ${data.type}`);
          });
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = hlsUrl;
          audio.addEventListener('canplay', onReady, { once: true });
          audio.addEventListener('error', () => onError('Failed to load HLS stream'), { once: true });
          audio.load();
        }
      } else if (source.url) {
        audio.src = source.url;
        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('error', () => onError('Failed to load stream'), { once: true });
        audio.load();
      }
    } catch (err) {
      onError(String(err));
    }
  }, [onConnected]);

  const typeIcons: Record<string, string> = {
    'hydrophone': '~',
    'weather-radio': '>',
    'vlf': '*',
  };

  return (
    <div className="stream-selector">
      <h3>Live Source</h3>
      <div className="source-list">
        {LIVE_SOURCES.map(source => (
          <button
            key={source.id}
            className={`source-btn ${selectedId === source.id ? 'selected' : ''} type-${source.type}`}
            onClick={() => {
              setSelectedId(source.id);
              connect(source);
            }}
            title={`${source.description}\n${source.location}`}
          >
            <span className="source-icon">{typeIcons[source.type]}</span>
            <span className="source-name">{source.name}</span>
            <span className="source-location">{source.location}</span>
          </button>
        ))}
      </div>
      <div className="stream-status">
        {status === 'loading' && <span className="status loading">connecting...</span>}
        {status === 'connected' && <span className="status connected">live</span>}
        {status === 'error' && <span className="status error">{errorMsg}</span>}
      </div>
    </div>
  );
}
