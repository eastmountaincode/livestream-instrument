import { audioEngine } from '../services/AudioEngine';
import { clearSavedState } from '../services/storage';

export function SettingsPanel() {
  const clearHistory = () => {
    clearSavedState();
    audioEngine.allNotesOff();
    audioEngine.disconnectAllStreams();
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="border border-[#242424] bg-[#fbfaf6] px-3.5 py-[5px] font-mono text-[11px] font-semibold uppercase text-[#171717] hover:bg-[#242424] hover:text-[#fbfaf6]"
        onClick={clearHistory}
      >
        Clear History
      </button>
    </div>
  );
}
