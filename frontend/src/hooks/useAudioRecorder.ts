import { useCallback, useRef, useState } from "react";
import { downsampleBuffer, encodeWAV, mergeBuffers } from "./wavEncoder";

export type RecorderStatus = "idle" | "recording" | "processing" | "error";

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const totalLengthRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  const cleanupGraph = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    totalLengthRef.current = 0;
    setDurationSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Route through a muted gain node so onaudioprocess fires without
      // audibly looping the mic back out through the speakers.
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(channelData.slice());
        totalLengthRef.current += channelData.length;
      };

      source.connect(analyser);
      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      timerRef.current = window.setInterval(() => {
        setDurationSeconds((d) => d + 1);
      }, 1000);

      setStatus("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
      setStatus("error");
      cleanupGraph();
    }
  }, [cleanupGraph]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (status !== "recording" || !audioContextRef.current) return null;
    setStatus("processing");

    const sampleRate = audioContextRef.current.sampleRate;
    const merged = mergeBuffers(chunksRef.current, totalLengthRef.current);
    cleanupGraph();

    if (merged.length === 0) {
      setStatus("idle");
      return null;
    }

    const downsampled = downsampleBuffer(merged, sampleRate);
    const wavBlob = encodeWAV(downsampled, 16000);
    setStatus("idle");
    return wavBlob;
  }, [status, cleanupGraph]);

  const reset = useCallback(() => {
    cleanupGraph();
    chunksRef.current = [];
    totalLengthRef.current = 0;
    setDurationSeconds(0);
    setStatus("idle");
    setError(null);
  }, [cleanupGraph]);

  return {
    status,
    durationSeconds,
    error,
    startRecording,
    stopRecording,
    reset,
    getAnalyser,
  };
}
