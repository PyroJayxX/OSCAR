import { useEffect, useRef } from "react";

type WaveformMode = "flat" | "live" | "ambient";

interface WaveformProps {
  mode: WaveformMode;
  getAnalyser?: () => AnalyserNode | null;
}

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TEAL: [number, number, number] = [79, 209, 197];
const AMBER: [number, number, number] = [255, 159, 28];

function lerpColor(a: [number, number, number], b: [number, number, number], t: number, alpha: number) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

const RING_COUNT = 7;

export function Waveform({ mode, getAnalyser }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const energyRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.clientWidth, canvas.clientHeight);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    const baseRadius = size * 0.26;
    const buffer = new Uint8Array(1024);

    const targetEnergy = () => {
      if (mode === "live") {
        const analyser = getAnalyser?.();
        if (!analyser) return 0;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = buffer[i] / 128 - 1;
          sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / buffer.length) * 5);
      }
      if (mode === "ambient") return 0.55;
      return 0.12;
    };

    const drawRing = (ringIndex: number, t: number, energy: number) => {
      const freq = 2.5 + ringIndex * 0.7;
      const amp = baseRadius * (0.22 + energy * 0.55) * (1 - (ringIndex / RING_COUNT) * 0.3);
      const phase = ringIndex * 1.1;
      const speed = 0.8 + ringIndex * 0.12;
      const hueT = ringIndex / (RING_COUNT - 1);
      const alpha = mode === "flat" ? 0.18 : 0.32 + (1 - hueT) * 0.28;

      ctx.beginPath();
      const step = 0.06;
      for (let a = 0; a <= Math.PI * 2 + step; a += step) {
        const r =
          baseRadius +
          Math.sin(a * freq + t * speed + phase) * amp +
          Math.sin(a * (freq * 0.5) - t * speed * 1.3) * amp * 0.5;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const color = lerpColor(TEAL, AMBER, hueT, alpha);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = color;
      ctx.shadowBlur = mode === "flat" ? 3 : 9;
      ctx.stroke();
    };

    const render = (t: number) => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      const target = targetEnergy();
      energyRef.current += (target - energyRef.current) * 0.08;
      for (let r = 0; r < RING_COUNT; r++) drawRing(r, t, energyRef.current);
      ctx.shadowBlur = 0;

      // Only the purely decorative resting state honors reduced-motion by
      // freezing; live/ambient are functional activity indicators (recording,
      // processing) and must keep animating regardless.
      if (mode !== "flat" || !REDUCED_MOTION) {
        frameRef.current = requestAnimationFrame((next) => render(next * 0.0024));
      }
    };

    render(0);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [mode, getAnalyser]);

  return <canvas ref={canvasRef} className="waveform-canvas" />;
}
