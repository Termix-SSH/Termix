import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTouchWheelCoordinator } from "../../../features/terminal/touch-wheel-coordinator";

const touchEvent = (type: string, clientYValues: number[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = clientYValues.map((clientY) => ({ clientX: 10, clientY }));
  Object.defineProperty(event, "touches", {
    value: Object.assign(touches, {
      item: (index: number) => touches[index] ?? null,
    }),
  });
  return event;
};

const write = (terminal: Terminal, data: string) =>
  new Promise<void>((resolve) => terminal.write(data, resolve));

describe("touch wheel coordinator with xterm", () => {
  let terminal: Terminal | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    terminal?.dispose();
    container?.remove();
    terminal = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  const installXtermCharacterMeasurements = () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("xterm-char-measure-element")
          ? 32 * 9
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("xterm-char-measure-element") ? 18 : 0;
      },
    );
  };

  it("moves real normal-buffer scrollback during a drag and momentum", async () => {
    installXtermCharacterMeasurements();
    let now = 0;
    let nextHandle = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      frames.delete(handle);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    terminal = new Terminal({ cols: 80, rows: 10, scrollback: 1_000 });
    terminal.open(container);
    await write(
      terminal,
      Array.from({ length: 500 }, (_, index) => `${index + 1}\r\n`).join(""),
    );

    const element = terminal.element!;
    const dispose = installTouchWheelCoordinator(element);
    terminal.scrollToBottom();
    const bottom = terminal.buffer.active.viewportY;

    element.dispatchEvent(touchEvent("touchstart", [20]));
    now = 20;
    element.dispatchEvent(touchEvent("touchmove", [100]));
    const afterDrag = terminal.buffer.active.viewportY;
    element.dispatchEvent(touchEvent("touchend", []));
    for (let index = 0; index < 8; index++) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    }

    expect(bottom).toBeGreaterThan(400);
    expect(afterDrag).toBeLessThan(bottom);
    expect(terminal.buffer.active.viewportY).toBeLessThan(afterDrag);
    dispose();
  });

  it("preserves alternate-buffer wheel line ticks", async () => {
    installXtermCharacterMeasurements();
    let now = 0;
    let nextHandle = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      frames.delete(handle);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    terminal = new Terminal({ cols: 80, rows: 10 });
    terminal.open(container);
    const data: string[] = [];
    terminal.onData((value) => data.push(value));
    await write(terminal, "\x1b[?1049h");

    const element = terminal.element!;
    const dispose = installTouchWheelCoordinator(element);
    element.dispatchEvent(touchEvent("touchstart", [100]));
    now = 20;
    element.dispatchEvent(touchEvent("touchmove", [0]));
    data.length = 0;
    element.dispatchEvent(touchEvent("touchend", []));
    for (let index = 0; index < 8; index++) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    }

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(data.length).toBeGreaterThan(1);
    expect(data.every((value) => value === "\x1b[B")).toBe(true);
    dispose();
  });
});
