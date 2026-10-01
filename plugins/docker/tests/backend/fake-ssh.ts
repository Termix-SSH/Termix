import { EventEmitter } from "node:events";

/** An ssh2 exec channel: stdout on "data", stderr on `stderr`, then "close". */
export class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  written: string[] = [];
  ended = false;
  window: [number, number] | null = null;

  write(data: string) {
    this.written.push(data);
    return true;
  }

  end() {
    this.ended = true;
  }

  setWindow(rows: number, cols: number) {
    this.window = [rows, cols];
  }

  /** Emits output and exits, on the next tick like a real channel. */
  finish(stdout: string, code = 0, stderr = "") {
    setImmediate(() => {
      if (stdout) this.emit("data", Buffer.from(stdout));
      if (stderr) this.stderr.emit("data", Buffer.from(stderr));
      this.emit("close", code);
    });
  }
}

export type ExecReply =
  | { stdout?: string; stderr?: string; code?: number }
  | ((stream: FakeStream) => void);

/**
 * An ssh2 Client that answers exec by the first matching pattern. A reply
 * may be a function for a long-lived channel such as a console.
 */
export class FakeClient extends EventEmitter {
  commands: string[] = [];
  streams: FakeStream[] = [];
  ended = false;

  constructor(private replies: Array<[RegExp, ExecReply]> = []) {
    super();
  }

  reply(pattern: RegExp, reply: ExecReply) {
    this.replies.unshift([pattern, reply]);
  }

  exec(
    command: string,
    optionsOrCallback: unknown,
    maybeCallback?: (err: Error | undefined, stream: FakeStream) => void,
  ) {
    const callback = (
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback
    ) as (err: Error | undefined, stream: FakeStream) => void;
    this.commands.push(command);
    const stream = new FakeStream();
    this.streams.push(stream);
    const match = this.replies.find(([pattern]) => pattern.test(command));
    callback(undefined, stream);
    if (!match) {
      stream.finish("");
      return this;
    }
    const reply = match[1];
    if (typeof reply === "function") reply(stream);
    else stream.finish(reply.stdout ?? "", reply.code ?? 0, reply.stderr ?? "");
    return this;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.emit("close");
  }
}
