import { useState, useEffect } from 'react';
import { webrtcService } from '../services/WebRTCService';
import type { PeerRole } from '../services/WebRTCService';
import { audioEngine } from '../services/AudioEngine';
import { Badge, MinorHeading, SectionHeading, UiButton, UiTextarea } from './ui';

function titleCaseValue(value: string) {
  return value
    .split(/([ _-])/)
    .map(part => /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join('');
}

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

  const statusBadgeTone = (s: string) => {
    switch (s) {
      case 'connected': return 'active';
      case 'connecting': return 'warning';
      default: return 'default';
    }
  };

  return (
    <div className="grid gap-3 border-t border-ink pt-3">
      <SectionHeading>WebRTC Peer Sync</SectionHeading>
      <div className="text-xs font-semibold uppercase text-copy">
        Status: <Badge tone={statusBadgeTone(state)} size="sm">{titleCaseValue(state)}</Badge>
      </div>

      {state === 'disconnected' && (
        <div className="flex flex-col gap-3">
          <div>
            <MinorHeading>Create Session (Leader)</MinorHeading>
            <UiButton className="mr-1.5" onClick={handleCreateOffer}>Generate Offer</UiButton>
          </div>

          <div>
            <MinorHeading>Join Session (Follower)</MinorHeading>
            <UiTextarea
              placeholder="Paste offer here..."
              value={offerText}
              onChange={e => setOfferText(e.target.value)}
              rows={3}
            />
            <UiButton className="mr-1.5" onClick={handleAcceptOffer} disabled={!offerText}>Join</UiButton>
          </div>
        </div>
      )}

      {state === 'connecting' && localSignal && (
        <div className="flex flex-col gap-3">
          <div>
            <MinorHeading>Your Signal (copy & send to peer)</MinorHeading>
            <UiTextarea
              readOnly
              value={localSignal}
              rows={3}
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
          </div>

          {role === 'leader' && (
            <div>
              <MinorHeading>Paste Peer's Answer</MinorHeading>
              <UiTextarea
                placeholder="Paste answer here..."
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                rows={3}
              />
              <UiButton className="mr-1.5" onClick={handleAcceptAnswer} disabled={!answerText}>Connect</UiButton>
            </div>
          )}
        </div>
      )}

      {state === 'connected' && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-copy">Connected As <strong>{titleCaseValue(role)}</strong></p>
          {role === 'leader' && (
            <div>
              <UiButton className="mr-1.5" onClick={handleStartSync}>Start Clock Sync</UiButton>
              <UiButton className="mr-1.5" onClick={handleStopSync}>Stop Clock</UiButton>
            </div>
          )}
          <UiButton className="mr-1.5" onClick={() => webrtcService.disconnect()}>
            Disconnect
          </UiButton>
          {messages.length > 0 && (
            <div className="mt-2 max-h-[100px] overflow-y-auto border border-ink text-[10px]">
              {messages.map((m, i) => <div key={i} className="border-b border-ink px-1 py-px font-mono text-muted last:border-b-0">{m}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
