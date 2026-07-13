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
