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
      case 'connected': return 'text-[#4c4] bg-[#113311]';
      case 'connecting': return 'text-[#fa0] bg-[#332200]';
      default: return 'text-[#888] bg-[#222]';
    }
  };

  return (
    <div className="bg-[#141414] rounded-md p-3 mb-2">
      <h3 className="text-[13px] font-semibold mb-2 text-[#aaa]">WebRTC Peer Sync</h3>
      <div className="mb-2 text-xs">
        Status: <span className={`px-2 py-0.5 rounded-sm text-[11px] font-semibold ${statusBadgeClass(state)}`}>{state}</span>
      </div>

      {state === 'disconnected' && (
        <div className="flex flex-col gap-3">
          <div>
            <h4 className="text-[11px] text-[#888] mb-1.5 font-medium">Create Session (Leader)</h4>
            <button
              className="py-[5px] px-3.5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
              onClick={handleCreateOffer}
            >Generate Offer</button>
          </div>

          <div>
            <h4 className="text-[11px] text-[#888] mb-1.5 font-medium">Join Session (Follower)</h4>
            <textarea
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-sm text-[#ddd] font-mono text-[10px] p-1.5 resize-y mb-1"
              placeholder="Paste offer here..."
              value={offerText}
              onChange={e => setOfferText(e.target.value)}
              rows={3}
            />
            <button
              className="py-[5px] px-3.5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
              onClick={handleAcceptOffer}
              disabled={!offerText}
            >Join</button>
          </div>
        </div>
      )}

      {state === 'connecting' && localSignal && (
        <div className="flex flex-col gap-3">
          <div>
            <h4 className="text-[11px] text-[#888] mb-1.5 font-medium">Your Signal (copy & send to peer)</h4>
            <textarea
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-sm text-[#ddd] font-mono text-[10px] p-1.5 resize-y mb-1"
              readOnly
              value={localSignal}
              rows={3}
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
          </div>

          {role === 'leader' && (
            <div>
              <h4 className="text-[11px] text-[#888] mb-1.5 font-medium">Paste Peer's Answer</h4>
              <textarea
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-sm text-[#ddd] font-mono text-[10px] p-1.5 resize-y mb-1"
                placeholder="Paste answer here..."
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                rows={3}
              />
              <button
                className="py-[5px] px-3.5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
                onClick={handleAcceptAnswer}
                disabled={!answerText}
              >Connect</button>
            </div>
          )}
        </div>
      )}

      {state === 'connected' && (
        <div>
          <p className="mb-2 text-xs">Connected as <strong>{role}</strong></p>
          {role === 'leader' && (
            <div>
              <button
                className="py-[5px] px-3.5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
                onClick={handleStartSync}
              >Start Clock Sync</button>
              <button
                className="py-[5px] px-3.5 border border-[#333] rounded-sm bg-[#222] text-[#aaa] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
                onClick={handleStopSync}
              >Stop Clock</button>
            </div>
          )}
          <button
            className="py-[5px] px-3.5 border border-[#533] rounded-sm bg-[#222] text-[#c66] cursor-pointer font-mono text-[11px] mr-1.5 hover:bg-[#2a2a2a] hover:text-[#ddd]"
            onClick={() => webrtcService.disconnect()}
          >
            Disconnect
          </button>
          {messages.length > 0 && (
            <div className="mt-2 max-h-[100px] overflow-y-auto text-[10px]">
              {messages.map((m, i) => <div key={i} className="text-[#666] py-px border-b border-[#1a1a1a]">{m}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
