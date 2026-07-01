import { audioEngine } from '../services/AudioEngine';
import { clearSavedState } from '../services/storage';
import { UiButton } from './ui';

export function SettingsPanel() {
  const clearHistory = () => {
    clearSavedState();
    audioEngine.allNotesOff();
    audioEngine.disconnectAllStreams();
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <UiButton onClick={clearHistory}>
        Clear History
      </UiButton>
    </div>
  );
}
