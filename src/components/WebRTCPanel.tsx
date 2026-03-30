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

  return (
    <div className="panel webrtc-panel">
      <h3>WebRTC Peer Sync</h3>
      <div className="connection-status">
        Status: <span className={`status-badge ${state}`}>{state}</span>
      </div>

      {state === 'disconnected' && (
        <div className="webrtc-setup">
          <div className="setup-section">
            <h4>Create Session (Leader)</h4>
            <button onClick={handleCreateOffer}>Generate Offer</button>
          </div>

          <div className="setup-section">
            <h4>Join Session (Follower)</h4>
            <textarea
              placeholder="Paste offer here..."
              value={offerText}
              onChange={e => setOfferText(e.target.value)}
              rows={3}
            />
            <button onClick={handleAcceptOffer} disabled={!offerText}>Join</button>
          </div>
        </div>
      )}

      {state === 'connecting' && localSignal && (
        <div className="webrtc-setup">
          <div className="setup-section">
            <h4>Your Signal (copy & send to peer)</h4>
            <textarea readOnly value={localSignal} rows={3}
              onClick={e => (e.target as HTMLTextAreaElement).select()} />
          </div>

          {role === 'leader' && (
            <div className="setup-section">
              <h4>Paste Peer's Answer</h4>
              <textarea
                placeholder="Paste answer here..."
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                rows={3}
              />
              <button onClick={handleAcceptAnswer} disabled={!answerText}>Connect</button>
            </div>
          )}
        </div>
      )}

      {state === 'connected' && (
        <div className="webrtc-connected">
          <p>Connected as <strong>{role}</strong></p>
          {role === 'leader' && (
            <div>
              <button onClick={handleStartSync}>Start Clock Sync</button>
              <button onClick={handleStopSync}>Stop Clock</button>
            </div>
          )}
          <button className="disconnect-btn" onClick={() => webrtcService.disconnect()}>
            Disconnect
          </button>
          {messages.length > 0 && (
            <div className="message-log">
              {messages.map((m, i) => <div key={i} className="msg">{m}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
