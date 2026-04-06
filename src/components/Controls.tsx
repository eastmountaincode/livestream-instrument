import { useState, useEffect } from 'react';
import { audioEngine } from '../services/AudioEngine';
import { LIVE_SOURCES } from '../services/streams';

interface Props {
  activeSourceIds: Set<string>;
}

function StreamControls({ id, soloId, onSolo }: { id: string; soloId: string | null; onSolo: (id: string | null) => void }) {
  const source = LIVE_SOURCES.find(s => s.id === id);
  const [q, setQ] = useState(() => audioEngine.getStreamFilterQ(id));
  const [vol, setVol] = useState(() => audioEngine.getStreamVolume(id));
  const [oct, setOct] = useState(() => audioEngine.getStreamOctave(id));
  const [pan, setPan] = useState(() => audioEngine.getStreamPan(id));
  const [muted, setMuted] = useState(() => audioEngine.getStreamMuted(id));

  return (
    <div className={`flex items-center gap-2 py-1 border-b border-[#1e1e1e] last:border-b-0 ${muted ? '[&_.sc-name]:opacity-40 [&_.sc-label]:opacity-40 [&_.sc-value]:opacity-40' : ''}`}>
      <span className="sc-name text-[11px] font-semibold text-[#8ab] w-[90px] min-w-[90px] whitespace-nowrap overflow-hidden text-ellipsis">{source?.name ?? id}</span>
      <label className="flex items-center gap-1 text-[#888] flex-1 min-w-0">
        <span className="sc-label text-[11px] min-w-[24px]">Q</span>
        <input
          type="range"
          min="1"
          max="100"
          step="0.5"
          value={q}
          className="flex-1 min-w-0"
          onChange={e => {
            const val = parseFloat(e.target.value);
            setQ(val);
            audioEngine.setStreamFilterQ(id, val);
          }}
        />
        <span className="sc-value text-[11px] text-[#6a8aaa] min-w-[30px] text-right">{q.toFixed(0)}</span>
      </label>
      <label className="flex items-center gap-1 text-[#888] flex-1 min-w-0">
        <span className="sc-label text-[11px] min-w-[24px]">Vol</span>
        <input
          type="range"
          min="0"
          max="8"
          step="0.01"
          value={vol}
          className="flex-1 min-w-0"
          onChange={e => {
            const val = parseFloat(e.target.value);
            setVol(val);
            audioEngine.setStreamVolume(id, val);
          }}
        />
        <span className="sc-value text-[11px] text-[#6a8aaa] min-w-[30px] text-right">{Math.round(vol * 100)}%</span>
      </label>
      <label className="flex items-center gap-1 text-[#888] flex-1 min-w-0">
        <span className="sc-label text-[11px] min-w-[24px]">Pan</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={pan}
          className="flex-1 min-w-0"
          onChange={e => {
            const val = parseFloat(e.target.value);
            setPan(val);
            audioEngine.setStreamPan(id, val);
          }}
        />
        <span className="sc-value text-[11px] text-[#6a8aaa] min-w-[30px] text-right">{pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}</span>
      </label>
      <div className="flex items-center gap-1 text-[11px] text-[#888]">
        <button
          className="w-5 h-5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer text-xs flex items-center justify-center p-0"
          onClick={() => {
            const next = oct - 1;
            setOct(next);
            audioEngine.setStreamOctave(id, next);
          }}
        >-</button>
        <span>Oct {oct >= 0 ? `+${oct}` : oct}</span>
        <button
          className="w-5 h-5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer text-xs flex items-center justify-center p-0"
          onClick={() => {
            const next = oct + 1;
            setOct(next);
            audioEngine.setStreamOctave(id, next);
          }}
        >+</button>
      </div>
      <button
        className={`w-6 h-6 border rounded-sm cursor-pointer font-mono text-[10px] font-bold shrink-0 ${
          soloId === id
            ? 'bg-[#224411] border-[#446622] text-[#4c4]'
            : 'bg-[#222] border-[#333] text-[#888]'
        }`}
        onClick={() => {
          const next = soloId === id ? null : id;
          onSolo(next);
          audioEngine.setStreamSolo(next);
        }}
      >
        S
      </button>
      <button
        className={`w-6 h-6 border rounded-sm cursor-pointer font-mono text-[10px] font-bold shrink-0 ${
          muted
            ? 'bg-[#442211] border-[#664422] text-[#fa0]'
            : 'bg-[#222] border-[#333] text-[#888]'
        }`}
        onClick={() => {
          const next = !muted;
          setMuted(next);
          audioEngine.setStreamMuted(id, next);
        }}
      >
        M
      </button>
    </div>
  );
}

export function Controls({ activeSourceIds }: Props) {
  const [streamIds, setStreamIds] = useState<string[]>([]);
  const [soloId, setSoloId] = useState<string | null>(null);

  useEffect(() => {
    setStreamIds(Array.from(activeSourceIds));
    // Clear solo if the soloed stream was removed
    if (soloId && !activeSourceIds.has(soloId)) {
      setSoloId(null);
      audioEngine.setStreamSolo(null);
    }
  }, [activeSourceIds, soloId]);

  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2.5 bg-[#141414] rounded-md mb-3">
      {streamIds.length === 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="text-[11px] font-semibold text-[#555] w-[90px] min-w-[90px]">No sources active</span>
        </div>
      )}
      {streamIds.map(id => (
        <StreamControls key={id} id={id} soloId={soloId} onSolo={setSoloId} />
      ))}
      <div className="flex items-center gap-3 pt-1.5 border-t border-[#2a2a2a]">
        <button
          className="ml-auto px-3 py-1 border border-[#533] rounded-sm bg-[#221111] text-[#c88] cursor-pointer font-mono text-[10px] hover:bg-[#331818] hover:text-[#faa]"
          onClick={() => audioEngine.allNotesOff()}
        >
          All Notes Off
        </button>
      </div>
    </div>
  );
}
