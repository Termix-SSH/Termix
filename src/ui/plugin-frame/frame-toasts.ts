import { toast } from "sonner";

type Forward = (kind: string, message: string) => void;
type Call = (method: string, ...args: unknown[]) => Promise<unknown>;

const KINDS = ["success", "error", "info", "warning"] as const;

/**
 * Options that change what a toast does, not how it looks. The shell draws
 * only a kind and one line, so a toast carrying any of these stays with
 * sonner instead of being shown wrong. Every other option is presentation
 * (duration, icon, classNames, dismissible...) and is dropped.
 */
const BEHAVIORAL = new Set([
  "action",
  "cancel",
  "id",
  "onDismiss",
  "onAutoClose",
  "jsx",
]);

/**
 * The text a toast with options can still show in the shell. Keys whose
 * value is undefined are ignored, as sonner does. A string description is
 * appended to the message; any other description is dropped.
 */
function lineFor(message: string, data: unknown): string | null {
  if (data === undefined || data === null) return message;
  if (typeof data !== "object") return null;
  const options = data as Record<string, unknown>;
  for (const key of BEHAVIORAL) {
    if (options[key] !== undefined) return null;
  }
  const description = options.description;
  return typeof description === "string" && description !== ""
    ? `${message}: ${description}`
    : message;
}

/**
 * A plugin's own code calls this frame's sonner, but the frame has no
 * Toaster (the page is only as big as the plugin's view, often a toolbar).
 * Hand string toasts to the shell, which draws them over the whole window,
 * the same way the bridge's toast does. Anything else (loading, promise,
 * custom content, toasts with an action or id) keeps going to sonner.
 */
export function forwardToasts(forward: Forward): () => void {
  const target = toast as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const wrap = (name: string, kind: string) => {
    const original = target[name] as (...args: unknown[]) => unknown;
    originals.set(name, original);
    target[name] = (message: unknown, ...rest: unknown[]) => {
      const line =
        typeof message === "string" && rest.length <= 1
          ? lineFor(message, rest[0])
          : null;
      if (line !== null) {
        forward(kind, line);
        return undefined;
      }
      return original(message, ...rest);
    };
  };
  for (const kind of KINDS) wrap(kind, kind);
  wrap("message", "info");
  return () => {
    for (const [name, original] of originals) target[name] = original;
  };
}

/** Sends the plugin's toasts to the shell over the frame's port. */
export function installFrameToasts(call: Call): () => void {
  return forwardToasts(
    (kind, message) => void call("toast", kind, message).catch(() => {}),
  );
}
