import { useEffect, useRef } from 'react';
import { audioEngine } from '../services/AudioEngine';

interface TrackWaveformProps {
  id: string;
  muted: boolean;
}

export function TrackWaveform({ id, muted }: TrackWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = audioEngine.getStreamAnalyser(id);
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = new Uint8Array(analyser.fftSize);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerY = Math.round(canvas.height / 2) + 0.5;

      ctx.strokeStyle = muted ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.26)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvas.width, centerY);
      ctx.stroke();

      ctx.strokeStyle = muted ? 'rgba(0,0,0,0.34)' : '#111';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * canvas.width;
        const y = Math.round((data[i] / 255) * canvas.height) + 0.5;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [id, muted]);

  return (
    <canvas
      ref={canvasRef}
      className={`h-10 w-[92px] min-w-[92px] border-2 ${muted ? 'border-black/40 opacity-50' : 'border-black'}`}
      width={92}
      height={40}
    />
  );
}
