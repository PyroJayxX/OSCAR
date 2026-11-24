import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useMicLevel(stream: MediaStream | null): MutableRefObject<number> {
  const levelRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    levelRef.current = 0;

    if (!stream) {
      // Clean up
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
      }
      return;
    }

    // Create/reuse AudioContext
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;

    // Create analyser
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    analyserRef.current = analyser;

    // Create source from the recording stream (NOT connected to destination)
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    source.connect(analyser); // Only connect to analyser, NOT to destination

    const data = new Uint8Array(analyser.fftSize);
    let silenceStart = 0;
    let clipStart = 0;

    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128 - 1;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);

      // Apply attack/release smoothing
      const target = Math.min(1, rms * 5); // Scale up for speech levels
      const k = target > levelRef.current ? 0.5 : 0.1; // attack 0.5, release 0.1
      levelRef.current += (target - levelRef.current) * k;

      // Check for near-zero (silence) and clipping
      if (levelRef.current < 0.02) {
        silenceStart += 16; // ~16ms per frame at 60fps
      } else {
        silenceStart = 0;
      }

      if (levelRef.current > 0.98) {
        clipStart += 16;
      } else {
        clipStart = 0;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      // Don't close context - might be reused
      levelRef.current = 0;
    };
  }, [stream]);

  return levelRef;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface MicLevelBarProps {
  level: number;
  isRecording: boolean;
  reducedMotion: boolean;
  onSilence?: () => void;
  onClip?: () => void;
  onRecover?: () => void;
}

export function MicLevelBar({
  level,
  isRecording,
  reducedMotion,
  onSilence,
  onClip,
  onRecover,
}: MicLevelBarProps) {
  const [opacity, setOpacity] = useState(0);
  const [showSilenceHint, setShowSilenceHint] = useState(false);
  const [showClipHint, setShowClipHint] = useState(false);
  const silenceTimerRef = useRef<number | null>(null);
  const clipTimerRef = useRef<number | null>(null);
  const wasSilentRef = useRef(false);
  const wasClippingRef = useRef(false);

  // Fade in/out
  useEffect(() => {
    if (isRecording) {
      setOpacity(1);
    } else {
      setOpacity(0);
      setShowSilenceHint(false);
      setShowClipHint(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    }
  }, [isRecording]);

  // Silence and clip detection
  useEffect(() => {
    if (!isRecording) return;

    // Silence detection (near zero for 3 seconds)
    if (level < 0.02) {
      if (!wasSilentRef.current) {
        wasSilentRef.current = true;
        silenceTimerRef.current = window.setTimeout(() => {
          setShowSilenceHint(true);
          onSilence?.();
        }, 3000);
      }
    } else {
      if (wasSilentRef.current) {
        wasSilentRef.current = false;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        setShowSilenceHint(false);
        onRecover?.();
      }
    }

    // Clip detection (near 1 for 1 second)
    if (level > 0.98) {
      if (!wasClippingRef.current) {
        wasClippingRef.current = true;
        clipTimerRef.current = window.setTimeout(() => {
          setShowClipHint(true);
          onClip?.();
        }, 1000);
      }
    } else {
      if (wasClippingRef.current) {
        wasClippingRef.current = false;
        if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
        setShowClipHint(false);
        onRecover?.();
      }
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    };
  }, [level, isRecording, onSilence, onClip, onRecover]);

  const BAR_COUNT = 12;
  const BAR_WIDTH = 4;
  const BAR_GAP = 2;
  const MAX_HEIGHT = 48;
  const MIN_HEIGHT = 3;

  // In reduced motion, show a simpler static-step version
  if (reducedMotion) {
    const steps = 5;
    const step = Math.floor(level * steps);
    return (
      <div
        className="mic-level-bar"
        role="img"
        aria-label="Microphone level"
        style={{ opacity, transition: "opacity 200ms ease" }}
      >
        <div className="mic-level-bar-reduced" aria-hidden="true">
          {[...Array(steps)].map((_, i) => (
            <div
              key={i}
              className={`mic-level-step ${i < step ? "active" : ""}`}
            />
          ))}
        </div>
        {showSilenceHint && (
          <div className="mic-hint silence" role="status" aria-live="polite">
            We can&apos;t hear you. Check your microphone.
          </div>
        )}
        {showClipHint && (
          <div className="mic-hint clip" role="status" aria-live="polite">
            Too loud — move back a bit
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          Microphone level: {Math.round(level * 100)}%
        </span>
      </div>
    );
  }

  return (
    <div
      className={`mic-level-bar ${isRecording ? "recording" : ""}`}
      role="img"
      aria-label="Microphone level"
      style={{ opacity, transition: "opacity 200ms ease" }}
    >
      <div className="mic-level-bars" aria-hidden="true">
        {[...Array(BAR_COUNT)].map((_, i) => {
          // Stagger the bars for a nice visual effect
          const stagger = (i / BAR_COUNT) * 0.3;
          const barLevel = Math.max(0, level - stagger);
          const height = Math.max(MIN_HEIGHT, MIN_HEIGHT + barLevel * (MAX_HEIGHT - MIN_HEIGHT));
          return (
            <div
              key={i}
              className="mic-level-bar-item"
              style={{
                width: BAR_WIDTH,
                height: height,
                margin: `0 ${BAR_GAP}px`,
                transition: "height 50ms ease-out, background-color 100ms ease",
                // Let CSS handle color when inside recording-status (red), otherwise use teal/rose for clipping
                backgroundColor: undefined,
              }}
            />
          );
        })}
      </div>
      {showSilenceHint && (
        <div className="mic-hint silence" role="status" aria-live="polite">
          We can&apos;t hear you. Check your microphone.
        </div>
      )}
      {showClipHint && (
        <div className="mic-hint clip" role="status" aria-live="polite">
          Too loud — move back a bit
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        Microphone level: {Math.round(level * 100)}%
      </span>
    </div>
  );
}