/**
 * Messages to and from the process that started this backend. The desktop
 * app starts it as an Electron utility process (process.parentPort); the dev
 * runner forks it with an IPC channel (process.send). Docker has neither.
 */

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  off?(event: "message", listener: (event: { data: unknown }) => void): unknown;
}

type Target = {
  parentPort?: ParentPort;
  send?: (message: unknown) => boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
};

let target = process as unknown as Target;

/** Test seam. */
export function setParentTarget(next: Target | null): void {
  target = next ?? (process as unknown as Target);
}

export function hasParentChannel(): boolean {
  return !!target.parentPort || typeof target.send === "function";
}

export function sendToParent(message: unknown): boolean {
  if (target.parentPort) {
    target.parentPort.postMessage(message);
    return true;
  }
  if (typeof target.send === "function") {
    target.send(message);
    return true;
  }
  return false;
}

export function onParentMessage(
  listener: (message: unknown) => void,
): () => void {
  const port = target.parentPort;
  if (port) {
    const wrapped = (event: { data: unknown }) => listener(event?.data);
    port.on("message", wrapped);
    return () => port.off?.("message", wrapped);
  }
  const current = target;
  current.on("message", listener);
  return () => current.off("message", listener);
}
