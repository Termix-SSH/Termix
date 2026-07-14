import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Guacamole from "guacamole-common-js";
import type { SessionLogRecord } from "@/api/session-log-api";
import { parseAsciicast, type Asciicast } from "./asciicast";
import "@xterm/xterm/css/xterm.css";

const SPEEDS = [0.5, 1, 2, 4];

function formatPosition(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function PlaybackControls({
  playing,
  position,
  duration,
  speed,
  onToggle,
  onSeek,
  onSpeed,
}: {
  playing: boolean;
  position: number;
  duration: number;
  speed: number;
  onToggle: () => void;
  onSeek: (position: number) => void;
  onSpeed: (speed: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-border/60 bg-muted/20 px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex size-7 items-center justify-center hover:bg-muted"
        aria-label={playing ? "Pause recording" : "Play recording"}
      >
        {playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </button>
      <span className="w-10 text-[10px] tabular-nums text-muted-foreground">
        {formatPosition(position)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(position, duration)}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="min-w-0 flex-1 accent-primary"
        aria-label="Recording timeline"
      />
      <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
        {formatPosition(duration)}
      </span>
      <select
        value={speed}
        onChange={(event) => onSpeed(Number(event.target.value))}
        className="h-7 border border-border bg-background px-1 text-[10px]"
        aria-label="Playback speed"
      >
        {SPEEDS.map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
    </div>
  );
}

function AsciicastPlayer({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const recordingRef = useRef<Asciicast | null>(null);
  const positionRef = useRef(0);
  const eventIndexRef = useRef(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const renderAt = useCallback((nextPosition: number) => {
    const terminal = terminalRef.current;
    const recording = recordingRef.current;
    if (!terminal || !recording) return;
    if (nextPosition < positionRef.current) {
      terminal.reset();
      terminal.resize(recording.width, recording.height);
      eventIndexRef.current = 0;
    }
    while (eventIndexRef.current < recording.events.length) {
      const [time, type, data] = recording.events[eventIndexRef.current];
      if (time > nextPosition) break;
      if (type === "o") terminal.write(data);
      if (type === "r") {
        const [cols, rows] = data.split("x").map(Number);
        if (cols > 0 && rows > 0) terminal.resize(cols, rows);
      }
      eventIndexRef.current++;
    }
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      convertEol: false,
      fontSize: 12,
      theme: { background: "#09090b" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);
    fitAddon.fit();

    blob
      .text()
      .then((source) => {
        const recording = parseAsciicast(source);
        recordingRef.current = recording;
        setDuration(recording.duration);
        terminal.resize(recording.width, recording.height);
        renderAt(0);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [blob, renderAt]);

  useEffect(() => {
    if (!playing || !recordingRef.current) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(
        duration,
        positionRef.current + ((now - previous) / 1000) * speed,
      );
      previous = now;
      renderAt(next);
      if (next >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing, renderAt, speed]);

  if (error) return <div className="p-4 text-xs text-destructive">{error}</div>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 bg-[#09090b] p-2" />
      <PlaybackControls
        playing={playing}
        position={position}
        duration={duration}
        speed={speed}
        onToggle={() => {
          if (!playing && position >= duration) renderAt(0);
          setPlaying((value) => !value);
        }}
        onSeek={renderAt}
        onSpeed={setSpeed}
      />
    </div>
  );
}

function GuacamolePlayer({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef<Guacamole.SessionRecording | null>(null);
  const positionRef = useRef(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!containerRef.current) return;
    const recording = new Guacamole.SessionRecording(blob, 100);
    recordingRef.current = recording;
    const display = recording.getDisplay();
    const element = display.getElement();
    containerRef.current.replaceChildren(element);
    const fit = () => {
      const width = display.getWidth();
      if (width && containerRef.current) {
        display.scale(containerRef.current.clientWidth / width);
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(containerRef.current);
    recording.onload = () => {
      setDuration(recording.getDuration() / 1000);
      fit();
    };
    recording.onprogress = (nextDuration) => setDuration(nextDuration / 1000);
    recording.onseek = (nextPosition) => {
      positionRef.current = nextPosition / 1000;
      setPosition(positionRef.current);
    };
    recording.onerror = setError;

    return () => {
      observer.disconnect();
      recording.abort();
      recordingRef.current = null;
    };
  }, [blob]);

  useEffect(() => {
    const recording = recordingRef.current;
    if (!recording || !playing) return;
    recording.pause();
    let previous = performance.now();
    let nextPosition = positionRef.current;
    const interval = window.setInterval(() => {
      const now = performance.now();
      nextPosition = Math.min(
        duration,
        nextPosition + ((now - previous) / 1000) * speed,
      );
      previous = now;
      recording.seek(nextPosition * 1000);
      if (nextPosition >= duration) setPlaying(false);
    }, 100);
    return () => clearInterval(interval);
  }, [duration, playing, speed]);

  if (error) return <div className="p-4 text-xs text-destructive">{error}</div>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden bg-black"
      />
      <PlaybackControls
        playing={playing}
        position={position}
        duration={duration}
        speed={speed}
        onToggle={() => {
          const recording = recordingRef.current;
          if (!recording) return;
          if (!playing && position >= duration) recording.seek(0);
          setPlaying((value) => !value);
        }}
        onSeek={(nextPosition) => {
          recordingRef.current?.seek(nextPosition * 1000);
          positionRef.current = nextPosition;
          setPosition(nextPosition);
        }}
        onSpeed={setSpeed}
      />
    </div>
  );
}

export function SessionRecordingPlayer({
  log,
  blob,
}: {
  log: SessionLogRecord;
  blob: Blob;
}) {
  return log.format === "guacamole" ? (
    <GuacamolePlayer blob={blob} />
  ) : (
    <AsciicastPlayer blob={blob} />
  );
}
