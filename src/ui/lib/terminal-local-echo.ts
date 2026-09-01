export type LocalEchoMode = "off" | "auto" | "on";

const PASSWORD_PROMPT =
  /(?:password|passphrase|verification code|one[- ]time|otp|token)\s*[:：]?\s*$/i;
const SAFE_INPUT = /^[\x20-\x7e]$/;

type PendingCharacter = { value: string; sentAt: number; predicted: boolean };

export class TerminalLocalEcho {
  private pending: PendingCharacter[] = [];
  private slowSamples = 0;
  private secretInput = false;
  private outputTail = "";

  constructor(
    private readonly mode: LocalEchoMode,
    private readonly now: () => number = () => performance.now(),
    private readonly latencyThreshold = 120,
  ) {}

  handleInput(data: string): string {
    if (data === "\r" || data === "\n") {
      return "";
    }
    if (this.secretInput || !SAFE_INPUT.test(data)) return "";

    const predicted =
      this.mode === "on" || (this.mode === "auto" && this.slowSamples >= 2);
    this.pending.push({ value: data, sentAt: this.now(), predicted });
    return predicted ? data : "";
  }

  handleOutput(data: string): string {
    const plainOutput = this.stripAnsi(data);
    this.outputTail = (this.outputTail + plainOutput).slice(-128);
    if (PASSWORD_PROMPT.test(this.outputTail)) {
      const rollback = this.rollback();
      this.secretInput = true;
      return rollback + data;
    }

    if (this.secretInput) {
      if (data.includes("\n") || data.includes("\r")) this.secretInput = false;
      return data;
    }

    if (this.pending.length === 0) return data;

    let consumed = 0;
    while (
      consumed < data.length &&
      consumed < this.pending.length &&
      data[consumed] === this.pending[consumed].value
    ) {
      const item = this.pending[consumed];
      if (
        !item.predicted &&
        this.now() - item.sentAt >= this.latencyThreshold
      ) {
        this.slowSamples += 1;
      }
      consumed += 1;
    }

    if (consumed > 0) {
      const matched = this.pending.splice(0, consumed);
      const predictedCount = matched.filter((item) => item.predicted).length;
      return data.slice(predictedCount);
    }

    return this.rollback() + data;
  }

  reset() {
    this.pending = [];
    this.slowSamples = 0;
    this.secretInput = false;
    this.outputTail = "";
  }

  private rollback() {
    const count = this.pending.filter((item) => item.predicted).length;
    this.pending = [];
    return count > 0 ? `\x1b[${count}D\x1b[K` : "";
  }

  private stripAnsi(value: string) {
    return value.replace(/\x1b(?:[@-Z\\-_]|\[[0-9:;<=>?!]*[@-~])/g, "");
  }
}

export function resolveLocalEchoMode(
  hostMode: "default" | LocalEchoMode | undefined,
  storedMode: string | null,
): LocalEchoMode {
  if (hostMode && hostMode !== "default") return hostMode;
  return storedMode === "on" || storedMode === "off" || storedMode === "auto"
    ? storedMode
    : "auto";
}
