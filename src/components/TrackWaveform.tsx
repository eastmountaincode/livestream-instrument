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
    const styles = getComputedStyle(canvas);
    const paperColor = styles.getPropertyValue('--color-paper').trim() || '#fff';
    const inkColor = styles.getPropertyValue('--color-ink').trim() || '#1646a0';
    const surfaceColor = styles.getPropertyValue('--color-surface').trim() || '#cbd8eb';

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted ? surfaceColor : paperColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerY = Math.round(canvas.height / 2) + 0.5;

      ctx.strokeStyle = inkColor;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvas.width, centerY);
      ctx.stroke();

      ctx.strokeStyle = inkColor;
      ctx.globalAlpha = 1;
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
      ctx.globalAlpha = 1;
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [id, muted]);

  return (
    <canvas
      ref={canvasRef}
      className="h-[53px] w-[92px] min-w-[92px] border border-ink"
      width={92}
      height={53}
    />
  );
}
