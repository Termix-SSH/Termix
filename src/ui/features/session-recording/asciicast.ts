import { Terminal } from "@xterm/xterm";

export type AsciicastEvent = [
  time: number,
  type: "i" | "o" | "r",
  data: string,
];

export type Asciicast = {
  width: number;
  height: number;
  duration: number;
  events: AsciicastEvent[];
};

export function parseAsciicast(source: string): Asciicast {
  const lines = source.trim().split("\n");
  const header = JSON.parse(lines.shift() || "{}") as {
    version?: number;
    width?: number;
    height?: number;
  };
  if (header.version !== 2) throw new Error("Unsupported asciicast version");

  const events = lines
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AsciicastEvent)
    .filter(
      ([time, type, data]) =>
        Number.isFinite(time) &&
        (type === "i" || type === "o" || type === "r") &&
        typeof data === "string",
    );

  return {
    width: header.width || 80,
    height: header.height || 24,
    duration: events.at(-1)?.[0] || 0,
    events,
  };
}

function writeAsync(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

// Replays the recording into an offscreen terminal and reads back its
// rendered buffer, so cursor movement/overwrites resolve the same way
// they would on screen instead of leaving raw ANSI escapes in the text.
export async function asciicastToPlainText(
  recording: Asciicast,
): Promise<string> {
  const terminal = new Terminal({
    cols: recording.width,
    rows: recording.height,
    allowProposedApi: true,
  });

  try {
    for (const [, type, data] of recording.events) {
      if (type === "o") await writeAsync(terminal, data);
      if (type === "r") {
        const [cols, rows] = data.split("x").map(Number);
        if (cols > 0 && rows > 0) terminal.resize(cols, rows);
      }
    }

    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    }
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines.join("\n");
  } finally {
    terminal.dispose();
  }
}
