import { useTranslation } from "@termix/plugin-sdk/frontend";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Guacamole from "guacamole-common-js";
import "@xterm/xterm/css/xterm.css";
import { parseAsciicast, type Asciicast } from "./asciicast";
import type { SessionLogRecord } from "./session-recording-api";

const SPEEDS = [0.5, 1, 2, 4];

function formatPosition(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SeekBar({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (position: number) => void;
}) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const seekFromPointer = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onSeek(ratio * duration);
  };

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label={t("player.timeline")}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={position}
      className="group/seek relative h-3 w-full cursor-pointer touch-none outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekFromPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) seekFromPointer(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onSeek(Math.max(position - 5, 0));
        if (event.key === "ArrowRight")
          onSeek(Math.min(position + 5, duration));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border transition-[height] group-hover/seek:h-1 group-focus-visible/seek:h-1">
        <div
          className="h-full bg-primary"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
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
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-t border-border/60 bg-muted/20">
      <SeekBar position={position} duration={duration} onSeek={onSeek} />
      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex size-6 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={playing ? t("player.pause") : t("player.play")}
        >
          {playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </button>
        <span className="flex-1 text-[10px] tabular-nums text-muted-foreground">
          {formatPosition(Math.min(position, duration))} /{" "}
          {formatPosition(duration)}
        </span>
        <div
          className="flex items-center"
          role="group"
          aria-label={t("player.speed")}
        >
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSpeed(value)}
              aria-pressed={speed === value}
              className={
                speed === value
                  ? "h-5 px-1.5 text-[10px] tabular-nums bg-muted text-foreground"
                  : "h-5 px-1.5 text-[10px] tabular-nums text-muted-foreground/60 hover:text-foreground"
              }
            >
              {value}x
            </button>
          ))}
        </div>
      </div>
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
      .catch((reason) => setError(getErrorMessage(reason, String(reason))));

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
