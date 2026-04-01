import { useState } from 'react';
import { audioEngine } from '../services/AudioEngine';

interface Props {
  octaveShift: number;
  setOctaveShift: React.Dispatch<React.SetStateAction<number>>;
}

export function Controls({ octaveShift, setOctaveShift }: Props) {
  const [filterQ, setFilterQ] = useState(audioEngine.getFilterQ());
  const [masterVol, setMasterVol] = useState(0.8);

  return (
    <div className="controls">
      <label>
        <span className="control-label">Resonance (Q)</span>
        <input
          type="range"
          min="1"
          max="100"
          step="0.5"
          value={filterQ}
          onChange={e => {
            const q = parseFloat(e.target.value);
            setFilterQ(q);
            audioEngine.setFilterQ(q);
          }}
        />
        <span className="control-value">{filterQ.toFixed(0)}</span>
      </label>
      <label>
        <span className="control-label">Volume</span>
        <input
          type="range"
          min="0"
          max="4"
          step="0.01"
          value={masterVol}
          onChange={e => {
            const v = parseFloat(e.target.value);
            setMasterVol(v);
            audioEngine.setMasterVolume(v);
          }}
        />
        <span className="control-value">{Math.round(masterVol * 100)}%</span>
      </label>
      <div className="chord-octave">
        <button onClick={() => setOctaveShift(prev => Math.max(-3, prev - 1))}>-</button>
        <span>Oct {3 + octaveShift}</span>
        <button onClick={() => setOctaveShift(prev => Math.min(3, prev + 1))}>+</button>
      </div>
      <button className="panic-btn" onClick={() => audioEngine.allNotesOff()}>
        All Notes Off
      </button>
    </div>
  );
}
