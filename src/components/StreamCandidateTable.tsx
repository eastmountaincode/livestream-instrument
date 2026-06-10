'use client';

import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDefaultTimeZoneForLocation, type StreamCandidate, type StreamReviewStatus } from '../data/streamCandidates';

type SaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface ApiResponse {
  candidates?: StreamCandidate[];
  configured?: boolean;
  writable?: boolean;
  error?: string;
}

const STATUS_OPTIONS: StreamReviewStatus[] = ['unreviewed', 'accepted', 'rejected'];
const fieldClass = 'h-9 w-full border-2 border-black bg-white px-3 text-black outline-none focus:bg-[#f3d85a] disabled:bg-[#f2f0e8] disabled:text-black/60';

function titleCaseValue(value: string) {
  return value
    .split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .join(' ');
}

function statusClass(status: StreamReviewStatus): string {
  if (status === 'accepted') return 'border-black bg-black text-white';
  if (status === 'rejected') return 'border-black bg-[#f18a7a] text-black';
  return 'border-black bg-white text-black';
}

function formatLocalTime(date: Date, timeZone: string): string {
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

function proxyUrl(url: string): string {
  return `/api/stream-preview?url=${encodeURIComponent(url)}`;
}

async function getPlayableStreamUrl(candidate: StreamCandidate): Promise<string> {
  const url = candidate.streamUrl.trim();
  if (!url) throw new Error('No stream URL');

  if (candidate.format.toLowerCase().includes('hls via latest.txt')) {
    const timestampResponse = await fetch(proxyUrl(url), { cache: 'no-store' });
    if (!timestampResponse.ok) throw new Error('Could not resolve HLS timestamp');
    const timestamp = (await timestampResponse.text()).trim();
    const baseUrl = url.replace(/\/latest\.txt(?:\?.*)?$/, '');
    return `${baseUrl}/hls/${timestamp}/live.m3u8`;
  }

  return url;
}

function AuditionCell({ candidate }: { candidate: StreamCandidate }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    hlsRef.current?.destroy();
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    setIsLoading(false);
    setError('');
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [candidate.streamUrl, candidate.format]);

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
  };

  const hasStream = Boolean(candidate.streamUrl.trim());

  const play = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    setIsLoading(true);
    setError('');

    try {
      const streamUrl = await getPlayableStreamUrl(candidate);
      const isHls = streamUrl.includes('.m3u8');
      hlsRef.current?.destroy();
      hlsRef.current = null;

      if (isHls && Hls.isSupported()) {
        const hls = new Hls({
          liveSyncDurationCount: 6,
          liveMaxLatencyDurationCount: 12,
          maxBufferLength: 60,
          backBufferLength: 30,
          manifestLoadingMaxRetry: 6,
          fragLoadingMaxRetry: 6,
        });
        hlsRef.current = hls;
        const ready = new Promise<void>((resolve, reject) => {
          hls.once(Hls.Events.MANIFEST_PARSED, () => resolve());
          hls.once(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) reject(new Error(`HLS error: ${data.type}`));
          });
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(audio);
        await ready;
      } else if (isHls && audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = streamUrl;
      } else {
        audio.src = proxyUrl(streamUrl);
      }

      audio.volume = 0.8;
      await audio.play();
      setIsPlaying(true);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : 'Could not play');
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-w-[150px] flex-col gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          className="h-8 flex-1 border-2 border-black bg-white px-2 text-xs font-black uppercase text-black hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!hasStream || isLoading}
          onClick={isPlaying ? stop : play}
        >
          {!hasStream ? 'No stream' : isLoading ? '...' : isPlaying ? 'Stop' : 'Play'}
        </button>
        {candidate.pageUrl && (
          <a
            className="flex h-8 w-12 items-center justify-center border-2 border-black bg-white text-[10px] font-black uppercase text-black hover:bg-black hover:text-white"
            href={candidate.pageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open source page for ${candidate.name}`}
          >
            Open
          </a>
        )}
      </div>
      {error && <span className="border-2 border-black bg-[#f18a7a] px-1 text-[10px] font-black uppercase text-black">{error}</span>}
      <audio
        ref={audioRef}
        onError={() => {
          setError('Failed to load audio');
          setIsLoading(false);
          setIsPlaying(false);
        }}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlaying={() => setIsPlaying(true)}
      />
    </div>
  );
}

export function StreamCandidateTable() {
  const [candidates, setCandidates] = useState<StreamCandidate[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [writable, setWritable] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StreamReviewStatus | 'all'>('all');
  const [now, setNow] = useState(() => new Date());
  const hasLoaded = useRef(false);
  const editVersion = useRef(0);
  const savedVersion = useRef(0);

  const categories = useMemo(() => (
    Array.from(new Set(candidates.map(candidate => candidate.category).filter(Boolean))).sort()
  ), [candidates]);

  const visibleCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return candidates.filter(candidate => {
      if (categoryFilter !== 'all' && candidate.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
      if (!normalizedQuery) return true;

      return [
        candidate.name,
        candidate.category,
        candidate.location,
        candidate.source,
        candidate.format,
        candidate.streamUrl,
        candidate.pageUrl,
        candidate.notes,
      ].some(value => value.toLowerCase().includes(normalizedQuery));
    });
  }, [candidates, categoryFilter, query, statusFilter]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/stream-candidates', { cache: 'no-store' });
        const payload = await response.json() as ApiResponse;
        if (!response.ok) throw new Error(payload.error || 'Failed to load stream candidates');
        if (cancelled) return;
        setCandidates(payload.candidates ?? []);
        setConfigured(payload.configured ?? false);
        setWritable(payload.writable ?? false);
        setSaveState('idle');
        hasLoaded.current = true;
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load stream candidates');
        setSaveState('error');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoaded.current || !configured || !writable || savedVersion.current === editVersion.current) return;
    const versionToSave = editVersion.current;

    const timeout = window.setTimeout(async () => {
      setSaveState('saving');
      setError('');

      try {
        const response = await fetch('/api/stream-candidates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidates }),
        });
        const payload = await response.json() as ApiResponse;
        if (!response.ok) throw new Error(payload.error || 'Failed to save stream candidates');
        setConfigured(payload.configured ?? configured);
        setWritable(payload.writable ?? writable);
        savedVersion.current = Math.max(savedVersion.current, versionToSave);
        setSaveState(editVersion.current === versionToSave ? 'saved' : 'saving');
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Failed to save stream candidates');
        setSaveState('error');
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [candidates, configured, writable]);

  const updateCandidate = (id: string, patch: Partial<StreamCandidate>) => {
    editVersion.current += 1;
    setCandidates(current => current.map(candidate => (
      candidate.id === id
        ? { ...candidate, ...patch, updatedAt: new Date().toISOString() }
        : candidate
    )));
  };

  const removeCandidate = (id: string) => {
    editVersion.current += 1;
    setCandidates(current => current.filter(candidate => candidate.id !== id));
  };

  const counts = useMemo(() => ({
    total: candidates.length,
    accepted: candidates.filter(candidate => candidate.status === 'accepted').length,
    rejected: candidates.filter(candidate => candidate.status === 'rejected').length,
    unreviewed: candidates.filter(candidate => candidate.status === 'unreviewed').length,
  }), [candidates]);

  return (
    <main className="min-h-screen bg-[#f2f0e8] text-black">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-white p-3">
          <div className="flex items-baseline gap-3">
            <a href="/" className="border-2 border-black bg-black px-2 py-1 text-sm font-black uppercase text-white hover:bg-white hover:text-black">Cicada</a>
            <h1 className="text-base font-black uppercase text-black">Stream Review</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase text-black">
            <span className="border-2 border-black px-2 py-1">{counts.total} Rows</span>
            <span className="border-2 border-black px-2 py-1">{counts.accepted} Accepted</span>
            <span className="border-2 border-black px-2 py-1">{counts.rejected} Rejected</span>
            <span className="border-2 border-black px-2 py-1">{counts.unreviewed} Unreviewed</span>
            <span className={saveState === 'error' ? 'border-2 border-black bg-[#f18a7a] px-2 py-1 text-black' : 'border-2 border-black px-2 py-1 text-black'}>
              {saveState === 'loading' ? 'Loading' : saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Error' : writable ? 'Ready' : 'Read Only'}
            </span>
          </div>
        </header>

        {(!configured || error || !writable) && (
          <div className="border-2 border-black bg-[#f3d85a] px-3 py-2 text-xs font-black uppercase text-black">
            {error || 'Stream candidates are code-backed. Local edits save to src/data/streamCandidates.ts.'}
          </div>
        )}

        <section className="grid gap-2 border-2 border-black bg-white p-3 md:grid-cols-[1fr_220px_180px]">
          <input
            className="h-9 border-2 border-black bg-white px-3 text-sm font-bold text-black outline-none focus:bg-[#f3d85a]"
            placeholder="Search"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <select
            className="h-9 border-2 border-black bg-white px-3 text-sm font-bold text-black outline-none focus:bg-[#f3d85a]"
            value={categoryFilter}
            onChange={event => setCategoryFilter(event.target.value)}
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            className="h-9 border-2 border-black bg-white px-3 text-sm font-bold text-black outline-none focus:bg-[#f3d85a]"
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as StreamReviewStatus | 'all')}
          >
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map(status => (
              <option key={status} value={status}>{titleCaseValue(status)}</option>
            ))}
          </select>
        </section>

        <div className="overflow-x-auto border-2 border-black bg-white">
          <table className="w-full min-w-[2370px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#f2f0e8] text-[10px] font-black uppercase text-black/60">
              <tr>
                <th className="w-[170px] border-b-2 border-r border-black px-2 py-2">Audition</th>
                <th className="w-[210px] border-b-2 border-r border-black px-2 py-2">Status</th>
                <th className="w-[170px] border-b-2 border-r border-black px-2 py-2">Category</th>
                <th className="w-[210px] border-b-2 border-r border-black px-2 py-2">Name</th>
                <th className="w-[250px] border-b-2 border-r border-black px-2 py-2">Location</th>
                <th className="w-[100px] border-b-2 border-r border-black px-2 py-2">Local Time</th>
                <th className="w-[300px] border-b-2 border-r border-black px-2 py-2">Stream URL</th>
                <th className="w-[230px] border-b-2 border-r border-black px-2 py-2">Page</th>
                <th className="w-[190px] border-b-2 border-r border-black px-2 py-2">Format</th>
                <th className="w-[150px] border-b-2 border-r border-black px-2 py-2">Source</th>
                <th className="w-[320px] border-b-2 border-r border-black px-2 py-2">Notes</th>
                <th className="w-[68px] border-b-2 border-black px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map(candidate => (
                <tr key={candidate.id} className="border-b border-black align-top hover:bg-[#f7f1cf]">
                  <td className="border-r border-black px-2 py-2">
                    <AuditionCell candidate={candidate} />
                  </td>
                  <td className="border-r border-black px-3 py-2">
                    <select
                      className={`h-9 w-full border-2 px-3 pr-10 font-black uppercase outline-none ${statusClass(candidate.status)}`}
                      value={candidate.status}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { status: event.target.value as StreamReviewStatus })}
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>{titleCaseValue(status)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <input
                      list="stream-review-categories"
                      className={fieldClass}
                      value={candidate.category}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { category: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.name}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { name: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-3 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.location}
                      disabled={!writable}
                      onChange={event => {
                        const location = event.target.value;
                        updateCandidate(candidate.id, {
                          location,
                          timeZone: candidate.timeZone || getDefaultTimeZoneForLocation(location),
                        });
                      }}
                    />
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <span className="flex h-8 items-center whitespace-nowrap border-2 border-black bg-[#f2f0e8] px-2 font-mono text-[12px] font-black text-black">
                      {formatLocalTime(now, candidate.timeZone || getDefaultTimeZoneForLocation(candidate.location)) || '--'}
                    </span>
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.streamUrl}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { streamUrl: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.pageUrl}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { pageUrl: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-3 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.format}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { format: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <input
                      className={fieldClass}
                      value={candidate.source}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { source: event.target.value })}
                    />
                  </td>
                  <td className="border-r border-black px-2 py-2">
                    <textarea
                      className="min-h-16 w-full resize-y border-2 border-black bg-white px-2 py-1.5 text-black outline-none focus:bg-[#f3d85a]"
                      value={candidate.notes}
                      disabled={!writable}
                      onChange={event => updateCandidate(candidate.id, { notes: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="h-8 w-full border-2 border-black bg-white font-mono font-black uppercase text-black hover:bg-black hover:text-white"
                      disabled={!writable}
                      onClick={() => removeCandidate(candidate.id)}
                      aria-label={`Delete ${candidate.name || 'stream row'}`}
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="stream-review-categories">
            {categories.map(category => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </div>
      </div>
    </main>
  );
}
