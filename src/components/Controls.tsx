import { useState } from 'react';
import { audioEngine } from '../services/AudioEngine';

export function Controls() {
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
      <button className="panic-btn" onClick={() => audioEngine.allNotesOff()}>
        All Notes Off
      </button>
    </div>
  );
}
