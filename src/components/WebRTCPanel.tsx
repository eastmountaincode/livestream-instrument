import { useState, useEffect } from 'react';
import { webrtcService } from '../services/WebRTCService';
import type { PeerRole } from '../services/WebRTCService';
import { audioEngine } from '../services/AudioEngine';

export function WebRTCPanel() {
  const [role, setRole] = useState<PeerRole>(webrtcService.getRole());
  const [state, setState] = useState(webrtcService.getState());
  const [offerText, setOfferText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [localSignal, setLocalSignal] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const unsub = webrtcService.onChange(() => {
      setState(webrtcService.getState());
      setRole(webrtcService.getRole());
    });
    const unsubMsg = webrtcService.onMessage((msg) => {
      setMessages(prev => [...prev.slice(-9), JSON.stringify(msg)]);
    });
    return () => { unsub(); unsubMsg(); };
  }, []);

  const handleCreateOffer = async () => {
    webrtcService.setRole('leader');
    const offer = await webrtcService.createOffer();
    setLocalSignal(offer);
  };

  const handleAcceptOffer = async () => {
    webrtcService.setRole('follower');
    audioEngine.setExternalClock(true);
    const answer = await webrtcService.acceptOffer(offerText);
    setLocalSignal(answer);
  };

  const handleAcceptAnswer = async () => {
    await webrtcService.acceptAnswer(answerText);
  };

  const handleStartSync = () => {
    if (role === 'leader') {
      webrtcService.startLeaderClock();
    }
  };

  const handleStopSync = () => {
    webrtcService.stopLeaderClock();
  };

  const statusBadgeClass = (s: string) => {
    switch (s) {
      case 'connected': return 'bg-black text-white';
      case 'connecting': return 'bg-[#f3d85a] text-black';
      default: return 'bg-white text-black';
    }
  };

  return (
    <div className="border-2 border-black bg-white p-3">
      <h3 className="mb-2 text-[11px] font-black uppercase text-black">WebRTC Peer Sync</h3>
      <div className="mb-3 text-xs font-black uppercase text-black">
        Status: <span className={`border-2 border-black px-2 py-0.5 text-[11px] font-black ${statusBadgeClass(state)}`}>{state}</span>
      </div>

      {state === 'disconnected' && (
        <div className="flex flex-col gap-3">
          <div>
            <h4 className="mb-1.5 text-[11px] font-black uppercase text-black/60">Create Session (Leader)</h4>
            <button
              className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white"
              onClick={handleCreateOffer}
            >Generate Offer</button>
          </div>

          <div>
            <h4 className="mb-1.5 text-[11px] font-black uppercase text-black/60">Join Session (Follower)</h4>
            <textarea
              className="mb-1 w-full resize-y border-2 border-black bg-white p-1.5 font-mono text-[10px] text-black"
              placeholder="Paste offer here..."
              value={offerText}
              onChange={e => setOfferText(e.target.value)}
              rows={3}
            />
            <button
              className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white disabled:opacity-30"
              onClick={handleAcceptOffer}
              disabled={!offerText}
            >Join</button>
          </div>
        </div>
      )}

      {state === 'connecting' && localSignal && (
        <div className="flex flex-col gap-3">
          <div>
            <h4 className="mb-1.5 text-[11px] font-black uppercase text-black/60">Your Signal (copy & send to peer)</h4>
            <textarea
              className="mb-1 w-full resize-y border-2 border-black bg-white p-1.5 font-mono text-[10px] text-black"
              readOnly
              value={localSignal}
              rows={3}
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
          </div>

          {role === 'leader' && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-black uppercase text-black/60">Paste Peer's Answer</h4>
              <textarea
                className="mb-1 w-full resize-y border-2 border-black bg-white p-1.5 font-mono text-[10px] text-black"
                placeholder="Paste answer here..."
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                rows={3}
              />
              <button
                className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white disabled:opacity-30"
                onClick={handleAcceptAnswer}
                disabled={!answerText}
              >Connect</button>
            </div>
          )}
        </div>
      )}

      {state === 'connected' && (
        <div>
          <p className="mb-2 text-xs font-black uppercase text-black">Connected as <strong>{role}</strong></p>
          {role === 'leader' && (
            <div>
              <button
                className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white"
                onClick={handleStartSync}
              >Start Clock Sync</button>
              <button
                className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white"
                onClick={handleStopSync}
              >Stop Clock</button>
            </div>
          )}
          <button
            className="mr-1.5 border-2 border-black bg-white px-3.5 py-[5px] font-mono text-[11px] font-black uppercase text-black hover:bg-black hover:text-white"
            onClick={() => webrtcService.disconnect()}
          >
            Disconnect
          </button>
          {messages.length > 0 && (
            <div className="mt-2 max-h-[100px] overflow-y-auto border-2 border-black text-[10px]">
              {messages.map((m, i) => <div key={i} className="border-b border-black px-1 py-px font-mono text-black/65 last:border-b-0">{m}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
