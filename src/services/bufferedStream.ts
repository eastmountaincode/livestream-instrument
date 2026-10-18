import type { LiveSource } from './streams';

const MIME = 'audio/mpeg';
const MAX_BUFFER_AHEAD = 30;

export function supportsBufferedStream(source: LiveSource): boolean {
  return Boolean(source.url && !source.hlsUrl && !source.latestTxtUrl && !source.hlsNode
    && (/\.mp3(?:[?#]|$)/i.test(source.url) || /mp3|mpeg/i.test(source.format ?? ''))
    && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MIME));
}

function waitFor(target: EventTarget, event: string, signal: AbortSignal, action?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Could not decode buffered stream')); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    if (signal.aborted) { aborted(); return; }
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    try { action?.(); } catch (error) { cleanup(); reject(error); }
  });
}

function waitForPlayback(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 250);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** Keep fetching while playback refills; native <audio> preload can stop after ~2s. */
export function openBufferedStream(
  audio: HTMLAudioElement,
  url: string,
  onData: () => void,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const media = new MediaSource();
  const objectUrl = URL.createObjectURL(media);
  const opened = waitFor(media, 'sourceopen', signal);
  audio.src = objectUrl;

  void (async () => {
    await opened;
    const buffer = media.addSourceBuffer(MIME);
    const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error(`Stream request failed (${response.status})`);
    const reader = response.body.getReader();
    try {
      while (!signal.aborted) {
        // Bound memory even when a tab or its AudioContext stops consuming audio.
        while (buffer.buffered.length && buffer.buffered.end(buffer.buffered.length - 1) - audio.currentTime > MAX_BUFFER_AHEAD) {
          await waitForPlayback(signal);
        }
        const { done, value } = await reader.read();
        if (done) {
          if (media.readyState === 'open') media.endOfStream();
          onData();
          break;
        }
        await waitFor(buffer, 'updateend', signal, () => buffer.appendBuffer(value));
        onData();
        if (buffer.buffered.length && audio.currentTime - buffer.buffered.start(0) > 30) {
          await waitFor(buffer, 'updateend', signal, () => buffer.remove(0, audio.currentTime - 10));
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  })().catch(error => {
    if (!signal.aborted) onError(error instanceof Error ? error : new Error(String(error)));
  });

  return () => {
    controller.abort();
    URL.revokeObjectURL(objectUrl);
  };
}
