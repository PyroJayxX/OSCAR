import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

// ─── Constants (tweak these) ────────────────────────────────────────────────
const POINT_COUNT = 16; // more lobes = spikier shape
const RADIUS_RATIO = 0.2; // base radius as a fraction of the canvas size
const MAX_DISTORTION_RATIO = 0.9; // how far loud audio can push a point (fraction of its radius)
const IDLE_TARGET = 0.02;
const LOUDNESS_GAIN = 1.4; // how much loudness adds on top of the idle target
const ATTACK = 0.4; // how fast the blob snaps up when audio gets louder
const RELEASE = 0.1; // how fast it settles back down
const FILL_ALPHA = 0.2;
const NOISE_SPEED = 1.5; // how fast the blob morphs
const DEFAULT_CYCLE_MS = 4000; // time spent fading from one palette color to the next
const REDUCED_MOTION_FACTOR = 0.4; // movement kept when the OS asks for reduced motion
const DEFAULT_COLOR = "#378ADD";

// Blob layers: scale, lineWidth, strokeAlpha, phaseShift, hasFill
const LAYERS = [
  { scale: 1.0, lineWidth: 2.5, strokeAlpha: 1.0, phaseShift: 0.0, hasFill: false },
  { scale: 1.05, lineWidth: 1.5, strokeAlpha: 0.45, phaseShift: 2.1, hasFill: false },
  { scale: 0.95, lineWidth: 1.2, strokeAlpha: 0.3, phaseShift: 4.2, hasFill: true },
];

// ─── Types ──────────────────────────────────────────────────────────────────
type WaveformMode = "idle" | "active";

interface WaveformProps {
  mode: WaveformMode;
  loudness?: number; // 0–1, when provided it overrides the mic and the simulation
  color?: string | string[]; // one color, or a palette that cycles. default #378ADD
  colorCycleMs?: number; // ms per color transition when color is an array (default 4000)
  className?: string; // applied to the wrapper div
  simulateSpeaking?: boolean; // dev-only: fake loudness envelope
  debug?: boolean; // draws loudness/amp numbers on the canvas
}

interface ControlPoint {
  angle: number;
  freq1: number;
  phase1: number;
  amp1: number;
  freq2: number;
  phase2: number;
  amp2: number;
  freq3: number;
  phase3: number;
  amp3: number;
}

// ─── Noise helpers ──────────────────────────────────────────────────────────
function rand(s: number): number {
  const x = Math.sin(s) * 10000;
  return x - Math.floor(x);
}

function makePoint(angle: number, seed: number): ControlPoint {
  return {
    angle,
    freq1: 0.5 + rand(seed + 1) * 1.5,
    phase1: rand(seed + 2) * Math.PI * 2,
    amp1: 0.3 + rand(seed + 3) * 0.4,
    freq2: 1.5 + rand(seed + 4) * 2.0,
    phase2: rand(seed + 5) * Math.PI * 2,
    amp2: 0.15 + rand(seed + 6) * 0.25,
    freq3: 4.0 + rand(seed + 7) * 6.0, // high-frequency flicker on the edge
    phase3: rand(seed + 8) * Math.PI * 2,
    amp3: 0.1 + rand(seed + 9) * 0.25,
  };
}

function pointRadius(pt: ControlPoint, t: number, distortion: number, baseR: number): number {
  const noise =
    Math.sin(t * pt.freq1 + pt.phase1) * pt.amp1 +
    Math.sin(t * pt.freq2 + pt.phase2) * pt.amp2 +
    Math.sin(t * pt.freq3 + pt.phase3) * pt.amp3;
  const clamped = Math.max(-1, Math.min(1, noise));
  return baseR * (1 + clamped * distortion * MAX_DISTORTION_RATIO);
}

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [isNaN(r) ? 55 : r, isNaN(g) ? 138 : g, isNaN(b) ? 221 : b];
}

// Pick the current color. A single color is used as-is; a palette fades smoothly
// from one entry to the next and loops forever.
function colorAt(color: string | string[], ts: number, cycleMs: number): [number, number, number] {
  const palette = Array.isArray(color) ? color : [color];
  if (palette.length === 0) return parseColor(DEFAULT_COLOR);
  if (palette.length === 1) return parseColor(palette[0]);

  const pos = (ts / cycleMs) % palette.length;
  const i = Math.floor(pos);
  const f = pos - i;
  const eased = f * f * (3 - 2 * f); // smoothstep, so the fade lingers on each color
  const a = parseColor(palette[i]);
  const b = parseColor(palette[(i + 1) % palette.length]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * eased),
    Math.round(a[1] + (b[1] - a[1]) * eased),
    Math.round(a[2] + (b[2] - a[2]) * eased),
  ];
}

// ─── Loudness hooks (write to a ref, so no re-render every frame) ───────────
function useMicLoudness(source: MediaStream | null): MutableRefObject<number> {
  const loudnessRef = useRef(0);

  useEffect(() => {
    loudnessRef.current = 0;
    if (!source) return;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    const data = new Uint8Array(analyser.fftSize);

    const src = ctx.createMediaStreamSource(source);
    // IMPORTANT: never connect the mic to ctx.destination (it would play through the speakers)
    src.connect(analyser);

    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128 - 1;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      loudnessRef.current = Math.min(1, rms * 5); // speech RMS is usually only 0.05–0.2
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      ctx.close();
      loudnessRef.current = 0;
    };
  }, [source]);

  return loudnessRef;
}

function useSimulatedLoudness(enabled: boolean): MutableRefObject<number> {
  const loudnessRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      loudnessRef.current = 0;
      return;
    }
    let raf = 0;
    const tick = (time: number) => {
      const t = time * 0.001;
      const base = 0.45 + Math.sin(t * 0.7) * 0.2 + Math.sin(t * 1.3) * 0.15;
      const burst = Math.max(0, Math.sin(t * 4.7) * Math.sin(t * 23) * 0.5);
      const target = Math.min(1, base + burst);
      loudnessRef.current += (target - loudnessRef.current) * 0.12;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      loudnessRef.current = 0;
    };
  }, [enabled]);

  return loudnessRef;
}

// ─── Main blob component ────────────────────────────────────────────────────
export function Waveform({
  mode,
  loudness: loudnessProp,
  color = DEFAULT_COLOR,
  colorCycleMs = DEFAULT_CYCLE_MS,
  className,
  simulateSpeaking = false,
  debug = false,
}: WaveformProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState(0); // square canvas size in CSS px
  const [points] = useState<ControlPoint[]>(() =>
    Array.from({ length: POINT_COUNT }, (_, i) => makePoint((i / POINT_COUNT) * Math.PI * 2, i * 1000))
  );

  // Microphone
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micLoudness = useMicLoudness(micStream);
  const simLoudness = useSimulatedLoudness(simulateSpeaking);

  const isActive = mode === "active" || simulateSpeaking;

  // The animation loop reads the latest values from this ref,
  // so the loop itself never has to restart when props change.
  const liveRef = useRef({ isActive, loudnessProp, simulateSpeaking, color, colorCycleMs, debug });
  liveRef.current = { isActive, loudnessProp, simulateSpeaking, color, colorCycleMs, debug };

  // Keep the canvas a true square that fits the wrapper (no stretching)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const r = wrap.getBoundingClientRect();
      const h = r.height || r.width;
      setSize(Math.max(0, Math.floor(Math.min(r.width, h))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Open the mic only while active (and not simulating)
  useEffect(() => {
    let cancelled = false;
    if (mode === "active" && !simulateSpeaking) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          micStreamRef.current = stream;
          setMicStream(stream);
        })
        .catch(console.error);
    }
    return () => {
      cancelled = true;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setMicStream(null);
    };
  }, [mode, simulateSpeaking]);

  // Animation loop (restarts only when the canvas size changes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * RADIUS_RATIO;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionFactor = reduced ? REDUCED_MOTION_FACTOR : 1;

    let amp = IDLE_TARGET;
    let raf = 0;

    const render = (ts: number) => {
      const live = liveRef.current;
      const loud =
        live.loudnessProp ?? (live.simulateSpeaking ? simLoudness.current : micLoudness.current);

      // Clamped so the blob can never grow past the canvas edge
      const target = live.isActive ? Math.min(1, IDLE_TARGET + loud * LOUDNESS_GAIN) : IDLE_TARGET;
      // Snap up fast, decay slower
      const k = target > amp ? ATTACK : RELEASE;
      amp += (target - amp) * k;

      // Always a little distortion, so idle still drifts very slightly
      const distortion = amp * motionFactor;
      const t = ts * 0.001 * NOISE_SPEED;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const [r, g, b] = colorAt(live.color, ts, live.colorCycleMs);

      LAYERS.forEach((layer) => {
        const pts = points.map((pt) => {
          const radius = pointRadius(pt, t + layer.phaseShift, distortion, baseR * layer.scale);
          return { x: cx + Math.cos(pt.angle) * radius, y: cy + Math.sin(pt.angle) * radius };
        });

        ctx.beginPath();
        const first = pts[0];
        const last = pts[pts.length - 1];
        ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
        for (let i = 0; i < pts.length; i++) {
          const curr = pts[i];
          const next = pts[(i + 1) % pts.length];
          ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
        }
        ctx.closePath();

        if (layer.hasFill) {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${FILL_ALPHA})`;
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${layer.strokeAlpha})`;
        ctx.lineWidth = layer.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      });

      if (live.debug) {
        ctx.fillStyle = "rgba(128,128,128,0.9)";
        ctx.font = "12px monospace";
        ctx.fillText(`loud ${loud.toFixed(2)}  amp ${amp.toFixed(2)}`, 8, 16);
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size, points, simLoudness, micLoudness]);

  return (
    <div
      ref={wrapRef}
      className={`blob-wrap ${className ?? ""}`}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        className="blob-canvas"
        style={{ width: size, height: size, display: "block" }}
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Dev-only toggle component ──────────────────────────────────────────────
export function SimulateToggle({ onChange }: { onChange: (v: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => {
          setEnabled(e.target.checked);
          onChange(e.target.checked);
        }}
      />
      <span>Simulate speaking (dev)</span>
    </label>
  );
}