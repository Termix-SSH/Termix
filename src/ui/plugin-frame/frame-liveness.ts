/**
 * Notes work a background frame keeps doing on its own after activate:
 * repeating timers, open sockets and shell subscriptions. The shell keeps a
 * plugin with any of these running, and starts the rest only when something
 * needs their code.
 *
 * Timers and sockets count only when activate started them and they are
 * still open after it, since views and hooks start their own and stop them
 * when they unmount.
 */

type Reason = string;

const notes = new Set<Reason>();
let recording = false;
let installed = false;
const intervals = new Set<unknown>();
const sockets = new Set<{ readyState: number; label: string }>();

/** A shell subscription made by plugin code: counts whenever it happens. */
export function noteLiveWork(reason: Reason): void {
  notes.add(reason);
}

function install(target: typeof globalThis): void {
  if (installed) return;
  installed = true;
  const setIntervalBase = target.setInterval.bind(target);
  const clearIntervalBase = target.clearInterval.bind(target);
  target.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = setIntervalBase(...args);
    if (recording) intervals.add(id);
    return id;
  }) as typeof setInterval;
  target.clearInterval = ((id?: Parameters<typeof clearInterval>[0]) => {
    intervals.delete(id);
    clearIntervalBase(id);
  }) as typeof clearInterval;

  for (const name of ["WebSocket", "EventSource"] as const) {
    const Base = target[name] as unknown as
      (new (...args: unknown[]) => { readyState: number }) | undefined;
    if (typeof Base !== "function") continue;
    const Tracked = class extends Base {
      constructor(...args: unknown[]) {
        super(...args);
        if (recording) {
          sockets.add(
            Object.assign(this, { label: name }) as unknown as {
              readyState: number;
              label: string;
            },
          );
        }
      }
    };
    Object.defineProperty(target, name, {
      value: Tracked,
      configurable: true,
      writable: true,
    });
  }
}

/** Starts noting timers and sockets; call before activate. */
export function startLiveTracking(target: typeof globalThis = globalThis) {
  install(target);
  recording = true;
}

/** Stops noting new ones; call once activate finished. */
export function stopLiveTracking(): void {
  recording = false;
}

/** What still runs: shown to admins in dev logs, so plain words. */
export function liveWork(): Reason[] {
  const out = new Set(notes);
  if (intervals.size > 0) out.add("timer");
  for (const socket of sockets) {
    // 0 connecting, 1 open; 2 and 3 are closing and closed.
    if (socket.readyState < 2) out.add(socket.label);
  }
  return [...out].sort();
}

/** Test seam. */
export function resetLiveTracking(): void {
  notes.clear();
  intervals.clear();
  sockets.clear();
  recording = false;
}
