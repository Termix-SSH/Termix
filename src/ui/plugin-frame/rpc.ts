/**
 * Request and reply over postMessage, plus functions passed by reference.
 * Used on both sides: the shell has one per frame, a frame has one for its
 * parent. Arguments and results are encoded on the way out and decoded on the
 * way in, so a function in either one arrives as an async stand-in.
 */

import {
  FRAME_CHANNEL,
  isFrameMessage,
  type FrameMessage,
  type WireComponent,
  type WireFn,
  type WireIcon,
} from "./protocol";
import { decode, encode } from "./wire";

export type CallHandler = (method: string, args: unknown[]) => unknown;
export type EventHandler = (name: string, data: unknown) => void;

/** Calls to a function by reference use this method name. */
export const FN_METHOD = "fn";

const MAX_PENDING = 2_000;
const MAX_EXPORTED = 20_000;

export interface FramePortOptions {
  post: (message: FrameMessage) => void;
  onCall: CallHandler;
  onEvent?: EventHandler;
  /** Prefix for exported function ids, so the two sides never clash. */
  fnPrefix: string;
  /** How wire icons and components turn into values on this side. */
  icon?: (ref: WireIcon) => unknown;
  component?: (ref: WireComponent) => unknown;
}

export class FramePort {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private exported = new Map<string, (...args: unknown[]) => unknown>();
  private exportIds = new WeakMap<object, string>();
  private nextFn = 1;
  private closed = false;

  constructor(private readonly options: FramePortOptions) {}

  encode(value: unknown): unknown {
    return encode(value, { exportFn: (fn) => this.exportFn(fn) });
  }

  decode(value: unknown): unknown {
    return decode(value, {
      importFn: (ref) => this.importFn(ref),
      icon: this.options.icon,
      component: this.options.component,
    });
  }

  call(method: string, args: unknown[] = []): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Frame closed"));
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new Error("Too many calls in flight"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(this.decode(value)),
        reject,
      });
      try {
        this.options.post({
          ch: FRAME_CHANNEL,
          t: "call",
          id,
          method,
          args: this.encode(args) as unknown[],
        });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  emit(name: string, data?: unknown): void {
    if (this.closed) return;
    try {
      this.options.post({
        ch: FRAME_CHANNEL,
        t: "event",
        name,
        data: this.encode(data),
      });
    } catch {
      // A value that can't be cloned is dropped, not thrown into the caller.
    }
  }

  /** A reference the other side can call. The same function keeps its id. */
  exportFn(fn: (...args: never[]) => unknown): WireFn {
    let id = this.exportIds.get(fn);
    if (!id) {
      if (this.exported.size >= MAX_EXPORTED) {
        throw new Error("Too many functions passed to the other side");
      }
      id = `${this.options.fnPrefix}${this.nextFn++}`;
      this.exportIds.set(fn, id);
      this.exported.set(id, fn as (...args: unknown[]) => unknown);
    }
    return { $fn: id };
  }

  /** Calls a function the other side passed. Always async. */
  importFn(ref: WireFn): (...args: unknown[]) => Promise<unknown> {
    return (...args: unknown[]) => this.call(FN_METHOD, [ref.$fn, ...args]);
  }

  /** Handles one message. Returns false when it was not for this port. */
  receive(data: unknown): boolean {
    if (!isFrameMessage(data) || this.closed) return false;
    if (data.t === "reply") {
      const entry = this.pending.get(data.id);
      if (!entry) return true;
      this.pending.delete(data.id);
      if (data.ok) entry.resolve(data.value);
      else entry.reject(new Error(data.error ?? "Call failed"));
      return true;
    }
    if (data.t === "event") {
      this.options.onEvent?.(data.name, this.decode(data.data));
      return true;
    }
    if (data.t === "call") {
      void this.answer(data.id, data.method, data.args);
      return true;
    }
    return false;
  }

  private async answer(id: number, method: string, rawArgs: unknown[]) {
    try {
      let value: unknown;
      if (method === FN_METHOD) {
        const [ref, ...rest] = rawArgs;
        const fn = typeof ref === "string" ? this.exported.get(ref) : null;
        if (!fn) throw new Error("Unknown function");
        value = await fn(...(this.decode(rest) as unknown[]));
      } else {
        value = await this.options.onCall(
          method,
          this.decode(rawArgs) as unknown[],
        );
      }
      this.reply(id, true, this.encode(value));
    } catch (error) {
      this.reply(
        id,
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private reply(id: number, ok: boolean, value?: unknown, error?: string) {
    if (this.closed) return;
    try {
      this.options.post({
        ch: FRAME_CHANNEL,
        t: "reply",
        id,
        ok,
        value,
        error,
      });
    } catch {
      // The value could not be cloned; say so instead of hanging the caller.
      this.options.post({
        ch: FRAME_CHANNEL,
        t: "reply",
        id,
        ok: false,
        error: "The result could not be sent",
      });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(new Error("Frame closed"));
    }
    this.pending.clear();
    this.exported.clear();
  }
}
